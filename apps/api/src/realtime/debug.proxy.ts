import type { Auth, OriginPolicy } from "@codechatter/auth";
import { can, RoomCode } from "@codechatter/contracts";
import { Logger } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

import type { RoomsService } from "../rooms/rooms.service.js";
import type { RunnerClient } from "../runner/runner.client.js";

/** Biggest message either way: a long variables list, a big output chunk. */
const MAX_MESSAGE = 8 * 1024 * 1024;

/**
 * The room's debugger: /ws/debug?room=ID (same origin via Caddy, so the session cookie
 * comes with the upgrade). Everyone in the room can watch the shared session; people
 * with Run rights drive it (start, step, evaluate), which the runner enforces from the
 * mode this proxy gives it. Messages pass through as they are.
 */
export function attachDebugProxy(server: Server, deps: { auth: Auth; origins: OriginPolicy; rooms: RoomsService; runner: RunnerClient }) {
  const logger = new Logger("DebugProxy");
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://api");
    if (url.pathname !== "/ws/debug") return;
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
      let drive: boolean;
      try {
        const { role } = await deps.rooms.require(room.data, session.user.id, "room.view");
        drive = can(role, "code.run");
      } catch {
        return reject("403 Forbidden");
      }
      const user = { id: session.user.id, name: session.user.name };
      wss.handleUpgrade(req, socket, head, (client) => pipe(client, room.data, drive, user));
    })().catch((error: unknown) => {
      logger.warn(`debugger upgrade failed: ${String(error)}`);
      reject("500 Internal Server Error");
    });
  });

  function pipe(client: WebSocket, roomId: string, drive: boolean, user: { id: string; name: string }) {
    const upstream = new WebSocket(deps.runner.debugUrl(roomId, drive), { headers: deps.runner.headers(roomId, user), maxPayload: MAX_MESSAGE });
    const early: string[] = [];
    upstream.on("open", () => {
      for (const message of early.splice(0)) upstream.send(message);
    });
    upstream.on("message", (data) => client.readyState === WebSocket.OPEN && client.send(data.toString()));
    upstream.on("close", () => client.close(1000));
    upstream.on("error", () => client.close(1011, "The debugger isn't reachable."));
    client.on("message", (data) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
      else if (upstream.readyState === WebSocket.CONNECTING) early.push(data.toString());
    });
    client.on("close", () => upstream.close());
  }
}
