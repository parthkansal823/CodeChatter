import type { RoomRole } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { DB } from "../infra/tokens.js";

type RoomRow = typeof schema.rooms.$inferSelect;
type NewRoom = typeof schema.rooms.$inferInsert;
type NewRoomRepo = typeof schema.roomRepos.$inferInsert;
export type MemberRow = typeof schema.roomMembers.$inferSelect;
type MemberStatus = MemberRow["status"];

/** A room-row lock covers every membership check and write made through this scoped writer. */
export type LockedRoomPeople = {
  room: RoomRow;
  members: MemberRow[];
  setMember(userId: string, from: MemberStatus[], set: { role?: RoomRole; status?: MemberStatus }): Promise<MemberRow | undefined>;
  deleteMember(userId: string, from: MemberStatus[]): Promise<boolean>;
};

/** Room queries and guarded membership transactions; services authorize scoped writes. */
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

  /** Room + owner membership (and the repository it's made from) in one transaction: a room never exists ownerless. */
  async createWithOwner(room: NewRoom, ownerId: string, repo?: Omit<NewRoomRepo, "roomId">, role: "owner" | "interviewer" = "owner"): Promise<RoomRow> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.rooms).values(room).returning();
      await tx.insert(schema.roomMembers).values({ roomId: created!.id, userId: ownerId, role });
      if (repo) await tx.insert(schema.roomRepos).values({ ...repo, roomId: created!.id });
      return created!;
    });
  }

  /** One of the room's settings (null removes it), leaving the others. */
  async setSetting(roomId: string, key: string, value: unknown): Promise<void> {
    const patch = value === null ? sql`${schema.rooms.settings} - ${key}` : sql`${schema.rooms.settings} || ${JSON.stringify({ [key]: value })}::jsonb`;
    await this.db.update(schema.rooms).set({ settings: patch }).where(eq(schema.rooms.id, roomId));
  }

  async addMember(roomId: string, userId: string, role: RoomRole, status: "active" | "pending"): Promise<void> {
    await this.db.insert(schema.roomMembers).values({ roomId, userId, role, status }).onConflictDoNothing();
  }

  /** Everyone with a row in the room, oldest first: members, people waiting, people removed. */
  people(roomId: string) {
    return this.db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        role: schema.roomMembers.role,
        status: schema.roomMembers.status,
      })
      .from(schema.roomMembers)
      .innerJoin(schema.user, eq(schema.roomMembers.userId, schema.user.id))
      .where(eq(schema.roomMembers.roomId, roomId))
      .orderBy(asc(schema.roomMembers.createdAt));
  }

  async personName(userId: string): Promise<string> {
    const row = await this.db.query.user.findFirst({ where: eq(schema.user.id, userId), columns: { name: true } });
    return row?.name ?? "Someone";
  }

  /**
   * Serialise membership changes, including checks of the caller's current role.
   * Locking the room, rather than an individual owner, covers changes to different
   * owner rows on different API instances. The scoped writers always keep an
   * active owner, even if a caller forgets the UI's last-owner check.
   */
  async withPeopleLock<T>(roomId: string, work: (people: LockedRoomPeople) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).for("update");
      if (!room) throw new NotFoundException("Room not found.");
      const members = await tx.select().from(schema.roomMembers).where(eq(schema.roomMembers.roomId, roomId));
      const keepOwner = (before: MemberRow, role?: RoomRole, status?: MemberStatus) => {
        if (before.role !== "owner" || before.status !== "active" || (role === "owner" && status === "active")) return;
        if (members.filter((member) => member.role === "owner" && member.status === "active").length <= 1) {
          throw new ConflictException("This room needs an owner. Make another active member an owner or hand the room over first.");
        }
      };
      return work({
        room,
        members,
        setMember: async (userId, from, set) => {
          const index = members.findIndex((member) => member.userId === userId && from.includes(member.status));
          const before = members[index];
          if (!before) return undefined;
          keepOwner(before, set.role ?? before.role, set.status ?? before.status);
          const [row] = await tx.update(schema.roomMembers).set({ ...set, updatedAt: new Date() })
            .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId), inArray(schema.roomMembers.status, from))).returning();
          if (row) members.splice(index, 1, row);
          return row;
        },
        deleteMember: async (userId, from) => {
          const index = members.findIndex((member) => member.userId === userId && from.includes(member.status));
          const before = members[index];
          if (!before) return false;
          keepOwner(before);
          const rows = await tx.delete(schema.roomMembers)
            .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId), inArray(schema.roomMembers.status, from)))
            .returning({ userId: schema.roomMembers.userId });
          if (rows.length) members.splice(index, 1);
          return rows.length > 0;
        },
      });
    });
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
  /** "owner/name" of the repository each room was made from, for rooms made from one. */
  async reposFor(roomIds: string[]): Promise<Map<string, string>> {
    if (roomIds.length === 0) return new Map();
    const rows = await this.db
      .select({ roomId: schema.roomRepos.roomId, owner: schema.roomRepos.owner, name: schema.roomRepos.name })
      .from(schema.roomRepos)
      .where(inArray(schema.roomRepos.roomId, roomIds));
    return new Map(rows.map((row) => [row.roomId, `${row.owner}/${row.name}`]));
  }

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
