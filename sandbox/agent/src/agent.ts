import { createInterface } from "node:readline";

import type { AgentEvent, AgentOp, TunnelOp } from "@codechatter/contracts";

import { startRelay } from "./relay.js";
import { Tunnels, watchPorts } from "./tunnel.js";
import { TreeWatcher } from "./watcher.js";
import { Workspace } from "./workspace.js";

/**
 * The sandbox agent (ADR 0003). Runs inside every room container as ccagent
 * (uid 10002) and talks to the runner over the container's attached stdio,
 * one JSON object per line (protocol: packages/contracts/src/sandbox.ts).
 *
 * Down: the runner sends the room's files; the agent writes them.
 * Up:   the agent watches /workspace and reports what programs and the
 *       terminal change, so it shows up in everyone's editor.
 */
process.umask(0o002); // files stay group-writable for ccuser (group 10000)

const workspace = new Workspace(process.env.CC_WORKSPACE ?? "/workspace");

function emit(event: AgentEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

const watcher = new TreeWatcher(workspace.root, async (paths) => {
  for (const path of paths) {
    const { events, isDir } = await workspace.inspect(path).catch((error: Error) => ({
      events: [{ ev: "error", message: `${path}: ${error.message}` } satisfies AgentEvent],
      isDir: false,
    }));
    events.forEach(emit);
    if (isDir) {
      // A folder that appears whole (mv, git clone, unzip) may already hold
      // files whose events came before the folder was watched.
      await watcher.watchTree(path);
      for (const file of await workspace.listFiles(path)) (await workspace.inspect(file)).events.forEach(emit);
    } else if (events.some((e) => e.ev === "removed")) {
      watcher.unwatch(path);
    }
  }
});

async function handle(op: AgentOp): Promise<void> {
  switch (op.op) {
    case "write":
      return workspace.write(op.path, op.content);
    case "mkdir":
      return workspace.mkdir(op.path);
    case "delete":
      return workspace.delete(op.path);
    case "reconcile":
      await workspace.reconcile(op.files, op.dirs);
      return;
    case "ping":
      return;
  }
}

const tunnels = new Tunnels(emit);

await watcher.watchTree();
emit({ ev: "ready", pid: process.pid, uid: process.getuid?.() ?? -1 });
watchPorts(emit);
startRelay();

// Ops run strictly in order: a delete sent after a write must land after it.
let queue: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  if (!line.trim()) return;
  let op: AgentOp | TunnelOp;
  try {
    op = JSON.parse(line) as AgentOp | TunnelOp;
  } catch {
    // Junk before the runner's first newline (see apps/runner/src/sandbox.ts) is expected; report anything else.
    if (!line.startsWith('{"stream"')) emit({ ev: "error", message: `unreadable message: ${JSON.stringify(line.slice(0, 160))}` });
    return;
  }
  // Anything that isn't a protocol message (e.g. bytes Docker leaked into
  // stdin when the runner attached) is ignored.
  if (typeof op !== "object" || op === null || typeof (op as { op?: unknown }).op !== "string") return;
  // Tunnel traffic is independent of file operations: never queued behind them.
  if (op.op === "tcp_open" || op.op === "tcp_data" || op.op === "tcp_close") {
    tunnels.handle(op);
    return;
  }
  const fileOp = op;
  queue = queue
    .then(() => handle(fileOp))
    .then(
      () => emit({ ev: "ok", id: fileOp.id }),
      (error: Error) => emit({ ev: "error", id: fileOp.id, message: error.message }),
    );
});
