/** Turning a room's automations on and off (automation-triggers.service.ts), each change written to the audit log. */
import type { AuthSession } from "@codechatter/auth";
import { AutomationTriggerInput, AutomationTriggerPatch, RoomCode, type AutomationTestEvent, type AutomationTrigger } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AutomationTriggersService, type Change } from "./automation-triggers.service.js";

const TriggerId = z.string().regex(/^trg_[a-f0-9]{16}$/, "That isn't an automation's trigger.");

@Controller("rooms/:roomId/automations/triggers")
export class AutomationTriggersController {
  constructor(
    private readonly triggers: AutomationTriggersService,
    private readonly audit: AuditService,
  ) {}

  private async note(session: AuthSession, request: Request, roomId: string, action: string, change: Change): Promise<AutomationTrigger> {
    await this.audit.record({ orgId: change.orgId, actorId: session.user.id, action, targetType: "room", targetId: roomId, data: { trigger: change.trigger.id, kind: change.trigger.kind, path: change.trigger.path, enabled: change.trigger.enabled } }, request);
    return change.trigger;
  }

  @Get()
  list(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<AutomationTrigger[]> {
    return this.triggers.list(roomId, session.user.id);
  }

  @Post()
  async create(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(AutomationTriggerInput)) input: AutomationTriggerInput, @Req() request: Request): Promise<AutomationTrigger> {
    return this.note(session, request, roomId, "automation.trigger.create", await this.triggers.create(roomId, session.user.id, input));
  }

  @Patch(":id")
  async update(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("id", new ZodPipe(TriggerId)) id: string, @Body(new ZodPipe(AutomationTriggerPatch)) patch: AutomationTriggerPatch, @Req() request: Request): Promise<AutomationTrigger> {
    return this.note(session, request, roomId, "automation.trigger.update", await this.triggers.update(roomId, session.user.id, id, patch));
  }

  @Post(":id/rotate")
  async rotate(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("id", new ZodPipe(TriggerId)) id: string, @Req() request: Request): Promise<AutomationTrigger> {
    return this.note(session, request, roomId, "automation.trigger.rotate", await this.triggers.rotate(roomId, session.user.id, id));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("id", new ZodPipe(TriggerId)) id: string, @Req() request: Request): Promise<void> {
    await this.note(session, request, roomId, "automation.trigger.delete", await this.triggers.remove(roomId, session.user.id, id));
  }

  @Get(":id/test-event")
  testEvent(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("id", new ZodPipe(TriggerId)) id: string): Promise<AutomationTestEvent | null> {
    return this.triggers.testEvent(roomId, session.user.id, id);
  }
}
