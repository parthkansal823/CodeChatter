import { z } from "zod";

/**
 * Notifications (the inbox) and a room's activity feed. Someone mentioned you in a room's
 * chat, replied on a code comment of yours or started one where you're mentioned, joined a
 * room you own or asked to; unread ones arrive live and, an hour on, in an email digest.
 */
export const NOTIFICATION_TYPES = ["mention", "comment.reply", "comment.new", "room.joined", "room.requested", "room.approved", "room.declined", "room.removed", "room.role"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationPayload = {
  /** A few words of what was said (a chat message or a comment). */
  excerpt?: string;
  /** A code comment's thread, file and line. */
  threadId?: string;
  path?: string;
  line?: number;
  /** The role someone joined with, or asked for. */
  role?: string;
};

export type NotificationItem = {
  id: string;
  type: NotificationType;
  actor: { id: string; name: string; image: string | null } | null;
  room: { id: string; name: string } | null;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
};

export const MarkReadInput = z.union([z.object({ ids: z.array(z.uuid()).min(1).max(200) }), z.object({ all: z.literal(true) })]);
export type MarkReadInput = z.infer<typeof MarkReadInput>;

export const NotificationSettingsInput = z.object({ emailDigest: z.boolean() });
export type NotificationSettings = z.infer<typeof NotificationSettingsInput>;

/**
 * Tell people about a code comment (comments live in a Yjs document the API doesn't read,
 * so the browser that wrote it says who to tell; the API only tells people in the room).
 */
export const CommentNotifyInput = z.object({
  kind: z.enum(["reply", "new"]),
  threadId: z.string().min(1).max(64),
  recipients: z.array(z.string().min(1).max(64)).min(1).max(20),
  path: z.string().min(1).max(1000),
  line: z.number().int().min(1).max(10_000_000),
  excerpt: z.string().trim().min(1).max(280),
});
export type CommentNotifyInput = z.infer<typeof CommentNotifyInput>;

/** What happened in a room lately (newest first): edits by person, commits, checkpoints, joins, the repository's activity. */
export type RoomActivityItem = {
  at: string;
  kind: "edits" | "commit" | "publish" | "pull-request" | "checkpoint" | "joined" | "github" | "settings";
  who: string | null;
  text: string;
};

/** A notification in a sentence, for the inbox and the email digest. */
export function notificationText(item: Pick<NotificationItem, "type" | "actor" | "room" | "payload">): string {
  const who = item.actor?.name ?? "Someone";
  const room = item.room?.name ?? "a room";
  const quote = item.payload.excerpt ? `: “${item.payload.excerpt}”` : "";
  const at = item.payload.path ? `${item.payload.path}${item.payload.line ? `:${item.payload.line}` : ""}` : "the code";
  switch (item.type) {
    case "mention":
      return `${who} mentioned you in ${room}${quote}`;
    case "comment.reply":
      return `${who} replied on ${at} in ${room}${quote}`;
    case "comment.new":
      return `${who} mentioned you in a comment on ${at} in ${room}${quote}`;
    case "room.joined":
      return `${who} joined ${room}${item.payload.role ? ` as ${item.payload.role}` : ""}`;
    case "room.requested":
      return `${who} asked to join ${room}`;
    case "room.approved":
      return `${who} let you into ${room}${item.payload.role ? ` as ${item.payload.role}` : ""}`;
    case "room.declined":
      return `${who} declined your request to join ${room}`;
    case "room.removed":
      return `${who} removed you from ${room}`;
    case "room.role":
      return `${who} made you ${item.payload.role ?? "something else"} in ${room}`;
  }
}

/**
 * The people a message mentions: "@" then their name as it's shown (any case), not run
 * into more letters ("@ana" isn't "@anabel"). Names with spaces work ("@Ana Ruiz").
 */
export function mentionedIn<T extends { id: string; name: string }>(text: string, people: readonly T[]): T[] {
  const lower = text.toLowerCase();
  return people.filter(({ name }) => {
    const wanted = `@${name.trim().toLowerCase()}`;
    if (wanted.length < 2) return false;
    for (let at = lower.indexOf(wanted); at !== -1; at = lower.indexOf(wanted, at + 1)) {
      const before = at === 0 ? "" : lower[at - 1]!;
      const after = lower[at + wanted.length] ?? "";
      if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
    }
    return false;
  });
}
