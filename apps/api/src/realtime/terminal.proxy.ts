import type { Auth, OriginPolicy } from "@codechatter/auth";
import { RoomCode, type TerminalServerMessage } from "@codechatter/contracts";
import { Logger } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

import type { RoomsService } from "../rooms/rooms.service.js";
import type { RunnerClient } from "../runner/runner.client.js";

/** Most terminals one person may have open in a room. */
export const MAX_TERMINALS = 4;

/**
 * Browser terminals: /ws/terminal?room=ID&n=1..4&cols&rows (same origin via
 * Caddy, so the session cookie comes with the upgrade). The API checks the
 * Origin, the session and the `terminal.open` permission, then pipes the
 * socket to the runner with a service token. Session names come from the
 * user id, so nobody can attach to someone else's terminal.
 */
export function attachTerminalProxy(server: Server, deps: { auth: Auth; origins: OriginPolicy; rooms: RoomsService; runner: RunnerClient }) {
  const logger = new Logger("TerminalProxy");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://api");
    if (url.pathname !== "/ws/terminal") return; // Socket.IO handles its own path
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    void (async () => {
      if (!deps.origins.isAllowed(req.headers.origin)) return reject("403 Forbidden");
      const session = await deps.auth.api.getSession({ headers: fromNodeHeaders(req.headers) }).catch(() => null);
      if (!session) return reject("401 Unauthorized");
      const room = RoomCode.safeParse(url.searchParams.get("room"));
      if (!room.success) return reject("404 Not Found");
      try {
        await deps.rooms.require(room.data, session.user.id, "terminal.open");
      } catch {
        return reject("403 Forbidden");
      }
      const n = Math.min(MAX_TERMINALS, Math.max(1, Number(url.searchParams.get("n")) || 1));
      const cols = Number(url.searchParams.get("cols")) || 80;
      const rows = Number(url.searchParams.get("rows")) || 24;
      // Your own terminal n, your Task terminal (tasks.json and npm scripts run there), or the
      // room's shared dev server session (its .codechatter/room.json). All need terminal rights,
      // checked above; the dev session is a shell like any other.
      const shared = url.searchParams.get("shared");
      const you = `u${session.user.id.replace(/[^a-zA-Z0-9]/g, "")}`;
      const name = shared === "dev" ? "dev" : `${you}-${shared === "task" ? "task" : n}`.slice(0, 40);
      const user = { id: session.user.id, name: session.user.name };
      wss.handleUpgrade(req, socket, head, (client) => pipe(client, room.data, name, cols, rows, user));
    })().catch((error: unknown) => {
      logger.warn(`terminal upgrade failed: ${String(error)}`);
      reject("500 Internal Server Error");
    });
  });

  function pipe(client: WebSocket, roomId: string, name: string, cols: number, rows: number, user: { id: string; name: string }) {
    const upstream = new WebSocket(deps.runner.terminalUrl(roomId, name, cols, rows), { headers: deps.runner.headers(roomId, user) });
    const early: Array<{ data: WebSocket.RawData; binary: boolean }> = [];
    const status = (message: TerminalServerMessage) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify(message));

    upstream.on("open", () => {
      for (const { data, binary } of early.splice(0)) upstream.send(data, { binary });
    });
    upstream.on("message", (data, binary) => client.readyState === WebSocket.OPEN && client.send(data, { binary }));
    upstream.on("close", () => client.close(1000));
    upstream.on("error", () => {
      status({ t: "status", state: "closed", message: "The terminal service isn't reachable. In development, keep `pnpm dev` running with Docker Desktop started." });
      client.close(1011);
    });
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else if (upstream.readyState === WebSocket.CONNECTING) early.push({ data, binary });
    });
    client.on("close", () => upstream.close());
  }
}
