import type { GitAuthor, GitBranch, GitChange, GitCommit, GitMark, GitRequest, GitResponse, GitStatus } from "@codechatter/contracts";

import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { exitCodeOnceEnded, type RoomSandbox } from "./sandbox.js";

/**
 * Git in the room's sandbox (the Source Control view's "Git in the sandbox"): the
 * repository at /workspace, which the room's files are synced into. `.git` stays in the
 * sandbox's volume (the sync never carries it), and whatever git changes in the files,
 * such as a branch switch or a discard, reaches the room through the sync like any
 * program's writes.
 *
 * Only these operations run, each a fixed argument list (no shell, paths after `--`),
 * inside the jail like a Run. Hooks and fsmonitor are off, and paths are literal, so
 * a room's files can't make the panel run anything; the API asks for Run rights anyway,
 * since a repository's own config (filters) can run commands.
 */

export class GitError extends Error {}

const SECONDS = 30;
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_CHANGES = 2000;
const MAX_SHOW = 1_000_000;

const FLAGS = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "safe.directory=/workspace",
  "-c", "core.quotePath=false",
  "-c", "color.ui=never",
  "--no-pager",
  "--literal-pathspecs",
];
const ENV = ["GIT_TERMINAL_PROMPT=0", "GIT_EDITOR=true", "GIT_PAGER=cat", "GIT_OPTIONAL_LOCKS=0"];

/** What the room's file sync leaves in the sandbox (sandbox/agent/src/rules.ts), so a new repository doesn't list it. */
const EXCLUDE = [
  "node_modules/", "__pycache__/", ".venv/", "venv/", ".mypy_cache/", ".pytest_cache/", ".ruff_cache/",
  ".next/", ".svelte-kit/", ".nuxt/", ".output/", ".angular/", ".astro/", ".turbo/", ".vercel/",
  ".cache/", ".npm/", ".gradle/", "dist/", "build/", "target/", "vendor/",
  "*.pyc", "*.class", "*.o", "*.so", "*.swp", ".cc-tmp-*",
];

type Output = { code: number | null; stdout: Buffer; stderr: string };

async function exec(sandbox: RoomSandbox, script: string, args: string[], env: string[] = []): Promise<Output> {
  const handle = await sandbox.exec([JAIL, "sh", "-c", `cd /workspace || exit 1; ${script}`, "cc-git", ...args], { tty: false, stdin: false, env: [...ENV, ...env] });
  const stdout = new Collector(MAX_OUTPUT);
  const stderr = new Collector(64 * 1024);
  handle.demux(stdout, stderr);
  await ended(handle.stream);
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  return { code, stdout: stdout.bytes(), stderr: stderr.text() };
}

/** `git <args>`, with the panel's flags; throws its message unless it exits with one of `ok`. */
async function git(sandbox: RoomSandbox, args: string[], options: { env?: string[]; ok?: number[] } = {}): Promise<Output> {
  const out = await exec(sandbox, `exec timeout ${SECONDS} git "$@"`, [...FLAGS, ...args], options.env);
  if (!(options.ok ?? [0]).includes(out.code ?? -1)) throw new GitError(gitMessage(out.stderr) || `git ${args[0]} failed.`);
  return out;
}

/** git's own words, without its "fatal:"/"error:" prefixes and hints. */
export function gitMessage(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("hint:"))
    .map((line) => line.replace(/^(fatal|error|warning): /, ""))
    .join(" ")
    .slice(0, 500);
}

const mark = (c: string): GitMark | null => (c === "." ? null : (["M", "A", "D", "R", "C", "T"] as const).find((m) => m === c) ?? "M");

/** `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export function parseStatus(raw: string): { branch: string | null; head: string | null; changes: GitChange[] } {
  const parts = raw.split("\0");
  let branch: string | null = null;
  let head: string | null = null;
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part) continue;
    if (part.startsWith("# branch.oid ")) {
      const oid = part.slice("# branch.oid ".length);
      head = oid === "(initial)" ? null : oid.slice(0, 7);
    } else if (part.startsWith("# branch.head ")) {
      const name = part.slice("# branch.head ".length);
      branch = name === "(detached)" ? null : name;
    } else if (part.startsWith("1 ")) {
      const fields = part.split(" ");
      changes.push({ path: fields.slice(8).join(" "), from: null, staged: mark(fields[1]![0]!), unstaged: mark(fields[1]![1]!), conflict: false });
    } else if (part.startsWith("2 ")) {
      const fields = part.split(" ");
      changes.push({ path: fields.slice(9).join(" "), from: parts[++i] ?? null, staged: mark(fields[1]![0]!), unstaged: mark(fields[1]![1]!), conflict: false });
    } else if (part.startsWith("u ")) {
      changes.push({ path: part.split(" ").slice(10).join(" "), from: null, staged: null, unstaged: "M", conflict: true });
    } else if (part.startsWith("? ")) {
      changes.push({ path: part.slice(2), from: null, staged: null, unstaged: "?", conflict: false });
    }
  }
  return { branch, head, changes };
}

const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";

/** `git log --format=LOG_FORMAT`. */
export function parseLog(raw: string): GitCommit[] {
  return raw
    .split("\x1e")
    .map((entry) => entry.replace(/^\n/, ""))
    .filter(Boolean)
    .map((entry) => {
      const [id, short, author, email, at, subject] = entry.split("\x1f");
      return { id: id!, short: short!, author: author ?? "", email: email ?? "", at: at ?? "", subject: subject ?? "" };
    });
}

