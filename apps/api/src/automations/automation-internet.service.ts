/**
 * What a room's automations may reach on the internet (ADR 0007): its owner turns services on (each piece's hosts) and names other hosts; anyone who can
 * run the room's code sees what's on. The room's proxy lets those hosts through for every program in the room, so it's the owner's switch
 * (`sandbox.network`), as package installs are, and each change is in the audit log with the hosts it came to.
 */
import { internetHostsOf, type AutomationInternet, type AutomationInternetInput } from "@codechatter/contracts";
import { ForbiddenException, Injectable, Logger } from "@nestjs/common";

import { RoomsRepository } from "../rooms/rooms.repository.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";
import { INTERNET, internetOf, type StoredInternet } from "./connections-vault.js";

const shown = (stored: StoredInternet): AutomationInternet => ({ services: stored.services, hosts: stored.hosts, on: internetHostsOf(stored.services, stored.hosts), by: stored.by, at: stored.at });

@Injectable()
export class AutomationInternetService {
  private readonly logger = new Logger("Automations");

  constructor(
    private readonly rooms: RoomsService,
    private readonly repository: RoomsRepository,
    private readonly runner: RunnerClient,
  ) {}

  private async room(roomId: string, userId: string, action: "code.run" | "sandbox.network") {
    const found = await this.rooms.require(roomId, userId, action).catch((error: unknown) => {
      if (action === "sandbox.network" && error instanceof ForbiddenException) throw new ForbiddenException("Only the room's owners turn the internet on and off.");
      throw error;
    });
    if (found.room.kind === "interview") throw new ForbiddenException("This isn't available in an interview.");
    return found.room;
  }

  async get(roomId: string, userId: string): Promise<AutomationInternet> {
    const room = await this.room(roomId, userId, "code.run");
    return shown(internetOf(room.settings));
  }

  async save(roomId: string, user: { id: string; name: string }, input: AutomationInternetInput): Promise<{ orgId: string | null; internet: AutomationInternet }> {
    const room = await this.room(roomId, user.id, "sandbox.network");
    const stored: StoredInternet = { services: input.services, hosts: input.hosts, by: user.name, at: Date.now() };
    await this.repository.setSettingEntry(roomId, INTERNET, "services", stored.services);
    await this.repository.setSettingEntry(roomId, INTERNET, "hosts", stored.hosts);
    await this.repository.setSettingEntry(roomId, INTERNET, "by", stored.by);
    await this.repository.setSettingEntry(roomId, INTERNET, "at", stored.at);
    const internet = shown(stored);
    // The room's proxy follows at once if its sandbox is up; otherwise its next run sees to it.
    await this.runner.internet(roomId, internet.on, user).catch((error: unknown) => this.logger.warn(`The internet for ${roomId} waits for its next run: ${String(error)}`));
    return { orgId: room.orgId ?? null, internet };
  }
}
