/** Shared unread cursors, literal chat search shapes and safe display helpers keep the API and every device consistent. */
import { z } from "zod";

import type { ChatMessage } from "./chat.js";
import { RoomCode } from "./rooms.js";

/** Counts saturate at 100 because the interface displays everything above 99 as 99+. */
export function capChatUnreadCount(count: number): number {
  if (count === Infinity) return 100;
  return Number.isFinite(count) ? Math.max(0, Math.min(100, Math.floor(count))) : 0;
}

export function chatUnreadLabel(count: number): string {
  const capped = capChatUnreadCount(count);
  return capped > 99 ? "99+" : String(capped);
}

/** A removed author's normal messages survive the user FK and still belong to someone other than the reader. */
export function isCountedChatMessage(message: Pick<ChatMessage, "author" | "kind">, readerId: string): boolean {
  return message.author?.id !== readerId && message.kind !== "system" && message.kind !== "github";
}

/** Spaces separate literal AND terms; punctuation, percent and underscore stay literal. */
export function chatSearchTerms(query: string): string[] {
  return [...new Set(query.trim().split(/\s+/u).filter(Boolean).map((term) => term.toLowerCase()))];
}

/** Plain text parts, never injected HTML. Overlapping matches are merged so every literal match is marked. */
export function highlightChatSearch(text: string, query: string): Array<{ text: string; match: boolean }> {
  const terms = chatSearchTerms(query);
  if (!terms.length || !text) return [{ text, match: false }];
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?=(${escaped.join("|")}))`, "giu");
  const ranges: Array<[number, number]> = [];
  for (const found of text.matchAll(pattern)) {
    const start = found.index, end = start + found[1]!.length;
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let from = 0;
  for (const [start, end] of ranges) {
    if (start > from) parts.push({ text: text.slice(from, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    from = end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

export const MarkChatReadInput = z.object({ messageId: z.uuid() });
export type MarkChatReadInput = z.infer<typeof MarkChatReadInput>;

export const ChatSearchQuery = z.object({
  q: z.string().trim().min(1, "Write a word to search for.").max(200, "Use a shorter search."),
  before: z.uuid().optional(),
});
export type ChatSearchQuery = z.infer<typeof ChatSearchQuery>;

export const ChatUnreadState = z.object({
  roomId: RoomCode,
  count: z.number().int().min(0).max(100),
  readThroughId: z.uuid().nullable(),
  firstUnreadId: z.uuid().nullable(),
});
export type ChatUnreadState = z.infer<typeof ChatUnreadState>;
export type ChatUnreadList = { rooms: ChatUnreadState[] };
export type ChatSearchPage = { messages: ChatMessage[]; hasMore: boolean; nextBefore: string | null };
export type ChatMessageContext = { messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
export type ChatUnreadEvent = { roomId: string; reason: "message" | "read" | "deleted" };

/** The existing socket event interfaces are open, so adding this event needs no edit to unrelated chat contracts. */
declare module "./chat.js" {
  interface ServerToClientEvents {
    "chat:unread": (event: ChatUnreadEvent) => void;
  }
}
