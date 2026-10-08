// PreToolUse (Bash, PowerShell): enforce the house rules before a command runs.
//  - The owner does all git himself; work stays uncommitted on main. Git
//    commands that change history, branches, the index or discard work are
//    blocked. Reading (status, diff, log, show, stash list…) is fine.
//  - The dev stack is shared (other agents and the owner use it). Starting a
//    second copy, or stopping it, is blocked.
// Exit 2 = block; the message on stderr is shown to Claude.
import { connect } from "node:net";

const input = JSON.parse(await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data || "{}"));
}));
// Heredoc bodies are data (a doc being written, a script's source), not commands to run.
const command = String(input?.tool_input?.command ?? "").replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, "<<heredoc");

function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// Every `git …` invocation in the command (also inside && chains and after `git -c key=value` options).
const GIT = /\bgit(?:\.exe)?((?:\s+-c\s+\S+|\s+-C\s+\S+|\s+--no-pager)*)\s+([a-z-]+)([^;&|\n]*)/gi;
const WRITE = new Set(["commit", "push", "checkout", "switch", "reset", "restore", "merge", "rebase", "worktree", "tag", "cherry-pick", "revert", "am", "clean", "add", "rm", "mv", "pull", "fetch", "init", "clone", "filter-branch", "replace", "notes", "gc", "prune", "update-ref", "config"]);
for (const match of command.matchAll(GIT)) {
  const [, options, sub, rest] = match;
  const verb = sub.toLowerCase();
  const args = rest.trim();
  // `git -c safe.directory=… status` is how this repo is read (dubious ownership); a global config change is not.
  if (verb === "config" && !/--global|--system/.test(args) && /^(--get|--list|-l\b)/.test(args)) continue;
  if (verb === "stash" && !/^(list|show)\b/.test(args)) {
    block("Blocked: `git stash` changes the owner's working tree. The owner does all git himself; leave changes uncommitted on main.");
  }
  if (verb === "branch" && args && !/^(-a|-r|-v|-vv|--list|--show-current|--contains|--merged|--no-merged)\b/.test(args)) {
    block("Blocked: creating, renaming or deleting branches. The owner does all git himself; everything stays on main, uncommitted.");
  }
  if (WRITE.has(verb)) {
    block(`Blocked: \`git ${verb}\`. The owner does all git himself (commit, push, branches, staging). Leave your work as uncommitted changes on main. Read-only git (status, diff, log, show) is fine${options ? ", with the same -c options" : ""}.`);
  }
}

// Stopping the shared dev stack. Quoted text is ignored here: it's usually a
// message or a document being written that mentions these commands.
const unquoted = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
if (/\bpnpm(?:\s+run)?\s+dev:stop\b|\btaskkill(\.exe)?\b|\bStop-Process\b|\bkill\s+-9\b/i.test(unquoted)) {
  block("Blocked: this would stop processes of the shared dev stack (the owner and other agents are using it). If a restart is really needed, ask the owner.");
}
if (/\bdocker(?:\.exe)?\s+(?:container\s+)?(stop|rm|restart|kill)\b[^;&|\n]*codechatter-dev-/i.test(command) || /\bdocker(?:\.exe)?\s+compose\b[^;&|\n]*compose\.dev\.yaml[^;&|\n]*\b(down|stop|restart|rm)\b/i.test(command)) {
  block("Blocked: this would stop the shared dev infrastructure (Postgres, Valkey, Caddy, Mailpit). Ask the owner first.");
}

// Starting a second dev stack while one runs (the EADDRINUSE mess).
if (/\bpnpm(?:\s+run)?\s+dev\b(?!:)|\bturbo(?:\.exe)?\s+run\s+dev\b/i.test(command)) {
  const inUse = await new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 3000 });
    const done = (value) => (socket.destroy(), resolve(value));
    socket.setTimeout(400, () => done(false));
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
  });
  if (inUse) block("Blocked: the dev stack is already running (port 3000 is in use; app at http://localhost:8080). Use it as it is; saved files reload automatically.");
}

process.exit(0);
