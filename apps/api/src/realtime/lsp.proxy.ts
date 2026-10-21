import type { Auth, OriginPolicy } from "@codechatter/auth";
import { RoomCode } from "@codechatter/contracts";
import { Logger } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

import type { RoomsService } from "../rooms/rooms.service.js";
import type { RunnerClient } from "../runner/runner.client.js";

/** Languages with a language server in the sandbox image (the runner's lsp.ts has the same list). */
export const LSP_LANGUAGES = new Set(["python", "c", "cpp", "go", "rust"]);
/** Biggest message either way: a whole file's text, a long completion list. */
const MAX_MESSAGE = 8 * 1024 * 1024;

/**
 * IntelliSense: /ws/lsp?room=ID&language=python (same origin via Caddy, so the session
 * cookie comes with the upgrade). The API checks the Origin, the session and the
 * `files.edit` permission (it's for people writing code; the server runs in the sandbox),
 * then pipes the socket to a language server the runner starts, message for message.
 */
export function attachLspProxy(server: Server, deps: { auth: Auth; origins: OriginPolicy; rooms: RoomsService; runner: RunnerClient }) {
  const logger = new Logger("LspProxy");
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://api");
    if (url.pathname !== "/ws/lsp") return;
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    void (async () => {
      if (!deps.origins.isAllowed(req.headers.origin)) return reject("403 Forbidden");
      const session = await deps.auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
      if (!session) return reject("401 Unauthorized");
      const room = RoomCode.safeParse(url.searchParams.get("room"));
      const language = url.searchParams.get("language") ?? "";
      if (!room.success || !LSP_LANGUAGES.has(language)) return reject("404 Not Found");
      try {
        await deps.rooms.require(room.data, session.user.id, "files.edit");
      } catch {
        return reject("403 Forbidden");
      }
      const user = { id: session.user.id, name: session.user.name };
      wss.handleUpgrade(req, socket, head, (client) => pipe(client, room.data, language, user));
    })().catch((error: unknown) => {
      logger.warn(`language server upgrade failed: ${String(error)}`);
      reject("500 Internal Server Error");
    });
  });

  function pipe(client: WebSocket, roomId: string, language: string, user: { id: string; name: string }) {
    const upstream = new WebSocket(deps.runner.lspUrl(roomId, language), { headers: deps.runner.headers(roomId, user), maxPayload: MAX_MESSAGE });
    const early: string[] = [];
    upstream.on("open", () => {
      for (const message of early.splice(0)) upstream.send(message);
    });
    upstream.on("message", (data) => client.readyState === WebSocket.OPEN && client.send(data.toString()));
    // The runner's own codes (4404: this sandbox has no server for the language) come through with their reason.
    upstream.on("close", (code, reason) => client.close(code >= 4000 && code < 5000 ? code : 1000, reason.toString()));
    upstream.on("error", () => client.close(1011, "The language server isn't reachable."));
    client.on("message", (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
      else if (upstream.readyState === WebSocket.CONNECTING) early.push(data.toString());
    });
    client.on("close", () => upstream.close());
  }
}
