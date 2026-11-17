/**
 * Automations that start by themselves. A flow turned on has a trigger, kept in its room's settings (`automationTriggers`, one entry each, so two people changing
 * different ones don't undo each other). For a webhook, its address holds a token: only a hash of it is matched against, and the token itself is kept sealed, so
 * people who can run the room's code can see the address again. A call to it runs the flow in the room's sandbox, as Run does, by Activepieces' engine.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { MOST_TRIGGERS, type AutomationRun, type AutomationTestEvent, type AutomationTrigger, type AutomationTriggerInput, type AutomationTriggerPatch } from "@codechatter/contracts";
import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Redis } from "ioredis";

import { RateLimiter } from "../ai/rate-limit.js";
import type { Env } from "../config/env.js";
import { openToken, sealToken } from "../github/token-box.js";
import { ENV, VALKEY } from "../infra/tokens.js";
import { RoomsRepository } from "../rooms/rooms.repository.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { RunnerClient } from "../runner/runner.client.js";

const TRIGGERS = "automationTriggers";
/** When each last ran, kept apart from the trigger itself, so a run doesn't undo a change someone's just made. */
const LAST_RUNS = "automationTriggerRuns";
const WEBHOOK_USER = { id: "webhook", name: "Webhook" };
/** How long a webhook told to answer when the flow finishes waits for it. */
const MOST_WAIT_MS = 30_000;
const TEST_EVENT_SECONDS = 600;

