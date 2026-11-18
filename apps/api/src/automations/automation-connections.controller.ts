/** A room's connections for automations (automation-connections.service.ts), each change in the audit log by name and piece, never by what's in it. */
import type { AuthSession } from "@codechatter/auth";
import { AutomationConnectionInput, CONNECTION_NAME, RoomCode, type AutomationConnection } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AutomationConnectionsService, type ConnectionChange } from "./automation-connections.service.js";

const Name = z.string().regex(CONNECTION_NAME, "That isn't a connection's name.");

@Controller("rooms/:roomId/automations/connections")
export class AutomationConnectionsController {
  constructor(
    private readonly connections: AutomationConnectionsService,
    private readonly audit: AuditService,
  ) {}

  private async note(session: AuthSession, request: Request, roomId: string, action: string, change: ConnectionChange): Promise<AutomationConnection> {
    await this.audit.record({ orgId: change.orgId, actorId: session.user.id, action, targetType: "room", targetId: roomId, data: { connection: change.connection.name, piece: change.connection.piece } }, request);
    return change.connection;
  }

  @Get()
  list(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<AutomationConnection[]> {
    return this.connections.list(roomId, session.user.id);
  }

  /** Adds a connection, or replaces one of the same name; `?test=1` tries it at once. */
  @Put()
  async save(@CurrentSession() session: AuthSession, @Req() request: Request, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(AutomationConnectionInput)) input: AutomationConnectionInput, @Query("test") test?: string): Promise<AutomationConnection> {
    return this.note(session, request, roomId, "automation.connection.save", await this.connections.save(roomId, { id: session.user.id, name: session.user.name }, input, test === "1" || test === "true"));
  }

  @Post(":name/test")
  @HttpCode(200)
  test(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("name", new ZodPipe(Name)) name: string): Promise<AutomationConnection> {
    return this.connections.test(roomId, { id: session.user.id, name: session.user.name }, name);
  }

  @Delete(":name")
  @HttpCode(204)
  async remove(@CurrentSession() session: AuthSession, @Req() request: Request, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("name", new ZodPipe(Name)) name: string): Promise<void> {
    await this.note(session, request, roomId, "automation.connection.delete", await this.connections.remove(roomId, session.user.id, name));
  }
}
