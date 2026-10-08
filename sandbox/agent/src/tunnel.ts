import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";

import type { AgentEvent, TunnelOp } from "@codechatter/contracts";

/**
 * TCP connections to servers inside the sandbox, carried over the agent's
 * stdio (spike S2: works with the container's network switched off). The
 * runner turns them into HTTP and WebSocket proxies for live preview.
 */
export class Tunnels {
  private readonly sockets = new Map<number, Socket>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  handle(op: TunnelOp): void {
    if (op.op === "tcp_open") {
      const socket = connect({ host: "127.0.0.1", port: op.port });
      this.sockets.set(op.conn, socket);
      socket.on("connect", () => this.emit({ ev: "tcp_connected", conn: op.conn }));
      socket.on("data", (chunk) => this.emit({ ev: "tcp_data", conn: op.conn, b64: chunk.toString("base64") }));
      socket.on("error", (error) => this.close(op.conn, error.message));
      socket.on("close", () => this.close(op.conn));
    } else if (op.op === "tcp_data") {
      this.sockets.get(op.conn)?.write(Buffer.from(op.b64, "base64"));
    } else {
      this.sockets.get(op.conn)?.end();
    }
  }

  private close(conn: number, error?: string): void {
    const socket = this.sockets.get(conn);
    if (!socket) return;
    this.sockets.delete(conn);
    socket.destroy();
    this.emit({ ev: "tcp_closed", conn, ...(error && { error }) });
  }
}

/** Listening TCP ports, from /proc/net/tcp and tcp6 (state 0A = LISTEN). */
export async function listeningPorts(): Promise<number[]> {
  const ports = new Set<number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const line of text.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] !== "0A" || !fields[1]) continue;
      const port = Number.parseInt(fields[1].split(":").at(-1) ?? "", 16);
      if (port > 0) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** Report the listening ports whenever they change. */
export function watchPorts(emit: (event: AgentEvent) => void, intervalMs = 1500): void {
  let last = "";
  const tick = async () => {
    const ports = await listeningPorts();
    const key = ports.join(",");
    if (key !== last) {
      last = key;
      emit({ ev: "ports", ports });
    }
  };
  void tick();
  setInterval(() => void tick(), intervalMs);
}
