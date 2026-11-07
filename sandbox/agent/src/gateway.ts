import { createServer, type Server, type Socket } from "node:net";

import type { AgentEvent, TunnelOp } from "@codechatter/contracts";

/** Where code in the sandbox finds the room's model: OPENAI_BASE_URL in every terminal and Run (apps/runner/src/sandbox.ts). */
export const GATEWAY_PORT = 3129;
const MOST_CONNECTIONS = 64;

/**
 * The AI gateway's way out: connections to 127.0.0.1:3129 inside the sandbox, carried over the agent's stdio to the runner, which
 * knows which room they're from. The sandbox has no network and holds no key, and code in it can't speak on this channel itself.
 */
export class Gateway {
  private next = 1;
  private readonly sockets = new Map<number, Socket>();

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  start(): Server {
    const server = createServer((socket) => {
      const conn = this.next++;
      this.sockets.set(conn, socket);
      this.emit({ ev: "gw_open", conn });
      socket.on("data", (chunk) => this.emit({ ev: "gw_data", conn, b64: chunk.toString("base64") }));
      socket.on("error", () => socket.destroy());
      socket.on("close", () => {
        if (this.sockets.delete(conn)) this.emit({ ev: "gw_closed", conn });
      });
    });
    server.maxConnections = MOST_CONNECTIONS;
    // If the port is taken, calls fail the way they would without the gateway.
    server.on("error", () => {});
    server.listen(GATEWAY_PORT, "127.0.0.1");
    return server;
  }

  handle(op: Extract<TunnelOp, { op: "gw_data" | "gw_close" }>): void {
    const socket = this.sockets.get(op.conn);
    if (!socket) return;
    if (op.op === "gw_data") socket.write(Buffer.from(op.b64, "base64"));
    else socket.end();
  }
}
