/**
 * A room's connections for automations (connections.ts): listed for anyone who can run its code, made, replaced and removed only by its owners, and tried
 * in the room's sandbox by the piece's own check. connections-vault.ts opens them for a run (RunnerClient), and nothing else ever sees them opened.
 */
import { MOST_CONNECTIONS, type AutomationConnection, type AutomationConnectionInput, type ConnectionValue } from "@codechatter/contracts";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { openToken, sealToken } from "../github/token-box.js";
import { ENV } from "../infra/tokens.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";
import { CONNECTION_PURPOSE, CONNECTIONS, entriesOf, openedValue, shownConnectionOf, storedOf } from "./connections.js";

export type ConnectionChange = { orgId: string | null; connection: AutomationConnection };

@Injectable()
export class AutomationConnectionsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly rooms: RoomsService,
    private readonly repository: RoomsRepository,
    private readonly runner: RunnerClient,
  ) {}

  /** Seeing the room's connections (not their secrets), and using them, is for those who can run its code; changing them is its owners'. */
  private async room(roomId: string, userId: string, action: "code.run" | "room.manage") {
    const found = await this.rooms.require(roomId, userId, action).catch((error: unknown) => {
      if (action === "room.manage" && error instanceof ForbiddenException) throw new ForbiddenException("Only the room's owners can add, change or remove its connections.");
      throw error;
    });
    if (found.room.kind === "interview") throw new ForbiddenException("This isn't available in an interview.");
    return found.room;
  }

  async list(roomId: string, userId: string): Promise<AutomationConnection[]> {
    const room = await this.room(roomId, userId, "code.run");
    return Object.entries(entriesOf(room.settings))
      .map(([name, stored]) => shownConnectionOf(name, stored))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Adds a connection, or replaces one of that name; tried at once when asked. */
  async save(roomId: string, user: { id: string; name: string }, input: AutomationConnectionInput, test: boolean): Promise<ConnectionChange> {
    const room = await this.room(roomId, user.id, "room.manage");
    const all = entriesOf(room.settings);
    const earlier = all[input.name];
    if (!earlier && Object.keys(all).length >= MOST_CONNECTIONS) throw new ConflictException(`A room has up to ${MOST_CONNECTIONS} connections. Remove one first.`);
    if (earlier && earlier.piece !== input.piece) throw new ConflictException(`"${input.name}" is already a connection for another piece. Choose another name.`);
    let stored = storedOf(input, { id: user.id, name: user.name }, (text) => sealToken(this.env.BETTER_AUTH_SECRET, text, CONNECTION_PURPOSE), earlier);
    if (test) stored = { ...stored, lastTest: await this.check(roomId, user, input.piece, input.value) };
    await this.repository.setSettingEntry(roomId, CONNECTIONS, input.name, stored);
    return { orgId: room.orgId ?? null, connection: shownConnectionOf(input.name, stored) };
  }

  async remove(roomId: string, userId: string, name: string): Promise<ConnectionChange> {
    const room = await this.room(roomId, userId, "room.manage");
    const stored = entriesOf(room.settings)[name];
    if (!stored) throw new NotFoundException("That connection isn't in the room any more.");
    await this.repository.setSettingEntry(roomId, CONNECTIONS, name, null);
    return { orgId: room.orgId ?? null, connection: shownConnectionOf(name, stored) };
  }

  /** Tries a kept connection again, in the room's sandbox. Anyone who can use it can see whether it works. */
  async test(roomId: string, user: { id: string; name: string }, name: string): Promise<AutomationConnection> {
    const room = await this.room(roomId, user.id, "code.run");
    const stored = entriesOf(room.settings)[name];
    if (!stored) throw new NotFoundException("That connection isn't in the room any more.");
    const value = openedValue(stored, (sealed) => openToken(this.env.BETTER_AUTH_SECRET, sealed, CONNECTION_PURPOSE));
    if (!value) throw new BadRequestException("This connection can't be opened any more (the server's secret changed). Enter its details again.");
    const lastTest = await this.check(roomId, user, stored.piece, value);
    const next = { ...stored, lastTest };
    await this.repository.setSettingEntry(roomId, CONNECTIONS, name, next);
    return shownConnectionOf(name, next);
  }

  private async check(roomId: string, user: { id: string; name: string }, piece: string, value: ConnectionValue): Promise<NonNullable<AutomationConnection["lastTest"]>> {
    try {
      const answer = (await this.runner.automations(roomId, { op: "test-connection", piece, value }, user)) as { valid?: boolean; error?: string | null };
      return { valid: answer.valid === true, error: answer.valid === true ? null : String(answer.error ?? "It didn't work with these details.").slice(0, 500), at: Date.now() };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message.slice(0, 500) : "The room's sandbox couldn't be reached.", at: Date.now() };
    }
  }
}
