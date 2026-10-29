import { Agent, request, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import { log } from "./log.js";
import type { RoomSession } from "./room-session.js";

/** /rooms/:id/preview/:port/<path> — the API forwards preview-origin traffic here. */
export const PREVIEW_PATH = /^\/rooms\/([A-Z0-9]{6})\/preview\/(\d{2,5})(\/.*)?$/;

const HOP_BY_HOP = new Set(["authorization", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade"]);

/** Request headers for the dev server: our auth removed, Host rewritten so Vite and friends accept it. */
function forwardHeaders(req: IncomingMessage, port: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
  }
  headers.host = `localhost:${port}`;
  return headers;
}

function notListening(res: ServerResponse, port: number, reason: string): void {
  res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", refresh: "3" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waiting for port ${port}</title>
<body style="font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#444">
<div style="max-width:28rem;padding:2rem"><p style="font-weight:600;color:#111">Nothing is answering on port ${port} yet</p>
<p>Start your server in the room (press Run, or use the terminal), make sure it listens on port ${port}, and this page reloads by itself.</p>
<p style="font-size:13px;color:#888">${reason.replace(/[<>&]/g, "")}</p></div></body>`);
}

/**
 * The HTTP agent for one request: it hands out that request's own tunnel and never keeps
 * it. Node's global agent keeps sockets for reuse (keep-alive, since Node 19) under one
 * name for every room ("localhost:80"), so a later request, perhaps for another room's
 * preview, could be sent down an earlier request's tunnel while its own tunnel leaked;
 * with a page's dozens of module requests at once (SvelteKit's), some never came back.
 */
class TunnelAgent extends Agent {
  constructor(private readonly tunnel: Duplex) {
    super({ keepAlive: false, maxSockets: 1 });
  }

  override createConnection(): Duplex {
    return this.tunnel;
  }
}

/** HTTP request to a dev server inside the sandbox, over the agent tunnel. */
export async function proxyPreviewHttp(session: RoomSession, port: number, path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  await session.ready();
  session.touch();
  let tunnel: Duplex;
  try {
    tunnel = await session.tunnels.open(port);
  } catch (error) {
    return notListening(res, port, error instanceof Error ? error.message : "");
  }
  const upstream = request({
    method: req.method,
    path,
    headers: forwardHeaders(req, port),
    agent: new TunnelAgent(tunnel),
  });
  upstream.on("response", (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) notListening(res, port, error.message);
    else res.destroy();
  });
  req.pipe(upstream);
}

/** WebSocket upgrade (hot reload in Vite, Next, webpack) passed through byte for byte. */
export async function proxyPreviewUpgrade(session: RoomSession, port: number, path: string, req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  await session.ready();
  let tunnel: Duplex;
  try {
    tunnel = await session.tunnels.open(port);
  } catch {
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    return;
  }
  const lines = [`${req.method} ${path} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!;
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "host") continue;
    lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
  }
  lines.push(`Host: localhost:${port}`);
  tunnel.write(`${lines.join("\r\n")}\r\n\r\n`);
  if (head.length) tunnel.write(head);
  socket.pipe(tunnel).pipe(socket);
  const close = () => {
    socket.destroy();
    tunnel.destroy();
  };
  socket.on("error", close);
  tunnel.on("error", close);
  socket.on("close", close);
  tunnel.on("close", close);
  log.info(`preview websocket to port ${port} in ${session.roomId}`);
}