async function status(sandbox: RoomSandbox): Promise<GitStatus> {
  const out = await git(sandbox, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], { ok: [0, 128] });
  if (out.code === 128) {
    if (/not a git repository/i.test(out.stderr)) return { repo: false };
    throw new GitError(gitMessage(out.stderr));
  }
  const parsed = parseStatus(out.stdout.toString("utf8"));
  return { repo: true, branch: parsed.branch, head: parsed.head, changes: parsed.changes.slice(0, MAX_CHANGES), more: Math.max(0, parsed.changes.length - MAX_CHANGES) };
}

async function requireRepo(sandbox: RoomSandbox): Promise<Extract<GitStatus, { repo: true }>> {
  const now = await status(sandbox);
  if (!now.repo) throw new GitError("This room's sandbox has no git repository yet. Initialise one first.");
  return now;
}

async function hasHead(sandbox: RoomSandbox): Promise<boolean> {
  return (await git(sandbox, ["rev-parse", "-q", "--verify", "HEAD"], { ok: [0, 1, 128] })).code === 0;
}

function authorEnv(author: GitAuthor | undefined): string[] {
  if (!author) throw new GitError("A commit needs an author.");
  return [`GIT_AUTHOR_NAME=${author.name}`, `GIT_AUTHOR_EMAIL=${author.email}`, `GIT_COMMITTER_NAME=${author.name}`, `GIT_COMMITTER_EMAIL=${author.email}`];
}

/**
 * Run one of the panel's operations. The room's latest edits are in the sandbox first
 * (the caller flushes the sync), and file changes git makes come back through it.
 */
export async function runGit(session: RoomSession, request: GitRequest, author?: GitAuthor): Promise<GitResponse> {
  const { sandbox } = session;
  switch (request.op) {
    case "status":
      return { op: "status", status: await status(sandbox) };

    case "init": {
      if (!(await status(sandbox)).repo) {
        await git(sandbox, ["init", "-q", "-b", request.branch]);
        await exec(sandbox, 'printf "%s\\n" "# Left in the sandbox by the room\'s file sync (CodeChatter)" "$@" >> .git/info/exclude', EXCLUDE);
      }
      return { op: "init", status: await status(sandbox) };
    }

    case "stage":
      await requireRepo(sandbox);
      await git(sandbox, ["add", "-A", "--", ...request.paths]);
      return { op: "stage", status: await status(sandbox) };

    case "unstage":
      await requireRepo(sandbox);
      if (await hasHead(sandbox)) await git(sandbox, ["restore", "--staged", "--", ...request.paths]);
      else await git(sandbox, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...request.paths]);
      return { op: "unstage", status: await status(sandbox) };

    case "discard": {
      const now = await requireRepo(sandbox);
      const head = await hasHead(sandbox);
      const restore: string[] = [];
      const remove: string[] = [];
      for (const path of request.paths) {
        const change = now.changes.find((c) => c.path === path);
        if (!change) continue;
        // New since the last commit (untracked, or added): it goes. A rename's new path goes, and its old one comes back.
        if (change.unstaged === "?" || change.staged === "A" || !head) remove.push(path);
        else if (change.staged === "R" && change.from) {
          remove.push(path);
          restore.push(change.from);
        } else restore.push(path);
      }
      if (remove.length) {
        await git(sandbox, ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...remove]);
        await git(sandbox, ["clean", "-f", "-q", "--", ...remove]);
      }
      if (restore.length) await git(sandbox, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...restore]);
      return { op: "discard", status: await status(sandbox) };
    }

    case "commit": {
      await requireRepo(sandbox);
      const env = authorEnv(author);
      if (request.all) await git(sandbox, ["add", "-A"]);
      const staged = await git(sandbox, ["diff", "--cached", "--quiet"], { ok: [0, 1] });
      if (staged.code === 0) throw new GitError(request.all ? "Nothing to commit: no file has changed." : "Nothing to commit: stage some changes first.");
      await git(sandbox, ["commit", "-q", "-m", request.message], { env });
      const id = (await git(sandbox, ["rev-parse", "--short", "HEAD"])).stdout.toString("utf8").trim();
      return { op: "commit", status: await status(sandbox), commit: id };
    }

    case "show": {
      await requireRepo(sandbox);
      const out = await git(sandbox, ["show", `${request.at === "head" ? "HEAD" : ""}:${request.path}`], { ok: [0, 128] });
      if (out.code !== 0) return { op: "show", path: request.path, text: null, binary: false };
      const bytes = out.stdout;
      if (bytes.subarray(0, 8192).includes(0) || bytes.length > MAX_SHOW) return { op: "show", path: request.path, text: null, binary: true };
      return { op: "show", path: request.path, text: bytes.toString("utf8"), binary: false };
    }

    case "log": {
      await requireRepo(sandbox);
      if (!(await hasHead(sandbox))) return { op: "log", commits: [] };
      const out = await git(sandbox, ["log", `-n${request.limit}`, `--format=${LOG_FORMAT}`]);
      return { op: "log", commits: parseLog(out.stdout.toString("utf8")) };
    }

    case "branches": {
      const now = await requireRepo(sandbox);
      const out = await git(sandbox, ["for-each-ref", "--format=%(refname:short)%1f%(objectname:short)%1f%(HEAD)", "refs/heads/"]);
      const branches: GitBranch[] = out.stdout
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, short, current] = line.split("\x1f");
          return { name: name!, short: short ?? "", current: current === "*" };
        });
      return { op: "branches", branches, current: now.branch };
    }

    case "checkout": {
      await requireRepo(sandbox);
      await git(sandbox, request.create ? ["switch", "-q", "-c", request.branch] : ["switch", "-q", request.branch]);
      return { op: "checkout", status: await status(sandbox) };
    }
  }
}
