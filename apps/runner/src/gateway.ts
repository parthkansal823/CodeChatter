/**
 * The AI gateway's runner side: HTTP requests from code in the sandbox, arriving over the agent's stdio, passed to the API as this
 * room. The room comes from which sandbox's channel it arrived on, never from anything the code sent, and only the API holds a key.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Duplex, Readable } from "node:stream";
import type { ReadableStream as WebReadable } from "node:stream/web";

import { signServiceToken } from "@codechatter/auth/service-token";
import type { AgentEvent } from "@codechatter/contracts";

import type { AgentChannel } from "./agent-channel.js";

const ROUTES = new Set(["GET /v1/models", "POST /v1/chat/completions", "POST /v1/embeddings"]);
const MOST_BODY_BYTES = 5 * 1024 * 1024;
/** What an OpenAI client expects a failure to look like, so it prints the message. */
const failure = (message: string, type: string) => JSON.stringify({ error: { message, type, param: null, code: null } });

/** One connection from inside the sandbox, as a stream an HTTP server can read. */
class GatewayStream extends Duplex {
  constructor(
    private readonly conn: number,
    private readonly agent: AgentChannel,
    private readonly onGone: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "gw_data", conn: this.conn, b64: chunk.toString("base64") });
    callback();
  }

  override _read(): void {}

  override _final(callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "gw_close", conn: this.conn });
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.agent.send({ op: "gw_close", conn: this.conn });
    this.onGone();
    callback(error);
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MOST_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class GatewayHub {
  private readonly streams = new Map<number, GatewayStream>();
  private readonly server: Server;
  /** Chat calls answered so far: how Evals tells how far it's got. */
  chats = 0;

  constructor(
    private readonly roomId: string,
    private readonly settings: { apiUrl: string; secret: string },
    private readonly agent: () => AgentChannel | null,
  ) {
    // Never listens: connections are handed to it (Node's documented way to serve any Duplex stream).
    this.server = createServer((req, res) => void this.serve(req, res));
  }

  handle(event: Extract<AgentEvent, { ev: "gw_open" | "gw_data" | "gw_closed" }>): void {
    if (event.ev === "gw_open") {
      const agent = this.agent();
      if (!agent?.alive) return;
      const stream = new GatewayStream(event.conn, agent, () => this.streams.delete(event.conn));
      this.streams.set(event.conn, stream);
      this.server.emit("connection", stream);
      return;
    }
    const stream = this.streams.get(event.conn);
    if (!stream) return;
    if (event.ev === "gw_data") {
      stream.push(Buffer.from(event.b64, "base64"));
    } else {
      this.streams.delete(event.conn);
      stream.push(null);
      stream.destroy();
    }
  }

  /** The agent went away (sandbox stopped or reset). */
  closeAll(): void {
    for (const [conn, stream] of this.streams) {
      this.streams.delete(conn);
      stream.destroy();
    }
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://gateway").pathname.replace(/\/+$/, "");
    if (!ROUTES.has(`${req.method} ${path}`)) {
      res.writeHead(404, { "content-type": "application/json" }).end(failure(`This address only has ${[...ROUTES].join(", ")}.`, "invalid_request_error"));
      return;
    }
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined;
      if (body === null) {
        res.writeHead(413, { "content-type": "application/json", connection: "close" }).end(failure("That's too much to send at once.", "invalid_request_error"));
        return;
      }
      const token = signServiceToken(this.settings.secret, { aud: "api", sub: this.roomId }, 120);
      const answer = await fetch(`${this.settings.apiUrl}/api/internal/ai-gateway${path}`, {
        method: req.method ?? "GET",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body && { body }),
        signal: gone.signal,
      });
      const headers: Record<string, string> = { "content-type": answer.headers.get("content-type") ?? "application/json", "cache-control": "no-cache" };
      const retry = answer.headers.get("retry-after");
      if (retry) headers["retry-after"] = retry;
      res.writeHead(answer.status, headers);
      if (answer.body) {
        for await (const chunk of Readable.fromWeb(answer.body as WebReadable<Uint8Array>)) res.write(chunk);
      }
      res.end();
      if (path === "/v1/chat/completions") this.chats += 1;
    } catch {
      if (gone.signal.aborted) return;
      if (res.headersSent) res.destroy();
      else res.writeHead(502, { "content-type": "application/json" }).end(failure("Couldn't reach CodeChatter's AI gateway. Try again.", "api_error"));
    }
  }
}
