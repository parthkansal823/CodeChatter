/**
 * A room's variables for its automations (contracts' variables.ts), n8n's $vars: names and text a flow reads as {{variables.NAME}}. Not secrets, so
 * they're kept plain in the room's settings and anyone who can run the room's code sees them; only its owners (`room.manage`) add, change and remove them,
 * one at a time, so two owners editing different ones don't undo each other. The API gives them to each run (ConnectionsVault).
 */
import { MOST_VARIABLES, type AutomationVariable, type AutomationVariableInput } from "@codechatter/contracts";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";

import { RoomsRepository } from "../rooms/rooms.repository.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { VARIABLES, variablesOf } from "./connections-vault.js";

export type VariableChange = { orgId: string | null; variable: AutomationVariable };

@Injectable()
export class AutomationVariablesService {
  constructor(
    private readonly rooms: RoomsService,
    private readonly repository: RoomsRepository,
  ) {}

  private async room(roomId: string, userId: string, action: "code.run" | "room.manage") {
    const found = await this.rooms.require(roomId, userId, action).catch((error: unknown) => {
      if (action === "room.manage" && error instanceof ForbiddenException) throw new ForbiddenException("Only the room's owners add, change and remove its variables.");
      throw error;
    });
    if (found.room.kind === "interview") throw new ForbiddenException("This isn't available in an interview.");
    return found.room;
  }

  async list(roomId: string, userId: string): Promise<AutomationVariable[]> {
    const room = await this.room(roomId, userId, "code.run");
    return Object.entries(variablesOf(room.settings))
      .map(([name, stored]) => ({ name, ...stored }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async save(roomId: string, user: { id: string; name: string }, name: string, input: AutomationVariableInput): Promise<VariableChange> {
    const room = await this.room(roomId, user.id, "room.manage");
    const stored = variablesOf(room.settings);
    if (!Object.hasOwn(stored, name) && Object.keys(stored).length >= MOST_VARIABLES) throw new BadRequestException(`A room has up to ${MOST_VARIABLES} variables: remove one first.`);
    const entry = { value: input.value, by: user.name, at: Date.now() };
    await this.repository.setSettingEntry(roomId, VARIABLES, name, entry);
    return { orgId: room.orgId ?? null, variable: { name, ...entry } };
  }

  async remove(roomId: string, userId: string, name: string): Promise<VariableChange> {
    const room = await this.room(roomId, userId, "room.manage");
    const stored = variablesOf(room.settings)[name];
    if (!stored) throw new NotFoundException(`This room has no variable called ${name}.`);
    await this.repository.setSettingEntry(roomId, VARIABLES, name, null);
    return { orgId: room.orgId ?? null, variable: { name, ...stored } };
  }
}
