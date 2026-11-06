import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import {
  ROOM_CODE_ALPHABET,
  can,
  type CreateRoomInput,
  type CreatedRoom,
  type ExploreRoom,
  type ForkRoomInput,
  type JoinResult,
  type RoomAction,
  type RoomRole,
  type RoomSummary,
  type UpdateRoomInput,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";

import { GithubService } from "../github/github.service.js";
import { DB } from "../infra/tokens.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { RunnerClient } from "../runner/runner.client.js";
import { RoomsRepository } from "./rooms.repository.js";

type RoomRow = NonNullable<Awaited<ReturnType<RoomsRepository["findById"]>>>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

/** The image a room's settings name ("default" when they don't). */
export function sandboxImageOf(room: { settings: Record<string, unknown> }): "base" | "full" | "default" {
  const image = room.settings.sandboxImage;
  return image === "base" || image === "full" ? image : "default";
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly rooms: RoomsRepository,
    private readonly github: GithubService,
    @Inject(DB) private readonly handle: DbHandle,
    private readonly runner: RunnerClient,
    private readonly notifications: NotificationsService,
  ) {}

  /** The caller's role in a room, or null. Private rooms 404 for outsiders. */
  async roleIn(roomId: string, userId: string): Promise<{ room: RoomRow; role: RoomRole | null }> {
    const room = await this.rooms.findById(roomId);
    if (!room) throw new NotFoundException("Room not found.");
    const member = await this.rooms.findMember(roomId, userId);
    const role = member?.status === "active" ? member.role : null;
    // Don't confirm a private room exists to someone who isn't in it.
    if (!role && room.visibility === "private") throw new NotFoundException("Room not found.");
    return { room, role };
  }

  async require(roomId: string, userId: string, action: RoomAction) {
    const found = await this.roleIn(roomId, userId);
    // Visitors to public rooms act as viewers without being members.
    const effective = found.role ?? (found.room.visibility === "public" ? "viewer" : null);
    if (!can(effective, action)) throw new ForbiddenException("You don't have access to do that in this room.");
    // Whatever the caller does next with the runner goes with the room's image.
    this.runner.noteImage(found.room.id, sandboxImageOf(found.room));
    return { ...found, role: effective as RoomRole };
  }

  /** The owner picks the room's sandbox image (base or full), or goes back to the server's default. */
  async setSandboxImage(roomId: string, image: "base" | "full" | "default"): Promise<void> {
    await this.rooms.setSetting(roomId, "sandboxImage", image === "default" ? null : image);
    this.runner.noteImage(roomId, image);
  }

  async list(userId: string): Promise<RoomSummary[]> {
    const rows = await this.rooms.listForUser(userId);
    const ids = rows.map((r) => r.room.id);
    const [members, repos] = await Promise.all([this.rooms.membersFor(ids), this.rooms.reposFor(ids)]);
    return rows.map(({ room, role }) => this.summarize(room, role, members.filter((m) => m.roomId === room.id), repos.get(room.id) ?? null));
  }

  async create(session: AuthSession, input: CreateRoomInput): Promise<CreatedRoom> {
    const userId = session.user.id;
    const orgId = session.session.activeOrganizationId ?? (await ensurePersonalOrg(this.handle.db, session.user));
    if (!(await this.rooms.isOrgMember(orgId, userId))) {
      throw new ForbiddenException("You're not a member of that organisation.");
    }

    // Download first: a repository that can't be imported leaves no empty room behind.
    const repo = input.repo ? await this.github.download(userId, input.repo) : null;
    const repoRow = repo && {
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      defaultBranch: repo.defaultBranch,
      commitSha: repo.commitSha,
      files: gzipSync(JSON.stringify(repo.files)),
      importedBy: userId,
    };

    const inviteToken = randomBytes(24).toString("base64url");
    for (let attempt = 0; ; attempt++) {
      try {
        const room = await this.rooms.createWithOwner(
          {
            id: newRoomCode(),
            orgId,
            name: input.name,
            description: input.description,
            templateId: repo ? "blank" : input.templateId,
            visibility: input.visibility,
            joinPolicy: input.joinPolicy,
            inviteTokenHash: sha256(inviteToken),
            createdBy: userId,
          },
          userId,
          repoRow ?? undefined,
        );
        const me = { roomId: room.id, id: userId, name: session.user.name, image: session.user.image ?? null };
        const imported = repo && {
          repo: `${repo.owner}/${repo.name}`,
          branch: repo.branch,
          commit: repo.commitSha,
          files: repo.files.length,
          skipped: repo.skipped,
          truncated: repo.truncated,
        };
        return { ...this.summarize(room, "owner", [me], imported?.repo ?? null), inviteToken, ...(imported && { imported }) };
      } catch (error) {
        // 31^6 ≈ 887M codes; a collision is rare, so retry a few times.
        if ((error as { code?: string }).code === "23505" && attempt < 5) continue;
        throw error;
      }
    }
  }

  async join(session: AuthSession, code: string, inviteToken?: string): Promise<JoinResult> {
    const userId = session.user.id;
    const room = await this.rooms.findById(code);
    if (!room) throw new NotFoundException("No room has that code. Check it and try again.");

    const existing = await this.rooms.findMember(room.id, userId);
    if (existing?.status === "active") return { status: "joined", room: await this.summaryFor(room, existing.role) };
    if (existing?.status === "pending") return { status: "pending", roomName: room.name };

    const tokenValid =
      Boolean(inviteToken && room.inviteTokenHash) &&
      timingSafeEqual(Buffer.from(sha256(inviteToken!)), Buffer.from(room.inviteTokenHash!));

    let role: RoomRole;
    if (tokenValid) role = "editor";
    else if (room.visibility === "public" && room.joinPolicy !== "invite") role = "viewer";
    else if (room.visibility === "public") throw new ForbiddenException("This room needs an invite link to join.");
    else throw new NotFoundException("No room has that code. Check it and try again.");

    if (room.joinPolicy === "approval") {
      await this.rooms.addMember(room.id, userId, role, "pending");
      void this.notifications.notifyOwners(room.id, userId, "room.requested", role).catch(() => {});
      return { status: "pending", roomName: room.name };
    }
    await this.rooms.addMember(room.id, userId, role, "active");
    void this.notifications.notifyOwners(room.id, userId, "room.joined", role).catch(() => {});
    return { status: "joined", room: await this.summaryFor(room, role) };
  }

  /** Change the room's name, description, visibility or join policy. */
  async update(roomId: string, userId: string, input: UpdateRoomInput): Promise<RoomSummary> {
    const { role } = await this.require(roomId, userId, "room.manage");
    const set = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    await this.handle.db.update(schema.rooms).set({ ...set, updatedAt: new Date() }).where(eq(schema.rooms.id, roomId));
    const room = await this.rooms.findById(roomId);
    return this.summaryFor(room!, role!);
  }

  /** Public rooms, most recently active first; `q` narrows by name or description. */
  async explore(q: string | undefined, before: string | undefined): Promise<ExploreRoom[]> {
    const { rooms, user, roomMembers } = schema;
    const words = q?.trim().slice(0, 80);
    const rows = await this.handle.db
      .select({
        id: rooms.id,
        name: rooms.name,
        description: rooms.description,
        templateId: rooms.templateId,
        settings: rooms.settings,
        lastActiveAt: rooms.lastActiveAt,
        owner: user.name,
        memberCount: sql<number>`(select count(*)::int from ${roomMembers} m where m.room_id = ${rooms.id} and m.status = 'active')`,
      })
      .from(rooms)
      .leftJoin(user, eq(rooms.createdBy, user.id))
      .where(
        and(
          eq(rooms.visibility, "public"),
          isNull(rooms.archivedAt),
          words ? or(ilike(rooms.name, `%${escapeLike(words)}%`), ilike(rooms.description, `%${escapeLike(words)}%`)) : undefined,
          before ? lt(rooms.lastActiveAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(rooms.lastActiveAt))
      .limit(30);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      templateId: row.templateId,
      owner: row.owner,
      memberCount: row.memberCount,
      lastActiveAt: row.lastActiveAt.toISOString(),
      forkedFrom: forkedFromOf(row),
    }));
  }

  /**
   * A new room of yours from one you can see (its files are copied in by your browser,
   * which has them): private and blank to begin with, and it remembers where it came from.
   */
  async fork(session: AuthSession, sourceId: string, input: ForkRoomInput): Promise<CreatedRoom> {
    const { room: source } = await this.require(sourceId, session.user.id, "room.view");
    if (source.kind === "interview") throw new ForbiddenException("An interview room can't be forked.");
    const created = await this.create(session, { name: input.name, description: source.description, templateId: "blank", visibility: "private", joinPolicy: "invite" } as CreateRoomInput);
    const forkedFrom = { id: source.id, name: source.name };
    await this.rooms.setSetting(created.id, "forkedFrom", forkedFrom);
    return { ...created, forkedFrom };
  }

  /** Everyone in the room (active members): for @mentions and the like. */
  async members(roomId: string, userId: string): Promise<Array<{ id: string; name: string; image: string | null; role: RoomRole }>> {
    await this.require(roomId, userId, "room.view");
    const rows = await this.handle.db
      .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image, role: schema.roomMembers.role })
      .from(schema.roomMembers)
      .innerJoin(schema.user, eq(schema.roomMembers.userId, schema.user.id))
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.status, "active")));
    return rows.map((row) => ({ ...row, image: row.image ?? null }));
  }

  async get(roomId: string, userId: string): Promise<RoomSummary> {
    const { room, role } = await this.require(roomId, userId, "room.view");
    return this.summaryFor(room, role);
  }

  async remove(roomId: string, userId: string): Promise<RoomRow> {
    const { room } = await this.require(roomId, userId, "room.delete");
    await this.rooms.deleteRoom(roomId);
    return room;
  }

  private async summaryFor(room: RoomRow, role: RoomRole): Promise<RoomSummary> {
    const [members, repos] = await Promise.all([this.rooms.membersFor([room.id]), this.rooms.reposFor([room.id])]);
    return this.summarize(room, role, members, repos.get(room.id) ?? null);
  }

  private summarize(
    room: RoomRow,
    role: RoomRole,
    members: Array<{ id: string; name: string; image: string | null }>,
    repo: string | null,
  ): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      templateId: room.templateId,
      kind: room.kind,
      repo,
      visibility: room.visibility,
      joinPolicy: room.joinPolicy,
      role,
      memberCount: members.length,
      members: members.slice(0, 5).map(({ id, name, image }) => ({ id, name, image })),
      updatedAt: room.updatedAt.toISOString(),
      lastActiveAt: room.lastActiveAt.toISOString(),
      forkedFrom: forkedFromOf(room),
    };
  }
}

/** Where a room was forked from, when its settings say so. */
function forkedFromOf(room: { settings: Record<string, unknown> }): { id: string; name: string } | null {
  const value = room.settings?.forkedFrom as { id?: unknown; name?: unknown } | undefined;
  return value && typeof value.id === "string" && typeof value.name === "string" ? { id: value.id, name: value.name } : null;
}

/** A LIKE pattern's own wildcards, taken literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
