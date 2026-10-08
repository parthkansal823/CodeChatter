import type { ChatMessage } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { DB } from "../infra/tokens.js";

type Row = { message: typeof schema.messages.$inferSelect; author: { id: string; name: string; image: string | null } | null };

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
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async create(input: { roomId: string; userId: string; body: string; clientId: string }): Promise<ChatMessage> {
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
    // Keep the room's "last active" fresh for the dashboard.
    await db.update(schema.rooms).set({ lastActiveAt: new Date() }).where(eq(schema.rooms.id, input.roomId));
    const author = await db.query.user.findFirst({
      where: eq(schema.user.id, input.userId),
      columns: { id: true, name: true, image: true },
    });
    return toDto({ message: message!, author: author ? { ...author, image: author.image ?? null } : null }, input.clientId);
  }

  /** Newest first, `limit` at a time; pass the oldest id you have to page back. uuidv7 ids sort by time. */
  async list(roomId: string, options: { before?: string; limit: number }): Promise<ChatMessage[]> {
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
        ),
      )
      .orderBy(desc(schema.messages.id))
      .limit(options.limit);
    return rows.map((row) => toDto({ message: row.message, author: row.author?.id ? { ...row.author, image: row.author.image ?? null } : null }));
  }
}