type Stored = { id: string; kind: AutomationTrigger["kind"]; flowId: string; path: string; enabled: boolean; respond: AutomationTrigger["respond"]; tokenHash: string; tokenSealed: string; createdBy: string | null; createdAt: number };
type LastRun = { at: number; id: string };
export type HookCall = { method: string; body: unknown; headers: Record<string, string>; query: Record<string, string> };
export type Change = { orgId: string; trigger: AutomationTrigger };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AutomationTriggersService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly rooms: RoomsService,
    private readonly repository: RoomsRepository,
    private readonly runner: RunnerClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly redis: Redis,
  ) {
    // Each address, 60 calls a minute: enough for a busy repository, not enough to keep a room's sandbox busy for someone else.
    this.limiter = new RateLimiter(redis, { limit: 60, windowSeconds: 60, prefix: "automations:hook" });
  }

  /** Turning flows on and off needs Run rights, as running one does; an interview isn't the place for it. */
  private async manage(roomId: string, userId: string) {
    const found = await this.rooms.require(roomId, userId, "code.run");
    if (found.room.kind === "interview") throw new ForbiddenException("This isn't available in an interview.");
    return found;
  }

  private entries<T>(settings: unknown, key: string): Record<string, T> {
    const value = (settings as Record<string, unknown> | null)?.[key];
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : {};
  }

  private shown(roomId: string, trigger: Stored, last: LastRun | undefined): AutomationTrigger {
    const token = openToken(this.env.BETTER_AUTH_SECRET, trigger.tokenSealed);
    const url = token ? `${this.env.APP_URL.replace(/\/$/, "")}/api/hooks/automations/${roomId}/${token}` : null;
    return { id: trigger.id, kind: trigger.kind, flowId: trigger.flowId, path: trigger.path, enabled: trigger.enabled, respond: trigger.respond, url, testUrl: url ? `${url}/test` : null, createdBy: trigger.createdBy, createdAt: trigger.createdAt, lastRunAt: last?.at ?? null, lastRunId: last?.id ?? null };
  }

  private async one(roomId: string, userId: string, id: string) {
    const { room } = await this.manage(roomId, userId);
    const trigger = this.entries<Stored>(room.settings, TRIGGERS)[id];
    if (!trigger) throw new NotFoundException("That automation isn't turned on any more.");
    return { room, trigger, last: this.entries<LastRun>(room.settings, LAST_RUNS)[id] };
  }

  async list(roomId: string, userId: string): Promise<AutomationTrigger[]> {
    const { room } = await this.manage(roomId, userId);
    const last = this.entries<LastRun>(room.settings, LAST_RUNS);
    return Object.values(this.entries<Stored>(room.settings, TRIGGERS))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((trigger) => this.shown(roomId, trigger, last[trigger.id]));
  }

  async create(roomId: string, userId: string, input: AutomationTriggerInput): Promise<Change> {
    const { room } = await this.manage(roomId, userId);
    const existing = Object.values(this.entries<Stored>(room.settings, TRIGGERS));
    if (existing.some((trigger) => trigger.flowId === input.flowId && trigger.kind === input.kind)) throw new ConflictException("This flow is already turned on.");
    if (existing.length >= MOST_TRIGGERS) throw new ConflictException(`A room can have ${MOST_TRIGGERS} automations turned on. Turn one off first.`);
    const token = randomBytes(24).toString("base64url");
    const trigger: Stored = { id: `trg_${randomBytes(8).toString("hex")}`, kind: input.kind, flowId: input.flowId, path: input.path, enabled: true, respond: input.respond, tokenHash: hashOf(token), tokenSealed: sealToken(this.env.BETTER_AUTH_SECRET, token), createdBy: userId, createdAt: Date.now() };
    await this.repository.setSettingEntry(roomId, TRIGGERS, trigger.id, trigger);
    return { orgId: room.orgId, trigger: this.shown(roomId, trigger, undefined) };
  }

  async update(roomId: string, userId: string, id: string, patch: AutomationTriggerPatch): Promise<Change> {
    const { room, trigger, last } = await this.one(roomId, userId, id);
    const next: Stored = { ...trigger, ...(patch.enabled !== undefined && { enabled: patch.enabled }), ...(patch.respond && { respond: patch.respond }), ...(patch.path && { path: patch.path }) };
    await this.repository.setSettingEntry(roomId, TRIGGERS, id, next);
    return { orgId: room.orgId, trigger: this.shown(roomId, next, last) };
  }

  /** A new address: the old one stops working at once. */
  async rotate(roomId: string, userId: string, id: string): Promise<Change> {
    const { room, trigger, last } = await this.one(roomId, userId, id);
    const token = randomBytes(24).toString("base64url");
    const next: Stored = { ...trigger, tokenHash: hashOf(token), tokenSealed: sealToken(this.env.BETTER_AUTH_SECRET, token) };
    await this.repository.setSettingEntry(roomId, TRIGGERS, id, next);
    return { orgId: room.orgId, trigger: this.shown(roomId, next, last) };
  }

  async remove(roomId: string, userId: string, id: string): Promise<Change> {
    const { room, trigger, last } = await this.one(roomId, userId, id);
    await this.repository.setSettingEntry(roomId, TRIGGERS, id, null);
    await this.repository.setSettingEntry(roomId, LAST_RUNS, id, null);
    return { orgId: room.orgId, trigger: this.shown(roomId, trigger, last) };
  }

  /** What the test address was last sent, for setting the flow up with real data. */
  async testEvent(roomId: string, userId: string, id: string): Promise<AutomationTestEvent | null> {
    await this.one(roomId, userId, id);
    const raw = await this.redis.get(`automations:test:${roomId}:${id}`);
    return raw ? (JSON.parse(raw) as AutomationTestEvent) : null;
  }

  /** A call to a webhook's address. Nothing about the room or its flows is told to someone without the right address. */
  async hook(roomId: string, token: string, call: HookCall, test: boolean): Promise<{ status: number; body: unknown }> {
    const room = await this.repository.findById(roomId);
    const hash = hashOf(token);
    const trigger = room && room.kind !== "interview" ? Object.values(this.entries<Stored>(room.settings, TRIGGERS)).find((each) => each.kind === "webhook" && sameHash(each.tokenHash, hash)) : undefined;
    if (!trigger) throw new NotFoundException("There's no automation at this address.");
    const decision = await this.limiter.hit(trigger.id);
    if (!decision.allowed) throw new HttpException(`Too many calls to this automation. Try again in ${decision.retryAfterSeconds ?? 60} seconds.`, 429);
    if (test) {
      const event: AutomationTestEvent = { ...call, at: Date.now() };
      await this.redis.set(`automations:test:${roomId}:${trigger.id}`, JSON.stringify(event), "EX", TEST_EVENT_SECONDS);
      return { status: 200, body: { ok: true, test: true } };
    }
    if (!trigger.enabled) throw new ConflictException("This automation is turned off.");
    const started = (await this.runner.automations(roomId, { op: "run", path: trigger.path, flowId: trigger.flowId, payload: call.body ?? {}, headers: call.headers, query: call.query, trigger: "webhook" }, WEBHOOK_USER)) as { id: string };
    await this.repository.setSettingEntry(roomId, LAST_RUNS, trigger.id, { at: Date.now(), id: started.id } satisfies LastRun);
    if (trigger.respond === "now") return { status: 202, body: { id: started.id } };
    // Answering when the flow finishes: what its last step gave, or why it failed.
    for (const until = Date.now() + MOST_WAIT_MS; Date.now() < until; ) {
      await sleep(400);
      let run: AutomationRun;
      try {
        run = (await this.runner.automations(roomId, { op: "run-details", id: started.id }, WEBHOOK_USER)) as AutomationRun;
      } catch (error) {
        if (error instanceof ConflictException) continue;
        throw error;
      }
      if (run.status !== "SUCCEEDED") return { status: 500, body: { id: run.id, status: run.status, error: run.failedStep?.message ?? run.message ?? "The flow didn't finish." } };
      const steps = Object.values(run.steps ?? {});
      return { status: 200, body: steps.at(-1)?.output ?? null };
    }
    return { status: 202, body: { id: started.id, status: "running" } };
  }
}
