/**
 * What a room's runs are given from its settings (RunnerClient, for a run, a run carrying on, a look for new items, a check): its connections, opened for
 * that run only, the hosts its owner turned on for its automations, and its variables. On its own, so the runner's client needn't import the services that keep them.
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

/** Where a room's variables are kept (automation-variables.service.ts): by name, each with who set it when. */
export const VARIABLES = "automationVariables";
export type StoredVariable = { value: string; by: string | null; at: number | null };
export const variablesOf = (settings: unknown): Record<string, StoredVariable> => {
  const value = (settings as Record<string, unknown> | null)?.[VARIABLES];
  if (!value || typeof value !== "object") return {};
  const out: Record<string, StoredVariable> = {};
  for (const [name, entry] of Object.entries(value as Record<string, Partial<StoredVariable> | null>)) {
    if (entry && typeof entry.value === "string") out[name] = { value: entry.value, by: entry.by ?? null, at: entry.at ?? null };
  }
  return out;
};

@Injectable()
export class ConnectionsVault {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly repository: RoomsRepository,
  ) {}

  async forRun(roomId: string): Promise<{ connections: Record<string, { piece: string; value: ConnectionValue }>; internet: string[]; variables: Record<string, string> }> {
    const room = await this.repository.findById(roomId);
    if (!room || room.kind === "interview") return { connections: {}, internet: [], variables: {} };
    const internet = internetOf(room.settings);
    return {
      connections: forRun(entriesOf(room.settings), (sealed) => openToken(this.env.BETTER_AUTH_SECRET, sealed, CONNECTION_PURPOSE)),
      internet: internetHostsOf(internet.services, internet.hosts),
      variables: Object.fromEntries(Object.entries(variablesOf(room.settings)).map(([name, stored]) => [name, stored.value])),
    };
  }
}
