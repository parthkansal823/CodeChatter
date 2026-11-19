/** A room's variables for its automations (automation-variables.service.ts): each change in the audit log by name, without its value. */
import type { AuthSession } from "@codechatter/auth";
import { AutomationVariableInput, RoomCode, VariableName, type AutomationVariable } from "@codechatter/contracts";
import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AutomationVariablesService } from "./automation-variables.service.js";

@Controller("rooms/:roomId/automations/variables")
export class AutomationVariablesController {
  constructor(
    private readonly variables: AutomationVariablesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string): Promise<AutomationVariable[]> {
    return this.variables.list(roomId, session.user.id);
  }

  @Put(":name")
  async save(
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("name", new ZodPipe(VariableName)) name: string,
    @Body(new ZodPipe(AutomationVariableInput)) input: AutomationVariableInput,
  ): Promise<AutomationVariable> {
    const change = await this.variables.save(roomId, { id: session.user.id, name: session.user.name }, name, input);
    await this.audit.record({ orgId: change.orgId, actorId: session.user.id, action: "automation.variable.save", targetType: "room", targetId: roomId, data: { name } }, request);
    return change.variable;
  }

  @Delete(":name")
  async remove(@CurrentSession() session: AuthSession, @Req() request: Request, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Param("name", new ZodPipe(VariableName)) name: string): Promise<{ ok: true }> {
    const change = await this.variables.remove(roomId, session.user.id, name);
    await this.audit.record({ orgId: change.orgId, actorId: session.user.id, action: "automation.variable.remove", targetType: "room", targetId: roomId, data: { name } }, request);
    return { ok: true };
  }
}
