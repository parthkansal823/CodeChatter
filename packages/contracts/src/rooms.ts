import { z } from "zod";

import { RepoImport, type RepoImportSummary } from "./github.js";
import { ROOM_ROLES } from "./permissions.js";

/** Six characters, no look-alikes (0/O, 1/I/L), easy to read aloud. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RoomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, "Room codes are 6 letters and numbers.");

export const TEMPLATE_IDS = ["blank", "python", "node", "web", "dsa", "interview", "tour", "kubernetes", "react", "fastapi", "vue", "svelte", "express-postgres", "flask", "django"] as const;

export const CreateRoomInput = z.object({
  name: z.string().trim().min(1, "Give the room a name.").max(80, "Keep it under 80 characters."),
  description: z.string().trim().max(280).default(""),
  templateId: z.enum(TEMPLATE_IDS).default("blank"),
  visibility: z.enum(["private", "public"]).default("private"),
  joinPolicy: z.enum(["invite", "approval", "open"]).default("invite"),
  /** Start from a GitHub repository's files instead of a template. */
  repo: RepoImport.optional(),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInput>;

export const JoinRoomInput = z.object({
  code: RoomCode,
  inviteToken: z.string().min(16).max(128).optional(),
});
export type JoinRoomInput = z.infer<typeof JoinRoomInput>;

export const RoomRoleSchema = z.enum(ROOM_ROLES);

export type RoomMemberPreview = { id: string; name: string; image: string | null };

export type RoomSummary = {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  /** "owner/name" when the room was made from a GitHub repository. */
  repo: string | null;
  visibility: "private" | "public";
  joinPolicy: "invite" | "approval" | "open";
  role: z.infer<typeof RoomRoleSchema>;
  memberCount: number;
  members: RoomMemberPreview[];
  updatedAt: string;
  lastActiveAt: string;
};

export type CreatedRoom = RoomSummary & { inviteToken: string; imported?: RepoImportSummary };

export type JoinResult =
  | { status: "joined"; room: RoomSummary }
  | { status: "pending"; roomName: string };
