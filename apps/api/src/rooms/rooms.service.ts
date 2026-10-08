import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import {
  ROOM_CODE_ALPHABET,
  can,
  type CreateRoomInput,
  type CreatedRoom,
  type JoinResult,
  type RoomAction,
  type RoomRole,
  type RoomSummary,
} from "@codechatter/contracts";
import type { DbHandle } from "@codechatter/db";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { DB } from "../infra/tokens.js";
import { RoomsRepository } from "./rooms.repository.js";

type RoomRow = NonNullable<Awaited<ReturnType<RoomsRepository["findById"]>>>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  return code;
}

@Injectable()
export class RoomsService {
  constructor(
    private readonly rooms: RoomsRepository,
    @Inject(DB) private readonly handle: DbHandle,
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
    return { ...found, role: effective as RoomRole };
  }

  async list(userId: string): Promise<RoomSummary[]> {
    const rows = await this.rooms.listForUser(userId);
    const members = await this.rooms.membersFor(rows.map((r) => r.room.id));
    return rows.map(({ room, role }) => this.summarize(room, role, members.filter((m) => m.roomId === room.id)));
  }

  async create(session: AuthSession, input: CreateRoomInput): Promise<CreatedRoom> {
    const userId = session.user.id;
    const orgId = session.session.activeOrganizationId ?? (await ensurePersonalOrg(this.handle.db, session.user));
    if (!(await this.rooms.isOrgMember(orgId, userId))) {
      throw new ForbiddenException("You're not a member of that organisation.");
    }

    const inviteToken = randomBytes(24).toString("base64url");
    for (let attempt = 0; ; attempt++) {
      try {
        const room = await this.rooms.createWithOwner(
          {
            id: newRoomCode(),
            orgId,
            name: input.name,
            description: input.description,
            templateId: input.templateId,
            visibility: input.visibility,
            joinPolicy: input.joinPolicy,
            inviteTokenHash: sha256(inviteToken),
            createdBy: userId,
          },
          userId,
        );
        const me = { roomId: room.id, id: userId, name: session.user.name, image: session.user.image ?? null };
        return { ...this.summarize(room, "owner", [me]), inviteToken };
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
      return { status: "pending", roomName: room.name };
    }
    await this.rooms.addMember(room.id, userId, role, "active");
    return { status: "joined", room: await this.summaryFor(room, role) };
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
    return this.summarize(room, role, await this.rooms.membersFor([room.id]));
  }

  private summarize(
    room: RoomRow,
    role: RoomRole,
    members: Array<{ id: string; name: string; image: string | null }>,
  ): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      templateId: room.templateId,
      visibility: room.visibility,
      joinPolicy: room.joinPolicy,
      role,
      memberCount: members.length,
      members: members.slice(0, 5).map(({ id, name, image }) => ({ id, name, image })),
      updatedAt: room.updatedAt.toISOString(),
      lastActiveAt: room.lastActiveAt.toISOString(),
    };
  }
}
