import { z } from "zod";

import { RoomCode } from "./rooms.js";
import type { RunExit, RunInfo, RunInput, RunSnapshot, RunStartInput } from "./run.js";

export const MAX_MESSAGE_LENGTH = 4000;

export const SendMessageInput = z.object({
  roomId: RoomCode,
  body: z.string().trim().min(1, "Write something first.").max(MAX_MESSAGE_LENGTH, "That message is too long."),
  /** Chosen by the sender so a retried send is recognised, not duplicated. */
  clientId: z.uuid(),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

export type ChatMessage = {
  id: string;
  roomId: string;
  clientId: string | null;
  author: { id: string; name: string; image: string | null } | null;
  /** "github": activity from the room's repository (api: github/webhook.controller.ts), with no author. */
  kind: "text" | "code" | "file" | "system" | "github";
  body: string;
  createdAt: string;
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

/** Socket.IO events, typed on both ends (apps/api gateway, apps/web client). */
export interface ServerToClientEvents {
  "chat:message": (message: ChatMessage) => void;
  "run:started": (run: RunInfo) => void;
  "run:output": (event: { runId: string; data: string }) => void;
  "run:exit": (exit: RunExit) => void;
}

export interface ClientToServerEvents {
  "room:join": (roomId: string, ack: (result: Ack<null>) => void) => void;
  "room:leave": (roomId: string) => void;
  "chat:send": (input: SendMessageInput, ack: (result: Ack<ChatMessage>) => void) => void;
  "run:start": (input: RunStartInput, ack: (result: Ack<RunInfo>) => void) => void;
  "run:stop": (input: { roomId: string }, ack: (result: Ack<null>) => void) => void;
  "run:input": (input: RunInput) => void;
  "run:snapshot": (roomId: string, ack: (result: Ack<RunSnapshot>) => void) => void;
}
