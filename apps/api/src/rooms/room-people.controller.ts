import type { AuthSession } from "@codechatter/auth";
import { MemberRoleInput, PersonId, RoomCode } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomPeopleService, type PeopleChange } from "./room-people.service.js";
import { RoomsService } from "./rooms.service.js";

/** Who's in a room and how they get in: its people, and its invite link. */
@Controller("rooms/:id")
export class RoomPeopleController {
  constructor(
    private readonly people: RoomPeopleService,
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
  ) {}

  private note(session: AuthSession, request: Request, roomId: string, action: string, personId: string, change: PeopleChange) {
    return this.audit.record(
      { orgId: change.orgId, actorId: session.user.id, action, targetType: "room", targetId: roomId, data: { personId, person: change.person, ...(change.role && { role: change.role }) } },
      request,
    );
  }

  @Get("people")
  list(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(RoomCode)) id: string) {
    return this.people.list(id, session.user.id);
  }

  @Post("people/:userId/approve")
  @HttpCode(204)
  async approve(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) id: string,
    @Param("userId", new ZodPipe(PersonId)) userId: string,
    @Body(new ZodPipe(MemberRoleInput)) input: MemberRoleInput,
    @Req() request: Request,
  ) {
    await this.note(session, request, id, "room.member.approve", userId, await this.people.approve(id, session.user, userId, input.role));
  }

  @Patch("people/:userId")
  @HttpCode(204)
  async setRole(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) id: string,
    @Param("userId", new ZodPipe(PersonId)) userId: string,
    @Body(new ZodPipe(MemberRoleInput)) input: MemberRoleInput,
    @Req() request: Request,
  ) {
    await this.note(session, request, id, "room.member.role", userId, await this.people.setRole(id, session.user, userId, input.role));
  }

  /** Remove a member, or decline someone waiting. */
  @Delete("people/:userId")
  @HttpCode(204)
  async remove(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) id: string,
    @Param("userId", new ZodPipe(PersonId)) userId: string,
    @Req() request: Request,
  ) {
    const change = await this.people.remove(id, session.user, userId);
    await this.note(session, request, id, change.declined ? "room.member.decline" : "room.member.remove", userId, change);
  }

  /** Take someone off the removed list. */
  @Post("people/:userId/allow")
  @HttpCode(204)
  async allow(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) id: string,
    @Param("userId", new ZodPipe(PersonId)) userId: string,
    @Req() request: Request,
  ) {
    await this.note(session, request, id, "room.member.allow", userId, await this.people.allowBack(id, session.user, userId));
  }

  @Post("leave")
  @HttpCode(204)
  async leave(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(RoomCode)) id: string, @Req() request: Request) {
    await this.note(session, request, id, "room.member.leave", session.user.id, await this.people.leave(id, session.user));
  }

  /** The room's invite link, for anyone who may invite. */
  @Get("invite-link")
  inviteLink(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(RoomCode)) id: string) {
    return this.rooms.inviteLink(id, session.user.id);
  }

  /** A new invite link: the old one stops working. */
  @Post("invite-link")
  @HttpCode(200)
  async resetInviteLink(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(RoomCode)) id: string, @Req() request: Request) {
    const { room } = await this.rooms.require(id, session.user.id, "room.manage");
    const link = await this.rooms.resetInviteLink(id, session.user.id);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: "room.invite-link.reset", targetType: "room", targetId: id, data: {} }, request);
    return link;
  }
}
