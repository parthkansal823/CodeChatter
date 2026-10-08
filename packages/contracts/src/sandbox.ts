/**
 * The sandbox agent protocol: newline-delimited JSON over the room container's
 * attached stdin/stdout (sandbox/agent ↔ apps/runner). It works with the
 * container's network switched off, and no credential ever enters the box.
 */

/** Runner → agent. Every op carries an id, answered by "ok" or "error". */
export type AgentOp =
  | { op: "write"; id: number; path: string; content: string }
  | { op: "mkdir"; id: number; path: string }
  | { op: "delete"; id: number; path: string }
  /** Remove every file and folder not listed (ignored folders like node_modules are kept). */
  | { op: "reconcile"; id: number; files: string[]; dirs: string[] }
  | { op: "ping"; id: number };

/**
 * TCP tunnel to a server inside the sandbox (live preview of dev servers),
 * over the same stdio: the container never gets a network. Not acknowledged
 * one by one; the connection's own close/error events report problems.
 */
export type TunnelOp =
  | { op: "tcp_open"; conn: number; port: number }
  | { op: "tcp_data"; conn: number; b64: string }
  | { op: "tcp_close"; conn: number };

/** Agent → runner. "file" and "removed" report changes made inside the sandbox. */
export type AgentEvent =
  | { ev: "ready"; pid: number; uid: number }
  | { ev: "ok"; id: number }
  | { ev: "error"; id?: number; message: string }
  | { ev: "file"; path: string; content: string }
  | { ev: "removed"; path: string }
  | { ev: "skipped"; path: string; reason: "binary" | "too-large" }
  /** Ports something in the sandbox is listening on (sent when the set changes). */
  | { ev: "ports"; ports: number[] }
  | { ev: "tcp_connected"; conn: number }
  | { ev: "tcp_data"; conn: number; b64: string }
  | { ev: "tcp_closed"; conn: number; error?: string };

/** Live facts about a room's sandbox, for the Ports and resources panel. */
export type SandboxStatus = {
  running: boolean;
  ports: number[];
  cpuPercent: number | null;
  memory: { usedMb: number; limitMb: number } | null;
  processes: { current: number; limit: number } | null;
};
