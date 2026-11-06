/** A room's people, as its owner manages them: approving, declining, removing, changing roles, and leaving. */
import { assignableRoles, can, type NotificationType, type RoomPeople, type RoomRole } from "@codechatter/contracts";
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";

import { NotificationsService } from "../notifications/notifications.service.js";
import { EventsGateway } from "../realtime/events.gateway.js";
import { terminalSessionPrefix } from "../realtime/terminal.proxy.js";
import { RunnerClient } from "../runner/runner.client.js";
import { RoomsRepository } from "./rooms.repository.js";
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
    const { room, role: mine } = await this.manager(roomId, actor.id);
    this.checkRole(mine, role);
    if (!(await this.repository.setMember(roomId, userId, ["pending"], { status: "active", role }))) throw new NotFoundException("They aren't waiting to join any more.");
    await this.changed(roomId, userId);
    this.tell(roomId, actor.id, userId, "room.approved", role);
    return { orgId: room.orgId, person: await this.repository.personName(userId), role };
  }

  async setRole(roomId: string, actor: Actor, userId: string, role: RoomRole): Promise<PeopleChange> {
    const { room, role: mine } = await this.manager(roomId, actor.id);
    this.checkRole(mine, role);
    const before = await this.repository.findMember(roomId, userId);
    if (!(await this.repository.setMember(roomId, userId, ["active"], { role }))) throw new NotFoundException("They aren't in this room any more.");
    await this.changed(roomId, userId);
    if (can(before?.role, "terminal.open") && !can(role, "terminal.open")) this.closeShells(roomId, actor, userId);
    this.tell(roomId, actor.id, userId, "room.role", role);
    return { orgId: room.orgId, person: await this.repository.personName(userId), role };
  }

  /** Remove a member, or decline someone waiting: either way they stay out until let back. */
  async remove(roomId: string, actor: Actor, userId: string): Promise<PeopleChange & { declined: boolean }> {
    const { room } = await this.manager(roomId, actor.id);
    const before = await this.repository.findMember(roomId, userId);
    if (!(await this.repository.setMember(roomId, userId, ["active", "pending"], { status: "removed" }))) throw new NotFoundException("They aren't in this room any more.");
    const declined = before?.status === "pending";
    await this.changed(roomId, userId);
    if (!declined) this.closeShells(roomId, actor, userId);
    this.tell(roomId, actor.id, userId, declined ? "room.declined" : "room.removed");
    return { orgId: room.orgId, person: await this.repository.personName(userId), declined };
  }

  /** Someone removed can come back: they need the link again (or to ask), like anyone else. */
  async allowBack(roomId: string, actor: Actor, userId: string): Promise<PeopleChange> {
    const { room } = await this.manager(roomId, actor.id);
    if (!(await this.repository.deleteMember(roomId, userId, ["removed"]))) throw new NotFoundException("They aren't on the removed list any more.");
    this.events.peopleChanged(roomId);
    return { orgId: room.orgId, person: await this.repository.personName(userId) };
  }

  /** A member leaves by themselves. They can come back with the link. */
  async leave(roomId: string, actor: Actor): Promise<PeopleChange> {
    const { room, role } = await this.rooms.require(roomId, actor.id, "room.view");
    if (room.kind === "interview") throw new ForbiddenException(NO_INTERVIEWS);
    if (role === "owner") throw new ForbiddenException("The owner can't leave their own room. Delete it instead.");
    if (!(await this.repository.deleteMember(roomId, actor.id, ["active"]))) throw new NotFoundException("You aren't a member of this room.");
    await this.changed(roomId, actor.id);
    this.closeShells(roomId, actor, actor.id);
    return { orgId: room.orgId, person: actor.name };
  }
}
