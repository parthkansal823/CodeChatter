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

export const TEMPLATE_IDS = ["blank", "python", "node", "web", "dsa", "interview", "tour", "kubernetes", "react", "fastapi", "vue", "svelte", "express-postgres", "flask", "django", "nextjs", "sveltekit", "astro", "solid", "fastify", "hono", "nuxt", "angular", "nestjs", "gin", "axum", "spring-boot", "laravel"] as const;

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
  /** "interview" rooms belong to an interview (GET rooms/:id/interview). */
  kind: "workspace" | "interview";
  /** "owner/name" when the room was made from a GitHub repository. */
  repo: string | null;
  visibility: "private" | "public";
  joinPolicy: "invite" | "approval" | "open";
  role: z.infer<typeof RoomRoleSchema>;
  memberCount: number;
  members: RoomMemberPreview[];
  updatedAt: string;
  lastActiveAt: string;
  /** The room it was forked from (it may have been deleted since). */
  forkedFrom?: { id: string; name: string } | null;
};

/** Change a room's name, description, who can see it, or how people join (owners and managers). */
export const UpdateRoomInput = z
  .object({
    name: z.string().trim().min(1, "Give the room a name.").max(80, "Keep it under 80 characters.").optional(),
    description: z.string().trim().max(280).optional(),
    visibility: z.enum(["private", "public"]).optional(),
    joinPolicy: z.enum(["invite", "approval", "open"]).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Nothing to change.");
export type UpdateRoomInput = z.infer<typeof UpdateRoomInput>;

/** A public room, for the Explore page. */
export type ExploreRoom = {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  owner: string | null;
  memberCount: number;
  lastActiveAt: string;
  forkedFrom: { id: string; name: string } | null;
};

/** Fork a room: a new room of yours, its code copied in by your browser (the room's own files document). */
export const ForkRoomInput = z.object({
  name: z.string().trim().min(1, "Give the room a name.").max(80, "Keep it under 80 characters."),
});
export type ForkRoomInput = z.infer<typeof ForkRoomInput>;

/** A room's call: where LiveKit is, a token to join it with, and LiveKit's name for it. */
export type CallJoin = { url: string; token: string; room: string };

export type CreatedRoom = RoomSummary & { inviteToken: string; imported?: RepoImportSummary };

export type JoinResult =
  | { status: "joined"; room: RoomSummary }
  | { status: "pending"; roomName: string }
  /** The owner removed them, or declined their request. They stay out until the owner lets them back. */
  | { status: "refused"; roomName: string };

/** The roles an owner can give someone (see assignableRoles). */
export const MemberRoleInput = z.object({ role: z.enum(["editor", "runner", "viewer"]) });
export type MemberRoleInput = z.infer<typeof MemberRoleInput>;

/** A person's user id, in a route. */
export const PersonId = z.string().min(1).max(128);

export type RoomPerson = {
  id: string;
  name: string;
  image: string | null;
  role: z.infer<typeof RoomRoleSchema>;
  /** Only for people waiting: names can be anything, and the owner has to know who's asking. */
  email?: string;
};

/** A room's people, for whoever manages it. */
export type RoomPeople = { members: RoomPerson[]; waiting: RoomPerson[]; removed: RoomPerson[] };

/** The token in a room's invite link (/rooms/CODE?invite=token). */
export type RoomInviteLink = { token: string };
