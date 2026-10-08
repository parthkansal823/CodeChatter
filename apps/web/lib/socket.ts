"use client";

import type { ClientToServerEvents, ServerToClientEvents } from "@codechatter/contracts";
import { io, type Socket } from "socket.io-client";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * One Socket.IO connection per tab, same-origin through Caddy, so the session
 * cookie authenticates it. Reconnects on its own with backoff.
 */
export function getSocket(): AppSocket {
  socket ??= io({ path: "/socket.io", transports: ["websocket"], withCredentials: true, reconnectionDelayMax: 5000 });
  return socket;
}
