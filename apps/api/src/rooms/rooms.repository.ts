import type { RoomRole } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { DB } from "../infra/tokens.js";

type RoomRow = typeof schema.rooms.$inferSelect;
type NewRoom = typeof schema.rooms.$inferInsert;
export type MemberRow = typeof schema.roomMembers.$inferSelect;

/** Queries only. Business rules live in RoomsService. */
@Injectable()
export class RoomsRepository {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  findById(id: string): Promise<RoomRow | undefined> {
    return this.db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) });
  }

  findMember(roomId: string, userId: string): Promise<MemberRow | undefined> {
    return this.db.query.roomMembers.findFirst({
      where: and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)),
    });
  }

  async isOrgMember(orgId: string, userId: string): Promise<boolean> {
    const row = await this.db.query.member.findFirst({
      where: and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
      columns: { id: true },
    });
    return Boolean(row);
  }

  /** Room + owner membership in one transaction: a room never exists ownerless. */
  async createWithOwner(room: NewRoom, ownerId: string): Promise<RoomRow> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.rooms).values(room).returning();
      await tx.insert(schema.roomMembers).values({ roomId: created!.id, userId: ownerId, role: "owner" });
      return created!;
    });
  }

  async addMember(roomId: string, userId: string, role: RoomRole, status: "active" | "pending"): Promise<void> {
    await this.db.insert(schema.roomMembers).values({ roomId, userId, role, status }).onConflictDoNothing();
  }

  async deleteRoom(id: string): Promise<void> {
    // FK cascades remove members, messages, checkpoints and notifications.
    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));
    await this.db.delete(schema.docUpdates).where(sql`${schema.docUpdates.docName} like ${`room:${id}:%`}`);
    await this.db.delete(schema.docSnapshots).where(sql`${schema.docSnapshots.docName} like ${`room:${id}:%`}`);
  }

  /** Rooms the user belongs to (active), most recently active first. */
  listForUser(userId: string) {
    return this.db
      .select({ room: schema.rooms, role: schema.roomMembers.role })
      .from(schema.roomMembers)
      .innerJoin(schema.rooms, eq(schema.roomMembers.roomId, schema.rooms.id))
      .where(
        and(
          eq(schema.roomMembers.userId, userId),
          eq(schema.roomMembers.status, "active"),
          isNull(schema.rooms.archivedAt),
        ),
      )
      .orderBy(desc(schema.rooms.lastActiveAt))
      .limit(200);
  }

  /** Active members for a set of rooms, oldest first (owners lead the preview). */
  membersFor(roomIds: string[]) {
    if (roomIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        roomId: schema.roomMembers.roomId,
        id: schema.user.id,
        name: schema.user.name,
        image: schema.user.image,
      })
      .from(schema.roomMembers)
      .innerJoin(schema.user, eq(schema.roomMembers.userId, schema.user.id))
      .where(and(inArray(schema.roomMembers.roomId, roomIds), eq(schema.roomMembers.status, "active")))
      .orderBy(asc(schema.roomMembers.createdAt));
  }
}
