import { signServiceToken, verifyServiceToken } from "@codechatter/auth/service-token";
import { RoomCode } from "@codechatter/contracts";
import { Logger } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { request, type IncomingHttpHeaders, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { Redis } from "ioredis";

import type { Env } from "../config/env.js";
import type { RoomsService } from "../rooms/rooms.service.js";
import type { LiveSockets } from "../realtime/live-sockets.js";
import type { RunnerClient } from "../runner/runner.client.js";
import { previewBridge } from "./preview-bridge.js";

/**
 * Live preview of dev servers running in a room's sandbox, on their own
 * origin: http://p3000-team22.preview.localhost:8080 (PREVIEW_ORIGIN in
 * production is a separate domain). The app's session cookie never reaches
 * that origin, so a page someone else wrote can't act as you in the app.
 *
 *   1. The app asks POST /api/rooms/:id/preview { port } for a link (room.view).
 *   2. The link carries a one-time, one-minute ticket: /__cc/auth?t=…
 *   3. That becomes a host-only cookie for this room and port only.
 *   4. Every request is checked (cookie + current room access) and forwarded
 *      to the runner, which tunnels it into the sandbox.
 *
 * The room's own browser shows the same pages in a frame (web components/room/browser). Its link asks for a cookie that works there (SameSite=None,
 * partitioned to the room's site), its pages may be framed by the app and nothing else, and each gets the bridge script (preview-bridge.ts), which tells
 * the room where it is, its console, its requests, and what was clicked in "click to code".
 */
const BRIDGE = "/__cc/bridge.js";
/** Pages bigger than this are passed on as they are, without the bridge. */
const MOST_PAGE_BYTES = 10 * 1024 * 1024;

/** Where to go after the link, if it's a path on this server. */
function safePath(to: string | null): string {
  return to && to.startsWith("/") && !to.startsWith("//") && !to.includes("\\") && to.length <= 2000 ? to : "/";
}

/** A page with the bridge in its head, so it runs before the page's own scripts. */
export function withBridge(html: string): string {
  const tag = `<script src="${BRIDGE}"></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  const top = /<html(\s[^>]*)?>/i.exec(html);
  if (top) return html.slice(0, top.index + top[0].length) + tag + html.slice(top.index + top[0].length);
  return tag + html;
}

/** A framed page's headers: the room's site may frame it, and nothing else; its own frame rules would stop the room showing it. */
export function framedHeaders(headers: IncomingHttpHeaders, appOrigin: string): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = { ...headers };
  delete out["x-frame-options"];
  for (const name of ["content-security-policy", "content-security-policy-report-only"] as const) {
    const policy = out[name];
    if (typeof policy !== "string") continue;
    const kept = policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !/^frame-ancestors\b/i.test(part));
    out[name] = kept.length ? kept.join("; ") : undefined;
    if (!kept.length) delete out[name];
  }
  out["content-security-policy"] = [out["content-security-policy"], `frame-ancestors ${appOrigin}`].filter(Boolean).join("; ");
  return out;
}

function decoded(body: Buffer, encoding: string | undefined): Buffer | null {
  try {
    if (!encoding || encoding === "identity") return body;
    if (encoding === "gzip" || encoding === "x-gzip") return gunzipSync(body);
    if (encoding === "br") return brotliDecompressSync(body);
    if (encoding === "deflate") return inflateSync(body);
    return null;
  } catch {
    return null;
  }
}
const COOKIE = "cc_preview";
const HOST = /^p(\d{2,5})-([a-z0-9]{6})\.(.+)$/;

export type PreviewTarget = { roomId: string; port: number };

export class PreviewHosts {
  private readonly origin: URL | null;

  constructor(previewOrigin: string | undefined) {
    this.origin = previewOrigin ? new URL(previewOrigin) : null;
  }

  get enabled(): boolean {
    return this.origin !== null;
  }

  url(target: PreviewTarget, path = "/"): string {
    if (!this.origin) throw new Error("PREVIEW_ORIGIN is not configured");
    return `${this.origin.protocol}//p${target.port}-${target.roomId.toLowerCase()}.${this.origin.host}${path}`;
  }

  /** The room and port a Host header points at, if it's one of our preview hosts. */
  parse(host: string | undefined): PreviewTarget | null {
    if (!this.origin || !host) return null;
    const match = HOST.exec(host.toLowerCase());
    if (!match || match[3] !== this.origin.host) return null;
    const roomId = match[2]!.toUpperCase();
    const port = Number(match[1]);
    if (!RoomCode.safeParse(roomId).success || port < 1 || port > 65535) return null;
    return { roomId, port };
  }

  get secure(): boolean {
    return this.origin?.protocol === "https:";
  }
}

