/** A room's people, as its owner manages them: approving, declining, removing, changing roles, and leaving. */
import { assignableMemberRoles, assignableRoles, can, type NotificationType, type RoomPeople, type RoomRole } from "@codechatter/contracts";
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { NotificationsService } from "../notifications/notifications.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { terminalSessionPrefix } from "../realtime/terminal.proxy.js";
import { RunnerClient } from "../runner/runner.client.js";
import { RoomsRepository, type LockedRoomPeople } from "./rooms.repository.js";
import { RoomsService } from "./rooms.service.js";

type Actor = { id: string; name: string };
/** What the controller writes in the audit log. */
export type PeopleChange = { orgId: string; person: string; role?: RoomRole };

const NO_INTERVIEWS = "An interview decides who's in its room.";

/**
 * Rights changing reaches everything a person has open: RoomsService.accessChanged closes
 * their editor (collab), their terminals, language servers, debugger and hot reload
 * (LiveSockets), and takes them out of the call (CallsService). Each reconnects with what's
 * left, if anything. Their shells are killed here, so nothing they were typing carries on.
 *
 * Someone removed stays in the table as "removed", so the invite link they were given doesn't
 * let them straight back in. The owner can let them back (the row goes, and they're a
 * stranger again).
 */
@Injectable()
export class RoomPeopleService {
  private readonly logger = new Logger(RoomPeopleService.name);

  constructor(
    private readonly rooms: RoomsService,
    private readonly repository: RoomsRepository,
    private readonly notifications: NotificationsService,
    private readonly runner: RunnerClient,
    private readonly events: EventsGateway,
  ) {}

  private async manager(roomId: string, userId: string) {
    const found = await this.rooms.require(roomId, userId, "room.manage");
    if (found.room.kind === "interview") throw new ForbiddenException(NO_INTERVIEWS);
    return found;
  }

  private checkRole(managerRole: RoomRole, role: RoomRole): void {
    if (!assignableRoles(managerRole).includes(role)) throw new ForbiddenException("You can't give that role.");
  }

  /** The first check preserves normal access behavior; the locked check is the authority for writes. */
  private async write<T>(roomId: string, actor: Actor, action: "room.manage" | "room.view", work: (people: LockedRoomPeople, role: RoomRole) => Promise<T>): Promise<T> {
    await this.rooms.require(roomId, actor.id, action);
    return this.repository.withPeopleLock(roomId, async (people) => {
      const mine = people.members.find((member) => member.userId === actor.id && member.status === "active");
      if (!mine || !can(mine.role, action)) throw new ForbiddenException("You don't have access to do that in this room any more.");
      if (people.room.kind === "interview") throw new ForbiddenException(NO_INTERVIEWS);
      return work(people, mine.role);
    });
  }

  private async changed(roomId: string, userId: string): Promise<void> {
    await this.rooms.accessChanged(roomId, userId);
    this.events.peopleChanged(roomId);
  }

  private tell(roomId: string, actorId: string, userId: string, type: NotificationType, role?: RoomRole): void {
    void this.notifications.notify({ userIds: [userId], type, actorId, roomId, payload: role ? { role } : {} }).catch((error: unknown) => this.logger.warn(`people notification: ${String(error)}`));
  }

  private closeShells(roomId: string, actor: Actor, userId: string): void {
    void this.runner.closeTerminals(roomId, actor, terminalSessionPrefix(userId)).catch((error: unknown) => this.logger.warn(`closing terminals: ${String(error)}`));
  }

  async list(roomId: string, userId: string): Promise<RoomPeople> {
    await this.manager(roomId, userId);
    const rows = await this.repository.people(roomId);
    const person = (row: (typeof rows)[number]) => ({ id: row.id, name: row.name, image: row.image ?? null, role: row.role });
    return {
      members: rows.filter((row) => row.status === "active").map(person),
      waiting: rows.filter((row) => row.status === "pending").map((row) => ({ ...person(row), email: row.email })),
      removed: rows.filter((row) => row.status === "removed").map(person),
    };
  }

