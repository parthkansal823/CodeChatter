import type { AuthSession } from "@codechatter/auth";
import { can, DATABASE_KINDS, RoomCode, type DatabaseKind, type DatabaseStatus, type RoomRole } from "@codechatter/contracts";
import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";

/**
 * The room's one-click databases (apps/runner/src/databases.ts). Everyone in
 * the room sees which are running; their connections (with the password) go
 * only to people who can run code, and starting, stopping and deleting them
 * needs terminal rights, like everything else that changes the sandbox. Each
 * change is recorded in the audit log.
 */
@Controller("rooms/:roomId/databases")
export class DatabasesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string): Promise<DatabaseStatus[]> {
    const { room, role } = await this.rooms.require(this.room(roomId), session.user.id, "room.view");
    return visibleTo(role, await this.runner.databases(room.id, session.user));
  }

  /** Starts in the background; the list says how it's going. */
  @Post(":kind")
  @HttpCode(202)
  start(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "start", request);
  }

  /** Keeps its data. */
  @Post(":kind/stop")
  @HttpCode(200)
  stop(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "stop", request);
  }

  /** Deletes its data. */
  @Delete(":kind")
  remove(@CurrentSession() session: AuthSession, @Param("roomId") roomId: string, @Param("kind") kind: string, @Req() request: Request) {
    return this.change(session, roomId, kind, "delete", request);
  }

  private async change(session: AuthSession, roomId: string, name: string, change: "start" | "stop" | "delete", request: Request): Promise<DatabaseStatus[]> {
    const kind = DATABASE_KINDS.find((k) => k === name);
    if (!kind) throw new BadRequestException("Unknown database.");
    const { room, role } = await this.rooms.require(this.room(roomId), session.user.id, "terminal.open");
    const list = await this.runner.changeDatabase(room.id, session.user, kind as DatabaseKind, change);
    await this.audit.record({ orgId: room.orgId, actorId: session.user.id, action: `database.${change}`, targetType: "room", targetId: room.id, data: { kind } }, request);
    return visibleTo(role, list);
  }

  private room(roomId: string): string {
    const parsed = RoomCode.safeParse(roomId);
    if (!parsed.success) throw new BadRequestException("Unknown room.");
    return parsed.data;
  }
}

/** Connections (with the password) only for people who can run code, which could read them anyway. */
function visibleTo(role: RoomRole, list: DatabaseStatus[]): DatabaseStatus[] {
  return can(role, "code.run") ? list : list.map(({ connection: _, ...rest }) => rest);
}