type Deps = { env: Env; hosts: PreviewHosts; rooms: RoomsService; runner: RunnerClient; redis: Redis; live: LiveSockets };

export function createPreviewTicket(deps: Pick<Deps, "env" | "hosts">, target: PreviewTarget, user: { id: string; name: string }, options: { path?: string; frame?: boolean } = {}): string {
  const ticket = signServiceToken(deps.env.SERVICE_SECRET, { aud: "preview", sub: `${target.roomId}:${target.port}`, uid: user.id, name: user.name }, 60);
  const extra = `${options.path && options.path !== "/" ? `&to=${encodeURIComponent(safePath(options.path))}` : ""}${options.frame ? "&frame=1" : ""}`;
  return deps.hosts.url(target, `/__cc/auth?t=${encodeURIComponent(ticket)}${extra}`);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** The request's Cookie header without our own preview cookie (the dev server has no business seeing it). */
function withoutOurCookie(header: string | undefined): string | undefined {
  const kept = (header ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${COOKIE}=`));
  return kept.length ? kept.join("; ") : undefined;
}

export function previewProxy(deps: Deps) {
  const logger = new Logger("PreviewProxy");
  const access = new Map<string, number>(); // `${uid}:${room}` → allowed until (ms)
  // Rights changed: what's remembered is out of date.
  deps.live.onChange(({ roomId, userId }) => {
    for (const key of access.keys()) if (userId ? key === `${userId}:${roomId}` : key.endsWith(`:${roomId}`)) access.delete(key);
  });

  /** Cookie valid for this exact room and port, and the person still has access. */
  async function viewer(req: IncomingMessage, target: PreviewTarget): Promise<{ id: string; name: string } | null> {
    const claims = verifyServiceToken(deps.env.SERVICE_SECRET, readCookie(req.headers.cookie, COOKIE), "preview");
    if (!claims || claims.sub !== `${target.roomId}:${target.port}` || !claims.uid) return null;
    const key = `${claims.uid}:${target.roomId}`;
    if ((access.get(key) ?? 0) < Date.now()) {
      try {
        await deps.rooms.require(target.roomId, claims.uid, "room.view");
      } catch {
        return null;
      }
      access.set(key, Date.now() + 30_000);
      if (access.size > 10_000) access.clear();
    }
    return { id: claims.uid, name: claims.name ?? "Someone" };
  }

  function forwardHeaders(req: IncomingMessage, target: PreviewTarget, user: { id: string; name: string }) {
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers[name] = value;
    // Node rejects a header set to undefined, so drop Cookie when ours was the only one.
    const cookie = withoutOurCookie(req.headers.cookie);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
    headers.authorization = deps.runner.headers(target.roomId, user).authorization!;
    return headers;
  }

  function runnerPath(target: PreviewTarget, url: string | undefined) {
    return `/rooms/${target.roomId}/preview/${target.port}${url && url.startsWith("/") ? url : "/"}`;
  }

  const runnerUrl = new URL(deps.env.RUNNER_URL);

  /** Express middleware: handles every request whose Host is a preview host. */
  const http = (req: Request, res: Response, next: NextFunction) => {
    const target = deps.hosts.parse(req.headers.host);
    if (!target) return next();
    void (async () => {
      const url = new URL(req.url, "http://preview");
      const appOrigin = new URL(deps.env.APP_URL).origin;
      if (url.pathname === BRIDGE) {
        res.status(200).set({ "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).send(previewBridge(appOrigin));
        return;
      }
      if (url.pathname === "/__cc/auth") {
        const ticket = url.searchParams.get("t") ?? "";
        const claims = verifyServiceToken(deps.env.SERVICE_SECRET, ticket, "preview");
        const fresh =
          claims?.sub === `${target.roomId}:${target.port}` &&
          (await deps.redis.set(`preview:ticket:${createHash("sha256").update(ticket).digest("hex")}`, "1", "EX", 120, "NX")) === "OK";
        if (!claims || !fresh) {
          res.status(403).type("text/plain").send("This preview link has expired. Open the preview again from the room.");
          return;
        }
        const cookie = signServiceToken(deps.env.SERVICE_SECRET, { aud: "preview", sub: claims.sub, uid: claims.uid, name: claims.name }, 12 * 3600);
        // In the room's browser the page is in a frame on another site: its cookie must be sent there (SameSite=None, which needs Secure: browsers
        // allow that on http://*.localhost too), kept to frames on the room's site (partitioned).
        const framed = url.searchParams.get("frame") === "1";
        res.cookie(COOKIE, cookie, framed ? { httpOnly: true, sameSite: "none", secure: true, partitioned: true, path: "/", maxAge: 12 * 3600 * 1000 } : { httpOnly: true, sameSite: "lax", secure: deps.hosts.secure, path: "/", maxAge: 12 * 3600 * 1000 });
        res.redirect(302, safePath(url.searchParams.get("to")));
        return;
      }
      const user = await viewer(req, target);
      if (!user) {
        res.status(403).type("text/plain").send("Open this preview from the room (you need access to the room).");
        return;
      }
      // A page shown in the room's browser: asked for uncompressed, so the bridge can go in it.
      const framed = req.headers["sec-fetch-dest"] === "iframe" && req.method === "GET";
      const headers = forwardHeaders(req, target, user);
      if (framed) headers["accept-encoding"] = "identity";
      const upstream = request({
        protocol: runnerUrl.protocol,
        hostname: runnerUrl.hostname,
        port: runnerUrl.port,
        method: req.method,
        path: runnerPath(target, req.url),
        headers,
      });
      upstream.on("response", (answer) => {
        const html = /^text\/html\b/i.test(String(answer.headers["content-type"] ?? ""));
        if (!framed || !html) {
          res.writeHead(answer.statusCode ?? 502, framed ? framedHeaders(answer.headers, appOrigin) : answer.headers);
          answer.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let passed = false;
        answer.on("data", (chunk: Buffer) => {
          if (passed) return;
          size += chunk.length;
          chunks.push(chunk);
          // Too big to hold: what's come so far, then the rest, as it is.
          if (size > MOST_PAGE_BYTES) {
            passed = true;
            res.writeHead(answer.statusCode ?? 502, framedHeaders(answer.headers, appOrigin));
            res.write(Buffer.concat(chunks));
            answer.pipe(res);
          }
        });
        answer.on("end", () => {
          if (passed) return;
          const raw = Buffer.concat(chunks);
          const body = decoded(raw, typeof answer.headers["content-encoding"] === "string" ? answer.headers["content-encoding"].toLowerCase() : undefined);
          const out = framedHeaders(answer.headers, appOrigin);
          if (!body) {
            res.writeHead(answer.statusCode ?? 502, out);
            res.end(raw);
            return;
          }
          const page = Buffer.from(withBridge(body.toString("utf8")), "utf8");
          delete out["content-encoding"];
          delete out["transfer-encoding"];
          out["content-length"] = String(page.length);
          res.writeHead(answer.statusCode ?? 502, out);
          res.end(page);
        });
        answer.on("error", () => res.destroy());
      });
      upstream.on("error", (error) => {
        logger.warn(`preview ${target.roomId}:${target.port}: ${error.message}`);
        if (!res.headersSent) res.status(502).type("text/plain").send("The sandbox preview isn't reachable right now.");
        else res.destroy();
      });
      req.pipe(upstream);
    })().catch((error: unknown) => {
      logger.warn(`preview failed: ${String(error)}`);
      if (res.headersSent) return;
      // Details help in development; production gets a plain message.
      const detail = deps.env.NODE_ENV === "production" ? "" : `\n\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
      res.status(500).type("text/plain").send(`The preview hit an unexpected error.${detail}`);
    });
  };

  /** WebSocket upgrades on preview hosts (dev-server hot reload). */
  const attach = (server: Server) => {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const target = deps.hosts.parse(req.headers.host);
      if (!target) return; // not a preview host: Socket.IO or the terminal proxy handle it
      void (async () => {
        const user = await viewer(req, target);
        if (!user) {
          socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          return;
        }
        const upstream = request({
          protocol: runnerUrl.protocol,
          hostname: runnerUrl.hostname,
          port: runnerUrl.port,
          method: req.method,
          path: runnerPath(target, req.url),
          headers: forwardHeaders(req, target, user),
        });
        upstream.on("upgrade", (answer, upstreamSocket, upstreamHead) => {
          const lines = [`HTTP/1.1 ${answer.statusCode ?? 101} ${answer.statusMessage ?? "Switching Protocols"}`];
          for (let i = 0; i < answer.rawHeaders.length; i += 2) lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`);
          socket.write(`${lines.join("\r\n")}\r\n\r\n`);
          if (upstreamHead.length) socket.write(upstreamHead);
          if (head.length) upstreamSocket.write(head);
          upstreamSocket.pipe(socket).pipe(upstreamSocket);
          const close = () => {
            socket.destroy();
            upstreamSocket.destroy();
          };
          socket.on("error", close);
          upstreamSocket.on("error", close);
          // Hot reload's socket stays open, so it ends when they can't look any more.
          const unwatch = deps.live.watch(target.roomId, user.id, () => true, close);
          socket.once("close", unwatch);
        });
        upstream.on("response", (answer) => socket.end(`HTTP/1.1 ${answer.statusCode ?? 502} Bad Gateway\r\nConnection: close\r\n\r\n`));
        upstream.on("error", () => socket.destroy());
        upstream.end();
      })().catch(() => socket.destroy());
    });
  };

  return { http, attach };
}