  async approve(roomId: string, actor: Actor, userId: string, role: RoomRole): Promise<PeopleChange> {
    const room = await this.write(roomId, actor, "room.manage", async (people, mine) => {
      this.checkRole(mine, role);
      if (!(await people.setMember(userId, ["pending"], { status: "active", role }))) throw new NotFoundException("They aren't waiting to join any more.");
      return people.room;
    });
    await this.changed(roomId, userId);
    this.tell(roomId, actor.id, userId, "room.approved", role);
    return { orgId: room.orgId, person: await this.repository.personName(userId), role };
  }

  async setRole(roomId: string, actor: Actor, userId: string, role: RoomRole): Promise<PeopleChange> {
    const { room, before } = await this.write(roomId, actor, "room.manage", async (people, mine) => {
      if (!assignableMemberRoles(mine).includes(role)) throw new ForbiddenException("You can't give that role.");
      const before = people.members.find((member) => member.userId === userId);
      if (!(await people.setMember(userId, ["active"], { role }))) throw new NotFoundException("They aren't in this room any more.");
      return { room: people.room, before };
    });
    await this.changed(roomId, userId);
    if (can(before?.role, "terminal.open") && !can(role, "terminal.open")) this.closeShells(roomId, actor, userId);
    this.tell(roomId, actor.id, userId, "room.role", role);
    return { orgId: room.orgId, person: await this.repository.personName(userId), role };
  }

  /** Remove a member, or decline someone waiting: either way they stay out until let back. */
  async remove(roomId: string, actor: Actor, userId: string): Promise<PeopleChange & { declined: boolean }> {
    const { room, before } = await this.write(roomId, actor, "room.manage", async (people) => {
      const before = people.members.find((member) => member.userId === userId);
      if (!(await people.setMember(userId, ["active", "pending"], { status: "removed" }))) throw new NotFoundException("They aren't in this room any more.");
      return { room: people.room, before };
    });
    const declined = before?.status === "pending";
    await this.changed(roomId, userId);
    if (!declined) this.closeShells(roomId, actor, userId);
    this.tell(roomId, actor.id, userId, declined ? "room.declined" : "room.removed");
    return { orgId: room.orgId, person: await this.repository.personName(userId), declined };
  }

  /** Someone removed can come back: they need the link again (or to ask), like anyone else. */
  async allowBack(roomId: string, actor: Actor, userId: string): Promise<PeopleChange> {
    const room = await this.write(roomId, actor, "room.manage", async (people) => {
      if (!(await people.deleteMember(userId, ["removed"]))) throw new NotFoundException("They aren't on the removed list any more.");
      return people.room;
    });
    this.events.peopleChanged(roomId);
    return { orgId: room.orgId, person: await this.repository.personName(userId) };
  }

  /** A member leaves by themselves. They can come back with the link. */
  async leave(roomId: string, actor: Actor): Promise<PeopleChange> {
    const room = await this.write(roomId, actor, "room.view", async (people) => {
      if (!(await people.deleteMember(actor.id, ["active"]))) throw new NotFoundException("You aren't a member of this room.");
      return people.room;
    });
    await this.changed(roomId, actor.id);
    this.closeShells(roomId, actor, actor.id);
    return { orgId: room.orgId, person: actor.name };
  }

  /** Both role changes commit together; reconnects and notices happen only after that commit. */
  async handover(roomId: string, actor: Actor, userId: string): Promise<{ promoted: PeopleChange; steppedDown: PeopleChange }> {
    const room = await this.write(roomId, actor, "room.manage", async (people, mine) => {
      if (mine !== "owner") throw new ForbiddenException("Only an owner can hand this room over.");
      if (userId === actor.id) throw new ForbiddenException("Choose another active member to hand this room to.");
      if (!(await people.setMember(userId, ["active"], { role: "owner" }))) throw new NotFoundException("They aren't an active member of this room any more.");
      if (!(await people.setMember(actor.id, ["active"], { role: "editor" }))) throw new NotFoundException("You aren't a member of this room any more.");
      return people.room;
    });
    await this.changed(roomId, userId);
    await this.changed(roomId, actor.id);
    this.tell(roomId, actor.id, userId, "room.role", "owner");
    this.tell(roomId, actor.id, actor.id, "room.role", "editor");
    return {
      promoted: { orgId: room.orgId, person: await this.repository.personName(userId), role: "owner" },
      steppedDown: { orgId: room.orgId, person: actor.name, role: "editor" },
    };
  }
}
