import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import type { GithubConnection, PullComment, PullCommentInput, PullDetail, PullSummary, RepoImport } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Env } from "../config/env.js";
import { DB, ENV } from "../infra/tokens.js";
import { pickTextFiles, type ImportedFile } from "./import-files.js";
import { readTar } from "./tar.js";
import { openToken, sealToken } from "./token-box.js";

/** A tarball bigger than this, gzipped, is too big to import (it's held in memory while it's read). */
const MAX_TARBALL_BYTES = 60 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;

export type DownloadedRepo = {
  owner: string;
  name: string;
  branch: string;
  defaultBranch: string;
  commitSha: string;
  files: ImportedFile[];
  skipped: number;
  truncated: boolean;
};

/**
 * GitHub for rooms: a person's token (sealed in github_tokens), and a repository's files
 * downloaded through the GitHub API as one tarball, so sandboxes still need no internet.
 */
@Injectable()
export class GithubService {
  /** People with an import running: one at a time each, as an import holds the tarball in memory. */
  private readonly importing = new Set<string>();

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async connection(userId: string): Promise<GithubConnection> {
    const [row] = await this.handle.db.select({ login: schema.githubTokens.login }).from(schema.githubTokens).where(eq(schema.githubTokens.userId, userId));
    return { login: row?.login ?? null };
  }

  /** Check the token with GitHub (whose is it?), then keep it sealed. */
  async saveToken(userId: string, token: string): Promise<GithubConnection> {
    const response = await this.call("/user", token);
    if (response.status === 401) throw new BadRequestException("GitHub didn't accept that token. Check it hasn't expired, or make a new one.");
    if (!response.ok) throw this.failure(response, "check the token");
    const { login } = (await response.json()) as { login: string };
    const values = { userId, login, sealed: sealToken(this.env.BETTER_AUTH_SECRET, token), updatedAt: new Date() };
    await this.handle.db.insert(schema.githubTokens).values(values).onConflictDoUpdate({ target: schema.githubTokens.userId, set: values });
    return { login };
  }

  async removeToken(userId: string): Promise<void> {
    await this.handle.db.delete(schema.githubTokens).where(eq(schema.githubTokens.userId, userId));
  }

  async tokenFor(userId: string): Promise<string | null> {
    const [row] = await this.handle.db.select({ sealed: schema.githubTokens.sealed }).from(schema.githubTokens).where(eq(schema.githubTokens.userId, userId));
    return row ? openToken(this.env.BETTER_AUTH_SECRET, row.sealed) : null;
  }

  /** A repository's text files at a branch, tag or commit (its default branch when none is given). */
  async download(userId: string, repo: RepoImport): Promise<DownloadedRepo> {
    if (this.importing.has(userId)) throw new HttpException("You're already importing a repository. Wait for it to finish.", 429);
    this.importing.add(userId);
    try {
      const token = await this.tokenFor(userId);
      const meta = await this.call(`/repos/${repo.owner}/${repo.name}`, token);
      if (meta.status === 404) {
        throw new NotFoundException(
          token
            ? `No repository ${repo.owner}/${repo.name} that your GitHub token can see.`
            : `No public repository ${repo.owner}/${repo.name}. For a private one, add a GitHub token in Settings first.`,
        );
      }
      if (meta.status === 401) throw new BadRequestException("GitHub refused your saved token. Add a new one in Settings.");
      if (!meta.ok) throw this.failure(meta, "find the repository");
      const info = (await meta.json()) as { full_name: string; default_branch: string };
      const [owner, name] = info.full_name.split("/") as [string, string];
      const branch = repo.ref ?? info.default_branch;

      const tarball = await this.call(`/repos/${owner}/${name}/tarball/${refPath(branch)}`, token, 120_000);
      if (tarball.status === 404) throw new NotFoundException(`${owner}/${name} has no branch, tag or commit called ${branch}, or it's empty.`);
      if (!tarball.ok) throw this.failure(tarball, "download the repository");
      const unpacked = await promisify(gunzip)(await readCapped(tarball), { maxOutputLength: MAX_UNPACKED_BYTES }).catch((error: unknown) => {
        if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
        throw new BadGatewayException("GitHub sent a download that couldn't be read. Try again.");
      });
      const { entries, comment } = readTar(unpacked);
      // GitHub puts the commit in the tarball's comment; ask for it when it's missing.
      const commitSha = comment && /^[0-9a-f]{40}$/.test(comment) ? comment : await this.headOf(token, owner, name, branch);
      return { owner, name, branch, defaultBranch: info.default_branch, commitSha, ...pickTextFiles(entries) };
    } finally {
      this.importing.delete(userId);
    }
  }

