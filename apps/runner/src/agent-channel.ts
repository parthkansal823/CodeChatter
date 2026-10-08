import type { AgentEvent, AgentOp, TunnelOp } from "@codechatter/contracts";
import type Docker from "dockerode";
import { PassThrough, type Duplex } from "node:stream";

import { log } from "./log.js";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentRequest = DistributiveOmit<AgentOp, "id">;

/**
 * The runner's end of the agent protocol: JSON lines over the container's
 * attached stdin/stdout (packages/contracts/src/sandbox.ts). Requests get an
 * id and resolve when the agent answers "ok" for it; everything else the
 * agent says (file changes) goes to `onEvent`.
 */
export class AgentChannel {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = "";
  private closed = false;
  private readyWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    private readonly stream: Duplex,
    modem: Docker["modem"],
    private readonly onEvent: (event: AgentEvent) => void,
  ) {
    // A non-TTY attach multiplexes stdout and stderr with 8-byte frame headers.
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    modem.demuxStream(stream, stdout, stderr);
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => this.onData(chunk));
    stderr.on("data", (chunk: Buffer) => log.warn(`agent stderr: ${chunk.toString().trim()}`));
    stream.on("end", () => this.close(new Error("agent stream ended")));
    stream.on("close", () => this.close(new Error("agent stream closed")));
    stream.on("error", (error: Error) => this.close(error));
  }

  get alive(): boolean {
    return !this.closed;
  }

  /** Resolves on the agent's "ready" line (sent once, right after the container starts). */
  waitReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sandbox agent did not start")), timeoutMs);
      this.readyWaiter = {
        resolve: () => (clearTimeout(timer), resolve()),
        reject: (error) => (clearTimeout(timer), reject(error)),
      };
    });
  }

  request(op: AgentRequest, timeoutMs = 30_000): Promise<void> {
    if (this.closed) return Promise.reject(new Error("sandbox agent is not connected"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sandbox agent timed out on ${op.op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.stream.write(`${JSON.stringify({ ...op, id })}\n`);
    });
  }

  /** Fire-and-forget message (tunnel traffic). */
  send(op: TunnelOp): void {
    if (!this.closed) this.stream.write(`${JSON.stringify(op)}
`);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  close(reason = new Error("sandbox agent closed")): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    this.pending.clear();
    this.readyWaiter?.reject(reason);
    this.stream.destroy();
    for (const listener of this.closeListeners) listener();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (let newline = this.buffer.indexOf("\n"); newline !== -1; newline = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let event: AgentEvent;
      try {
        event = JSON.parse(line) as AgentEvent;
      } catch {
        log.warn(`agent sent an unreadable line: ${line.slice(0, 200)}`);
        continue;
      }
      this.dispatch(event);
    }
  }

  private dispatch(event: AgentEvent): void {
    if (event.ev === "ready") {
      this.readyWaiter?.resolve();
      this.readyWaiter = null;
    } else if ((event.ev === "ok" || event.ev === "error") && event.id !== undefined && this.pending.has(event.id)) {
      const waiter = this.pending.get(event.id)!;
      this.pending.delete(event.id);
      clearTimeout(waiter.timer);
      if (event.ev === "ok") waiter.resolve();
      else waiter.reject(new Error(event.message));
    } else if (event.ev === "error") {
      log.warn(`agent: ${event.message}`);
    } else {
      this.onEvent(event);
    }
  }
}
