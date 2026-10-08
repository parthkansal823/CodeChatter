import type { AgentEvent } from "@codechatter/contracts";
import { Duplex } from "node:stream";

import type { AgentChannel } from "./agent-channel.js";

/**
 * A TCP connection to a port inside the sandbox, carried over the agent's
 * stdio. It behaves enough like a net.Socket for Node's HTTP client
 * (`createConnection`) and for piping WebSocket upgrades.
 */
export class TunnelStream extends Duplex {
  connected = false;

  constructor(
    readonly conn: number,
    private readonly agent: AgentChannel,
    private readonly onGone: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "tcp_data", conn: this.conn, b64: chunk.toString("base64") });
    callback();
  }

  override _read(): void {}

  override _final(callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "tcp_close", conn: this.conn });
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "tcp_close", conn: this.conn });
    this.onGone();
    callback(error);
  }

  // net.Socket methods the HTTP client may call; nothing to tune on a tunnel.
  setNoDelay(): this {
    return this;
  }
  setKeepAlive(): this {
    return this;
  }
  setTimeout(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

export class TunnelHub {
  private nextConn = 1;
  private readonly streams = new Map<number, { stream: TunnelStream; opened: { resolve: () => void; reject: (e: Error) => void } | null }>();

  constructor(private readonly agent: () => AgentChannel | null) {}

  /** Connect to 127.0.0.1:port inside the sandbox. */
  open(port: number, timeoutMs = 5000): Promise<TunnelStream> {
    const agent = this.agent();
    if (!agent?.alive) return Promise.reject(new Error("the sandbox isn't running"));
    const conn = this.nextConn++;
    const stream = new TunnelStream(conn, agent, () => this.streams.delete(conn));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.streams.delete(conn);
        reject(new Error(`nothing answered on port ${port}`));
      }, timeoutMs);
      this.streams.set(conn, {
        stream,
        opened: {
          resolve: () => (clearTimeout(timer), resolve(stream)),
          reject: (error) => (clearTimeout(timer), reject(error)),
        },
      });
      agent.send({ op: "tcp_open", conn, port });
    });
  }

  /** Tunnel events from the agent. */
  handle(event: Extract<AgentEvent, { ev: "tcp_connected" | "tcp_data" | "tcp_closed" }>): void {
    const entry = this.streams.get(event.conn);
    if (!entry) return;
    if (event.ev === "tcp_connected") {
      entry.stream.connected = true;
      entry.opened?.resolve();
      entry.opened = null;
    } else if (event.ev === "tcp_data") {
      entry.stream.push(Buffer.from(event.b64, "base64"));
    } else {
      this.streams.delete(event.conn);
      if (entry.opened) entry.opened.reject(new Error(event.error ?? "connection refused"));
      entry.stream.push(null);
      entry.stream.destroy();
    }
  }

  /** The agent went away (sandbox stopped or reset): every tunnel ends. */
  closeAll(): void {
    for (const [conn, entry] of this.streams) {
      this.streams.delete(conn);
      entry.opened?.reject(new Error("the sandbox restarted"));
      entry.stream.destroy();
    }
  }
}
