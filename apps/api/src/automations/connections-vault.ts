/**
 * What a room's runs are given from its settings (RunnerClient, for a run, a run carrying on, a look for new items, a check): its connections, opened for
 * that run only, and the hosts its owner turned on for its automations. On its own, so the runner's client needn't import the services that keep them.
 */
import { internetHostsOf, type ConnectionValue } from "@codechatter/contracts";
import { Inject, Injectable } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { openToken } from "../github/token-box.js";
import { ENV } from "../infra/tokens.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { CONNECTION_PURPOSE, entriesOf, forRun } from "./connections.js";

/** Where a room's Internet settings are kept (automation-internet.service.ts). */
export const INTERNET = "automationInternet";
export type StoredInternet = { services: string[]; hosts: string[]; by: string | null; at: number | null };
export const internetOf = (settings: unknown): StoredInternet => {
  const value = (settings as Record<string, unknown> | null)?.[INTERNET] as Partial<StoredInternet> | undefined;
  return { services: Array.isArray(value?.services) ? value.services : [], hosts: Array.isArray(value?.hosts) ? value.hosts : [], by: value?.by ?? null, at: value?.at ?? null };
};

@Injectable()
export class ConnectionsVault {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: RoomsRepository,
  ) {}

  async forRun(roomId: string): Promise<{ connections: Record<string, { piece: string; value: ConnectionValue }>; internet: string[] }> {
    const room = await this.repository.findById(roomId);
    if (!room || room.kind === "interview") return { connections: {}, internet: [] };
    const internet = internetOf(room.settings);
    return {
      connections: forRun(entriesOf(room.settings), (sealed) => openToken(this.env.BETTER_AUTH_SECRET, sealed, CONNECTION_PURPOSE)),
      internet: internetHostsOf(internet.services, internet.hosts),
    };
  }
}
