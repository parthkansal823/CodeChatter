import {
  capChatUnreadCount,
  chatSearchTerms,
  type ChatMessage,
  type ChatMessageContext,
  type ChatSearchPage,
  type ChatSearchQuery,
  type ChatUnreadEvent,
  type ChatUnreadList,
  type ChatUnreadState,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, gt, ilike, isNull, lt, sql } from "drizzle-orm";

import { DB } from "../infra/tokens.js";
import { chatUnreadQuery, escapeChatLike, markChatReadQuery } from "./messages.helpers.js";

type Row = {
  message: typeof schema.messages.$inferSelect;
  author: { id: string; name: string; image: string | null } | null;
};

const toDto = ({ message, author }: Row, clientId: string | null = null): ChatMessage => ({
  id: message.id,
  roomId: message.roomId,
  clientId: clientId ?? message.clientId ?? null,
  author,
  kind: message.kind,
  body: message.body,
  createdAt: message.createdAt.toISOString(),
});

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private unreadPush: ((userId: string, event: ChatUnreadEvent) => void) | null = null;

  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Personal invalidations use the gateway's existing cross-instance user channels. */
  setUnreadPush(push: (userId: string, event: ChatUnreadEvent) => void): void {
    this.unreadPush = push;
  }

  async create(input: {
    roomId: string;
    userId: string;
    body: string;
    clientId: string;
  }): Promise<ChatMessage> {
    const { db } = this.handle;
    const [inserted] = await db
      .insert(schema.messages)
      .values({ roomId: input.roomId, userId: input.userId, body: input.body, clientId: input.clientId })
      .onConflictDoNothing({ target: [schema.messages.roomId, schema.messages.clientId] })
      .returning();
    // A retry of a send that already landed returns the original message.
    const message =
      inserted ??
      (await db.query.messages.findFirst({
        where: and(eq(schema.messages.roomId, input.roomId), eq(schema.messages.clientId, input.clientId)),
      }));
    if (!message || message.deletedAt) throw new NotFoundException("Message not found.");
    if (message.userId !== input.userId)
      throw new ConflictException("That send identifier is already in use. Try sending again.");
    // Keep the room's "last active" fresh for the dashboard.
    await db.update(schema.rooms).set({ lastActiveAt: new Date() }).where(eq(schema.rooms.id, input.roomId));
    const author = await db.query.user.findFirst({
      where: eq(schema.user.id, message.userId),
      columns: { id: true, name: true, image: true },
    });
    if (inserted) await this.invalidateRoom(input.roomId, "message");
    return toDto(
      { message, author: author ? { ...author, image: author.image ?? null } : null },
      input.clientId,
    );
  }

  /** A message with no author, from the room's integrations (GitHub activity). */
  async post(roomId: string, kind: "github" | "system" | "automation", body: string): Promise<ChatMessage> {
    const [message] = await this.handle.db.insert(schema.messages).values({ roomId, kind, body }).returning();
    await this.handle.db
      .update(schema.rooms)
      .set({ lastActiveAt: new Date() })
      .where(eq(schema.rooms.id, roomId));
    await this.invalidateRoom(roomId, "message");
    return toDto({ message: message!, author: null });
  }

  /** History remains newest-first; `after` takes the nearest newer page before reversing it. */
  async list(
    roomId: string,
    options: { before?: string; after?: string; limit: number },
  ): Promise<ChatMessage[]> {
    const messages = await this.items(roomId, { ...options, ascending: Boolean(options.after) });
    return options.after ? messages.reverse() : messages;
  }

  /** All active dashboard memberships in one SQL statement, never a query per room. */
  async unread(userId: string): Promise<ChatUnreadList> {
    const rows = await this.handle.db.execute<ChatUnreadState>(chatUnreadQuery(userId));
    return { rooms: rows.map((row) => ({ ...row, count: capChatUnreadCount(Number(row.count)) })) };
  }

  /** Register an authorized reader without advancing their cursor, including public nonmembers. */
  async unreadInRoom(roomId: string, userId: string): Promise<ChatUnreadState> {
    await this.handle.db.insert(schema.roomChatReads).values({ roomId, userId }).onConflictDoNothing();
    return this.roomUnreadState(roomId, userId);
  }

  async markRead(roomId: string, userId: string, messageId: string): Promise<ChatUnreadState> {
    const written = await this.handle.db.execute<{ readThroughId: string }>(
      markChatReadQuery(roomId, userId, messageId),
    );
    if (!written.length) throw new NotFoundException("Message not found.");
    // Invalidate every device, even if this request was an older cursor: the database is authoritative.
    this.unreadPush?.(userId, { roomId, reason: "read" });
    return this.roomUnreadState(roomId, userId);
  }

  async search(roomId: string, query: ChatSearchQuery): Promise<ChatSearchPage> {
    const found = await this.items(roomId, { before: query.before, search: query.q, limit: 51 });
    const messages = found.slice(0, 50);
    return {
      messages,
      hasMore: found.length > 50,
      nextBefore: found.length > 50 ? messages.at(-1)!.id : null,
    };
  }

  /** Validate the target in this room before returning any of its surrounding messages. */
  async context(roomId: string, around: string): Promise<ChatMessageContext> {
    const [target] = await this.items(roomId, { messageId: around, limit: 1 });
    if (!target) throw new NotFoundException("Message not found.");
    const [older, newer] = await Promise.all([
      this.items(roomId, { before: around, limit: 26 }),
      this.items(roomId, { after: around, ascending: true, limit: 26 }),
    ]);
    return {
      messages: [...older.slice(0, 25).reverse(), target, ...newer.slice(0, 25)],
      hasMoreBefore: older.length > 25,
      hasMoreAfter: newer.length > 25,
    };
  }

  /** Delete only the caller's own message; retaining its UUID keeps existing read cursors valid. */
  async deleteOwn(roomId: string, userId: string, messageId: string): Promise<{ ok: true }> {
    const removed = await this.handle.db
      .update(schema.messages)
      .set({ deletedAt: sql`coalesce(${schema.messages.deletedAt}, now())` })
      .where(
        and(
          eq(schema.messages.roomId, roomId),
          eq(schema.messages.id, messageId),
          eq(schema.messages.userId, userId),
        ),
      )
      .returning({ id: schema.messages.id });
    if (!removed.length) throw new NotFoundException("Message not found.");
    await this.invalidateRoom(roomId, "deleted");
    return { ok: true };
  }

  /** Membership changes invalidate old dashboard counts without disclosing any new room content. */
  async unreadAccessChanged(roomId: string, userId?: string): Promise<void> {
    if (userId) this.unreadPush?.(userId, { roomId, reason: "read" });
    else {
      const readers = await this.handle.db
        .select({ userId: schema.roomChatReads.userId })
        .from(schema.roomChatReads)
        .where(eq(schema.roomChatReads.roomId, roomId));
      for (const reader of readers) this.unreadPush?.(reader.userId, { roomId, reason: "read" });
      await this.invalidateRoom(roomId, "read");
    }
  }

  private async roomUnreadState(roomId: string, userId: string): Promise<ChatUnreadState> {
    const [row] = await this.handle.db.execute<ChatUnreadState>(chatUnreadQuery(userId, roomId));
    if (!row) throw new NotFoundException("Room not found.");
    return { ...row, count: capChatUnreadCount(Number(row.count)) };
  }

  /** Current members and currently public readers only; stale private read rows receive no message event. */
  private async invalidateRoom(roomId: string, reason: ChatUnreadEvent["reason"]): Promise<void> {
    if (!this.unreadPush) return;
    try {
      const readers = await this.handle.db.execute<{ userId: string }>(sql`
        select membership.user_id as "userId" from room_members membership
        inner join rooms room on room.id = membership.room_id
        where membership.room_id = ${roomId} and membership.status = 'active' and room.archived_at is null
        union
        select reads.user_id as "userId" from room_chat_reads reads
        inner join rooms room on room.id = reads.room_id
        where reads.room_id = ${roomId} and room.visibility = 'public' and room.archived_at is null`);
      for (const reader of readers) this.unreadPush(reader.userId, { roomId, reason });
    } catch {
      // A completed send/delete must not appear to fail because live delivery was unavailable.
      this.logger.warn("Chat unread refresh could not be delivered; clients will refresh on reconnect.");
    }
  }

  private async items(
    roomId: string,
    options: {
      before?: string;
      after?: string;
      messageId?: string;
      search?: string;
      ascending?: boolean;
      limit: number;
    },
  ): Promise<ChatMessage[]> {
    const rows = await this.handle.db
      .select({
        message: schema.messages,
        author: { id: schema.user.id, name: schema.user.name, image: schema.user.image },
      })
      .from(schema.messages)
      .leftJoin(schema.user, eq(schema.messages.userId, schema.user.id))
      .where(
        and(
          eq(schema.messages.roomId, roomId),
          isNull(schema.messages.deletedAt),
          options.before ? lt(schema.messages.id, options.before) : undefined,
          options.after ? gt(schema.messages.id, options.after) : undefined,
          options.messageId ? eq(schema.messages.id, options.messageId) : undefined,
          ...chatSearchTerms(options.search ?? "").map((term) =>
            ilike(schema.messages.body, `%${escapeChatLike(term)}%`),
          ),
        ),
      )
      .orderBy(options.ascending ? asc(schema.messages.id) : desc(schema.messages.id))
      .limit(options.limit);
    return rows.map((row) =>
      toDto({
        message: row.message,
        author: row.author?.id ? { ...row.author, image: row.author.image ?? null } : null,
      }),
    );
  }
}