  /** The commit a branch (or tag) points at now. */
  async head(userId: string, owner: string, name: string, branch: string): Promise<string> {
    return this.headOf(await this.tokenFor(userId), owner, name, branch);
  }

  private async headOf(token: string | null, owner: string, name: string, branch: string): Promise<string> {
    const response = await this.call(`/repos/${owner}/${name}/commits/${refPath(branch)}`, token, 20_000, { accept: "application/vnd.github.sha" });
    if (response.status === 404 || response.status === 422) throw new NotFoundException(`${owner}/${name} has no branch called ${branch} any more.`);
    if (!response.ok) throw this.failure(response, "find the branch");
    return (await response.text()).trim();
  }

  /** The repository's branches, by name (the first hundred). */
  async branches(userId: string, owner: string, name: string): Promise<string[]> {
    const response = await this.call(`/repos/${owner}/${name}/branches?per_page=100`, await this.tokenFor(userId));
    if (!response.ok) throw this.failure(response, "list the branches");
    return ((await response.json()) as Array<{ name: string }>).map((branch) => branch.name);
  }

  /**
   * Commit files onto `parent` with your token, through the Git Data API (a tree with the
   * changes on the parent's tree, then a commit), and move `branch` to it. The branch moves
   * only forward: if it has commits the room hasn't seen, the push is refused. A new branch
   * is made at the commit. Returns the commit.
   */
  async pushCommit(
    userId: string,
    repo: { owner: string; name: string },
    commit: { parent: string; branch: string; newBranch: boolean; message: string; changes: Array<{ path: string; content: string | null }> },
  ): Promise<string> {
    const token = await this.tokenFor(userId);
    if (!token) throw new BadRequestException("Add a GitHub token in Settings to commit. It needs write access to the repository.");
    const base = `/repos/${repo.owner}/${repo.name}/git`;
    const send = async <T>(path: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<{ status: number; data: T }> => {
      const response = await this.call(`${base}${path}`, token, 60_000, { method, body });
      if (response.status === 401) throw new BadRequestException("GitHub refused your saved token. Add a new one in Settings.");
      if (response.status === 403 || (response.status === 404 && method !== "GET")) {
        if (response.headers.get("x-ratelimit-remaining") === "0") throw this.failure(response, "commit");
        throw new ForbiddenException(`Your GitHub token can't write to ${repo.owner}/${repo.name}. It needs the repo scope, or write access to contents.`);
      }
      return { status: response.status, data: (await response.json().catch(() => null)) as T };
    };

    const parent = await send<{ tree: { sha: string } }>(`/commits/${commit.parent}`, "GET");
    if (parent.status === 404) throw new ConflictException("The room's last synced commit isn't on GitHub any more (was the branch rewritten?). Pull, then commit.");
    if (parent.status !== 200) throw new BadGatewayException(`GitHub couldn't find the room's last synced commit (status ${parent.status}). Try again.`);
    // Keep each file's mode (an executable script stays executable).
    const listing = await send<{ tree: Array<{ path: string; mode: string; type: string }> }>(`/trees/${parent.data.tree.sha}?recursive=1`, "GET");
    const modes = new Map((listing.status === 200 ? listing.data.tree : []).filter((e) => e.type === "blob").map((e) => [e.path, e.mode]));
    const tree = await send<{ sha: string }>("/trees", "POST", {
      base_tree: parent.data.tree.sha,
      tree: commit.changes.map(({ path, content }) =>
        content === null ? { path, mode: modes.get(path) ?? "100644", type: "blob", sha: null } : { path, mode: modes.get(path) ?? "100644", type: "blob", content },
      ),
    });
    if (tree.status !== 201) throw new BadGatewayException(`GitHub couldn't take the changed files (status ${tree.status}). Try again.`);
    const made = await send<{ sha: string }>("/commits", "POST", { message: commit.message, tree: tree.data.sha, parents: [commit.parent] });
    if (made.status !== 201) throw new BadGatewayException(`GitHub couldn't make the commit (status ${made.status}). Try again.`);

    const moved = commit.newBranch
      ? await send("/refs", "POST", { ref: `refs/heads/${commit.branch}`, sha: made.data.sha })
      : await send(`/refs/heads/${refPath(commit.branch)}`, "PATCH", { sha: made.data.sha, force: false });
    if (moved.status === 422) {
      throw new ConflictException(
        commit.newBranch
          ? `A branch called ${commit.branch} is already on GitHub. Pick another name.`
          : `${commit.branch} has commits on GitHub that the room doesn't. Pull them first, then commit.`,
      );
    }
    if (moved.status !== 200 && moved.status !== 201) throw new BadGatewayException(`GitHub couldn't move ${commit.branch} (status ${moved.status}). Try again.`);
    return made.data.sha;
  }

  /** The repository's default branch. */
  async defaultBranch(userId: string, owner: string, name: string): Promise<string> {
    const response = await this.call(`/repos/${owner}/${name}`, await this.tokenFor(userId));
    if (!response.ok) throw this.failure(response, "find the repository");
    return ((await response.json()) as { default_branch: string }).default_branch;
  }

  /** Open pull requests, most recently updated first (the first thirty). */
  async pulls(userId: string, owner: string, name: string): Promise<PullSummary[]> {
    const response = await this.call(`/repos/${owner}/${name}/pulls?state=open&sort=updated&direction=desc&per_page=30`, await this.tokenFor(userId));
    if (!response.ok) throw this.failure(response, "list the pull requests");
    return ((await response.json()) as GhPull[]).map(toSummary);
  }

  /** A pull request with its files (their patches) and review comments. */
  async pull(userId: string, owner: string, name: string, number: number): Promise<PullDetail> {
    const token = await this.tokenFor(userId);
    const base = `/repos/${owner}/${name}/pulls/${number}`;
    const [pull, files, comments] = await Promise.all([this.call(base, token), this.call(`${base}/files?per_page=100`, token), this.call(`${base}/comments?per_page=100`, token)]);
    if (pull.status === 404) throw new NotFoundException(`${owner}/${name} has no pull request #${number}.`);
    for (const response of [pull, files, comments]) if (!response.ok) throw this.failure(response, "read the pull request");
    const data = (await pull.json()) as GhPull & { body: string | null; state: "open" | "closed"; merged: boolean };
    return {
      ...toSummary(data),
      body: data.body ?? "",
      state: data.state,
      merged: Boolean(data.merged),
      headSha: data.head.sha,
      files: ((await files.json()) as GhFile[]).map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch ?? null,
      })),
      comments: ((await comments.json()) as GhComment[]).map(toComment),
    };
  }

  /** Open a pull request with your token. */
  async openPull(userId: string, repo: { owner: string; name: string }, input: { title: string; body: string; head: string; base: string }): Promise<PullSummary> {
    const token = await this.requireToken(userId, "open a pull request");
    const { status, data } = await this.write(token, repo, `/repos/${repo.owner}/${repo.name}/pulls`, input, "open pull requests on");
    if (status === 422) throw new ConflictException(githubSays(data) ?? "GitHub couldn't open that pull request.");
    if (status !== 201) throw new BadGatewayException(`GitHub couldn't open the pull request (status ${status}). Try again.`);
    return toSummary(data as GhPull);
  }

  /** Comment on a line of a pull request's diff, or reply to a comment, with your token. */
  async commentOnPull(userId: string, repo: { owner: string; name: string }, number: number, input: PullCommentInput): Promise<PullComment> {
    const token = await this.requireToken(userId, "comment on pull requests");
    const base = `/repos/${repo.owner}/${repo.name}/pulls/${number}/comments`;
    const { status, data } = input.inReplyTo
      ? await this.write(token, repo, `${base}/${input.inReplyTo}/replies`, { body: input.body }, "comment on")
      : await this.write(token, repo, base, { body: input.body, commit_id: input.commitId, path: input.path, line: input.line, side: input.side }, "comment on");
    if (status === 422) throw new BadRequestException(githubSays(data) ?? "GitHub couldn't place that comment. The line may have changed: reload the pull request.");
    if (status !== 201) throw new BadGatewayException(`GitHub couldn't post the comment (status ${status}). Try again.`);
    return toComment(data as GhComment);
  }

  /**
   * Make the room's webhook on GitHub with your token (it takes admin rights on the
   * repository). Null when there's no token or it can't, so it's added by hand instead.
   */
  async createHook(userId: string, repo: { owner: string; name: string }, config: { url: string; secret: string }): Promise<number | null> {
    const token = await this.tokenFor(userId);
    if (!token) return null;
    const response = await this.call(`/repos/${repo.owner}/${repo.name}/hooks`, token, 30_000, {
      method: "POST",
      body: { name: "web", active: true, events: ["push", "pull_request", "workflow_run"], config: { url: config.url, content_type: "json", secret: config.secret, insecure_ssl: "0" } },
    });
    if (response.status !== 201) return null;
    return ((await response.json()) as { id: number }).id;
  }

  /** Remove a webhook the room made; if GitHub won't, it stops being answered anyway. */
  async deleteHook(userId: string, repo: { owner: string; name: string }, id: number): Promise<void> {
    const token = await this.tokenFor(userId);
    if (token) await this.call(`/repos/${repo.owner}/${repo.name}/hooks/${id}`, token, 20_000, { method: "DELETE" }).catch(() => {});
  }

  /**
   * A new repository of yours holding exactly these files, as one commit on its default
   * branch. GitHub makes it with a README first (the Git Data API needs a commit to build
   * on), and the files' commit replaces that.
   */
  async publish(
    userId: string,
    input: { name: string; private: boolean; description: string; files: Array<{ path: string; content: string }> },
  ): Promise<{ owner: string; name: string; branch: string; commit: string; url: string }> {
    const token = await this.requireToken(userId, "publish to GitHub. It needs the repo scope");
    const made = await this.call("/user/repos", token, 30_000, {
      method: "POST",
      body: { name: input.name, private: input.private, description: input.description, auto_init: true },
    });
    if (made.status === 401) throw new BadRequestException("GitHub refused your saved token. Add a new one in Settings.");
    if (made.status === 403 || made.status === 404) throw new ForbiddenException("Your GitHub token can't make repositories. It needs the repo scope.");
    if (made.status === 422) throw new ConflictException(`GitHub says: ${githubSays(await made.json().catch(() => null)) ?? "that name can't be used"}. Pick another name.`);
    if (made.status !== 201) throw new BadGatewayException(`GitHub couldn't make the repository (status ${made.status}). Try again.`);
    const repo = (await made.json()) as { full_name: string; default_branch: string; html_url: string };
    const [owner, name] = repo.full_name.split("/") as [string, string];
    const branch = repo.default_branch;

    // The first commit can take a moment to appear on a brand-new repository.
    let parent: string | null = null;
    for (let attempt = 0; attempt < 5 && !parent; attempt++) {
      parent = await this.headOf(token, owner, name, branch).catch(() => null);
      if (!parent) await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
    }
    if (!parent) throw new BadGatewayException(`GitHub made ${repo.full_name} but its first commit didn't appear. Try publishing again in a moment.`);
    const git = `/repos/${owner}/${name}/git`;
    const post = async (path: string, body: unknown, method = "POST") => {
      const response = await this.call(`${git}${path}`, token, 120_000, { method, body });
      if (!response.ok) throw new BadGatewayException(`GitHub couldn't take the room's files into ${repo.full_name} (status ${response.status}). Try again.`);
      return (await response.json()) as { sha: string };
    };
    const tree = await post("/trees", { tree: input.files.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content })) });
    const commit = await post("/commits", { message: "Published from CodeChatter", tree: tree.sha, parents: [parent] });
    await post(`/refs/heads/${refPath(branch)}`, { sha: commit.sha, force: false }, "PATCH");
    return { owner, name, branch, commit: commit.sha, url: repo.html_url };
  }

  /** A gist of one file, with your token. */
  async gist(userId: string, input: { name: string; content: string; description: string; public: boolean }): Promise<string> {
    const token = await this.requireToken(userId, "make gists. It needs the gist scope");
    const response = await this.call("/gists", token, 30_000, {
      method: "POST",
      body: { description: input.description, public: input.public, files: { [input.name]: { content: input.content } } },
    });
    if (response.status === 401) throw new BadRequestException("GitHub refused your saved token. Add a new one in Settings.");
    if (response.status === 403 || response.status === 404) throw new ForbiddenException("Your GitHub token can't make gists. It needs the gist scope.");
    if (response.status === 422) throw new BadRequestException(`GitHub says: ${githubSays(await response.json().catch(() => null)) ?? "that gist can't be made"}.`);
    if (response.status !== 201) throw new BadGatewayException(`GitHub couldn't make the gist (status ${response.status}). Try again.`);
    return ((await response.json()) as { html_url: string }).html_url;
  }

  private async requireToken(userId: string, doing: string): Promise<string> {
    const token = await this.tokenFor(userId);
    if (!token) throw new BadRequestException(`Add a GitHub token in Settings to ${doing}.`);
    return token;
  }

  /** A POST with your token; a refusal is said plainly, anything else is the caller's to read. */
  private async write(token: string, repo: { owner: string; name: string }, path: string, body: unknown, doing: string): Promise<{ status: number; data: unknown }> {
    const response = await this.call(path, token, 30_000, { method: "POST", body });
    if (response.status === 401) throw new BadRequestException("GitHub refused your saved token. Add a new one in Settings.");
    if (response.status === 403 || response.status === 404) {
      if (response.headers.get("x-ratelimit-remaining") === "0") throw this.failure(response, doing);
      throw new ForbiddenException(`Your GitHub token can't ${doing} ${repo.owner}/${repo.name}. It needs the repo scope, or write access to pull requests.`);
    }
    return { status: response.status, data: await response.json().catch(() => null) };
  }

  private async call(path: string, token: string | null, timeout = 20_000, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
    try {
      return await fetch(`${this.env.GITHUB_API_URL}${path}`, {
        method: init.method ?? "GET",
        headers: {
          accept: init.accept ?? "application/vnd.github+json",
          "user-agent": "CodeChatter",
          "x-github-api-version": "2022-11-28",
          ...(token && { authorization: `Bearer ${token}` }),
          ...(init.body !== undefined && { "content-type": "application/json" }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new BadGatewayException("Couldn't reach GitHub. Try again in a moment.");
    }
  }

  private failure(response: Response, doing: string): HttpException {
    if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
      return new HttpException("GitHub's limit on downloads without a token is reached for now. Try again within the hour, or add a GitHub token in Settings.", 429);
    }
    return new BadGatewayException(`GitHub couldn't ${doing} (status ${response.status}). Try again.`);
  }
}

type GhPull = {
  number: number;
  title: string;
  user: { login: string } | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  draft?: boolean;
  html_url: string;
  updated_at: string;
};
type GhFile = { filename: string; previous_filename?: string; status: string; additions: number; deletions: number; patch?: string };
type GhComment = {
  id: number;
  path: string;
  line: number | null;
  side?: string;
  body: string;
  user: { login: string } | null;
  created_at: string;
  in_reply_to_id?: number;
  html_url: string;
};

const toSummary = (pull: GhPull): PullSummary => ({
  number: pull.number,
  title: pull.title,
  author: pull.user?.login ?? "ghost",
  head: pull.head.ref,
  base: pull.base.ref,
  draft: Boolean(pull.draft),
  url: pull.html_url,
  updatedAt: pull.updated_at,
});

const toComment = (comment: GhComment): PullComment => ({
  id: comment.id,
  path: comment.path,
  line: comment.line ?? null,
  side: comment.side === "LEFT" ? "LEFT" : "RIGHT",
  body: comment.body,
  author: comment.user?.login ?? "ghost",
  createdAt: comment.created_at,
  inReplyTo: comment.in_reply_to_id ?? null,
  url: comment.html_url,
});

/** GitHub's own words for a refusal: its first error's message, else its message. */
const githubSays = (data: unknown): string | null => {
  const body = data as { message?: string; errors?: Array<{ message?: string }> } | null;
  return body?.errors?.find((e) => e.message)?.message ?? body?.message ?? null;
};

/** A branch in a URL path: each part escaped, the slashes kept. */
const refPath = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");

const tooLarge = () => new PayloadTooLargeException("That repository is too large to import (over 60 MB compressed).");

/** The body, refusing more than MAX_TARBALL_BYTES. */
async function readCapped(response: Response): Promise<Buffer> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_TARBALL_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_TARBALL_BYTES) throw tooLarge();
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new BadGatewayException("The download from GitHub stopped part way. Try again.");
  }
  return Buffer.concat(chunks);
}
