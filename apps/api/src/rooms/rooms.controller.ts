import type { AuthSession } from "@codechatter/auth";
import { CreateRoomInput, JoinRoomInput, RoomCode } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RunnerClient } from "../runner/runner.client.js";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly audit: AuditService,
    private readonly runner: RunnerClient,
  ) {}

  @Get()
  list(@CurrentSession() session: AuthSession) {
    return this.rooms.list(session.user.id);
  }

  @Post()
  async create(
    @CurrentSession() session: AuthSession,
    @Body(new ZodPipe(CreateRoomInput)) input: CreateRoomInput,
    @Req() request: Request,
  ) {
    const room = await this.rooms.create(session, input);
    await this.audit.record(
      { orgId: session.session.activeOrganizationId ?? null, actorId: session.user.id, action: "room.create", targetType: "room", targetId: room.id, data: { name: room.name, visibility: room.visibility, ...(room.imported && { repo: room.imported.repo, commit: room.imported.commit }) } },
      request,
    );
    return room;
  }

  @Post("join")
  @HttpCode(200)
  join(@CurrentSession() session: AuthSession, @Body(new ZodPipe(JoinRoomInput)) input: JoinRoomInput) {
    return this.rooms.join(session, input.code, input.inviteToken);
  }

  @Get(":id")
  get(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(RoomCode)) id: string) {
    return this.rooms.get(id, session.user.id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentSession() session: AuthSession,
    @Param("id", new ZodPipe(RoomCode)) id: string,
    @Req() request: Request,
  ) {
    const room = await this.rooms.remove(id, session.user.id);
    // Its sandbox, databases, volumes and network go too. If the runner is away, the janitor (room-janitor.ts) catches up.
    await this.runner.destroyRoom(id, session.user).catch(() => {});
    await this.audit.record(
      { orgId: room.orgId, actorId: session.user.id, action: "room.delete", targetType: "room", targetId: id, data: { name: room.name } },
      request,
    );
  }
}
