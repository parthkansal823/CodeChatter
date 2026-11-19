/** A room's internet for its automations (automation-internet.service.ts), each change in the audit log with the hosts it came to. */
import type { AuthSession } from "@codechatter/auth";
import { AutomationInternetInput, RoomCode, type AutomationInternet } from "@codechatter/contracts";
import { Body, Controller, Get, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AutomationInternetService } from "./automation-internet.service.js";

@Controller("rooms/:roomId/automations/internet")
export class AutomationInternetController {
  constructor(
    private readonly internet: AutomationInternetService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<AutomationInternet> {
    return this.internet.get(roomId, session.user.id);
  }

  @Put()
  async save(@CurrentSession() session: AuthSession, @Req() request: Request, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(AutomationInternetInput)) input: AutomationInternetInput): Promise<AutomationInternet> {
    const change = await this.internet.save(roomId, { id: session.user.id, name: session.user.name }, input);
    await this.audit.record({ orgId: change.orgId, actorId: session.user.id, action: "automation.internet.save", targetType: "room", targetId: roomId, data: { hosts: change.internet.on } }, request);
    return change.internet;
  }
}
