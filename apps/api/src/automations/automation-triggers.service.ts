/**
 * Automations that start by themselves. A flow turned on has a trigger, kept in its room's settings (`automationTriggers`, one entry each, so two people changing
 * different ones don't undo each other). For a webhook, its address holds a token: only a hash of it is matched against, and the token itself is kept sealed, so
 * people who can run the room's code can see the address again. A flow on a schedule is run by a timer here when its time comes, once, however many API servers
 * there are. Either way the flow runs in the room's sandbox, as Run does, by Activepieces' engine.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { dueRun, MOST_TRIGGERS, nextRun, scheduleOf, scheduleProblem, type AutomationRun, type AutomationTestEvent, type AutomationTrigger, type AutomationTriggerInput, type AutomationTriggerPatch, type Schedule } from "@codechatter/contracts";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
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
const SCHEDULE_USER = { id: "schedule", name: "Schedule" };
/** How long a webhook told to answer when the flow finishes waits for it. */
const MOST_WAIT_MS = 30_000;
const TEST_EVENT_SECONDS = 600;
/** A time on a schedule is claimed for a day: long enough that no other server runs it too. */
const CLAIM_SECONDS = 24 * 60 * 60;
/** What the sandbox says when a flow on a schedule can't run again until someone changes it, so it's turned off rather than tried every time. */
const STOPS_IT = ["isn't in the room any more", "doesn't start on a schedule any more"];

type Stored = {
  id: string;
  kind: AutomationTrigger["kind"];
  flowId: string;
  path: string;
  enabled: boolean;
  respond: AutomationTrigger["respond"];
  /** A webhook's. */
  tokenHash?: string;
  tokenSealed?: string;
  /** A schedule's: when it runs, and when it was last turned on, as nothing from before that is run. */
  schedule?: Schedule;
  enabledAt?: number;
  problem?: string | null;
  createdBy: string | null;
  createdAt: number;
};
/** `slot` is the time on the schedule a run was for; `problem`, why the last time didn't run. */
type LastRun = { at: number; id: string | null; slot?: number; problem?: string | null };
export type HookCall = { method: string; body: unknown; headers: Record<string, string>; query: Record<string, string> };
export type Change = { orgId: string; trigger: AutomationTrigger };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sameSchedule = (a: Schedule | undefined, b: Schedule | undefined) => a?.cron === b?.cron && a?.timezone === b?.timezone;

@Injectable()
export class AutomationTriggersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Automations");
  private readonly limiter: RateLimiter;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

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

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick().catch((error: unknown) => this.logger.warn(`schedules: ${String(error)}`)), this.env.AUTOMATION_SCHEDULE_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
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

  /** Nothing from before it was turned on, or from before the last time it ran. */
  private sinceOf(trigger: Stored, last: LastRun | undefined) {
    return Math.max(trigger.enabledAt ?? trigger.createdAt, last?.slot ?? 0);
  }

  private shown(roomId: string, trigger: Stored, last: LastRun | undefined): AutomationTrigger {
    const token = trigger.tokenSealed ? openToken(this.env.BETTER_AUTH_SECRET, trigger.tokenSealed) : null;
    const url = token ? `${this.env.APP_URL.replace(/\/$/, "")}/api/hooks/automations/${roomId}/${token}` : null;
    let nextRunAt: number | null = null;
    if (trigger.kind === "schedule" && trigger.enabled && trigger.schedule) {
      try {
        nextRunAt = nextRun(trigger.schedule.cron, trigger.schedule.timezone, Math.max(Date.now(), this.sinceOf(trigger, last)));
      } catch {
        nextRunAt = null;
      }
    }
    return {
      id: trigger.id,
      kind: trigger.kind,
      flowId: trigger.flowId,
      path: trigger.path,
      enabled: trigger.enabled,
      respond: trigger.respond,
      url,
      testUrl: url ? `${url}/test` : null,
      schedule: trigger.schedule ?? null,
      nextRunAt,
      problem: trigger.problem ?? last?.problem ?? null,
      createdBy: trigger.createdBy,
      createdAt: trigger.createdAt,
      lastRunAt: last?.id ? last.at : null,
      lastRunId: last?.id ?? null,
    };
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
    const now = Date.now();
    const base = { id: `trg_${randomBytes(8).toString("hex")}`, kind: input.kind, flowId: input.flowId, path: input.path, enabled: true, respond: input.respond, createdBy: userId, createdAt: now };
    let trigger: Stored;
    if (input.kind === "schedule") trigger = { ...base, schedule: input.schedule!, enabledAt: now };
    else {
      const token = randomBytes(24).toString("base64url");
      trigger = { ...base, tokenHash: hashOf(token), tokenSealed: sealToken(this.env.BETTER_AUTH_SECRET, token) };
    }
    await this.repository.setSettingEntry(roomId, TRIGGERS, trigger.id, trigger);
    return { orgId: room.orgId, trigger: this.shown(roomId, trigger, undefined) };
  }

  async update(roomId: string, userId: string, id: string, patch: AutomationTriggerPatch): Promise<Change> {
    const { room, trigger, last } = await this.one(roomId, userId, id);
    if (patch.schedule && trigger.kind !== "schedule") throw new BadRequestException("Only a flow on a schedule has a time to run.");
    const turningOn = patch.enabled === true && !trigger.enabled;
    const next: Stored = {
      ...trigger,
      ...(patch.enabled !== undefined && { enabled: patch.enabled }),
      ...(patch.respond && { respond: patch.respond }),
      ...(patch.path && { path: patch.path }),
      ...(patch.schedule && { schedule: patch.schedule }),
      // Turned on again: nothing it missed while it was off is run, and why it stopped is forgotten.
      ...(turningOn && { enabledAt: Date.now(), problem: null }),
    };
    await this.repository.setSettingEntry(roomId, TRIGGERS, id, next);
    if (turningOn && last?.problem) await this.repository.setSettingEntry(roomId, LAST_RUNS, id, { ...last, problem: null } satisfies LastRun);
    return { orgId: room.orgId, trigger: this.shown(roomId, next, turningOn && last ? { ...last, problem: null } : last) };
  }

  /** A new address: the old one stops working at once. */
  async rotate(roomId: string, userId: string, id: string): Promise<Change> {
    const { room, trigger, last } = await this.one(roomId, userId, id);
    if (trigger.kind !== "webhook") throw new BadRequestException("Only a webhook has an address.");
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
    const trigger = room && room.kind !== "interview" ? Object.values(this.entries<Stored>(room.settings, TRIGGERS)).find((each) => each.kind === "webhook" && each.tokenHash && sameHash(each.tokenHash, hash)) : undefined;
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

  /**
   * The timer: every flow on a schedule whose time has come is run, once. Each time is claimed in Valkey first, so with several API servers only one runs it,
   * and a restart doesn't run it again (when it ran is also kept with the room). Returns how many it started.
   */
  async tick(now = Date.now()): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    let started = 0;
    try {
      for (const room of await this.repository.withSetting(TRIGGERS)) {
        if (room.kind === "interview") continue;
        const last = this.entries<LastRun>(room.settings, LAST_RUNS);
        for (const trigger of Object.values(this.entries<Stored>(room.settings, TRIGGERS))) {
          if (trigger.kind !== "schedule" || !trigger.enabled || !trigger.schedule) continue;
          let slot: number | null;
          try {
            slot = dueRun(trigger.schedule, this.sinceOf(trigger, last[trigger.id]), now);
          } catch {
            continue;
          }
          if (slot === null) continue;
          const claimed = await this.redis.set(`automations:slot:${room.id}:${trigger.id}:${slot}`, "1", "EX", CLAIM_SECONDS, "NX");
          if (claimed !== "OK") continue;
          if (await this.runScheduled(room.id, trigger, slot, last[trigger.id])) started += 1;
        }
      }
    } finally {
      this.ticking = false;
    }
    return started;
  }

  private async runScheduled(roomId: string, trigger: Stored, slot: number, last: LastRun | undefined): Promise<boolean> {
    const schedule = trigger.schedule!;
    // What Activepieces' schedule piece gives the flow, and the time it was for.
    const payload = { cron_expression: schedule.cron, timezone: schedule.timezone, scheduled_at: new Date(slot).toISOString() };
    try {
      const answer = (await this.runner.automations(roomId, { op: "run", path: trigger.path, flowId: trigger.flowId, payload, trigger: "schedule" }, SCHEDULE_USER)) as { id: string; trigger?: { triggerName?: string; input?: Record<string, unknown> } };
      await this.repository.setSettingEntry(roomId, LAST_RUNS, trigger.id, { at: Date.now(), id: answer.id, slot } satisfies LastRun);
      // The flow is a file anyone can change, by hand or with git: when its schedule has changed, the next run goes by the new one.
      const now = answer.trigger?.triggerName ? scheduleOf(answer.trigger.triggerName, answer.trigger.input ?? {}) : null;
      if (now && !sameSchedule(now, schedule) && !scheduleProblem(now)) await this.repository.setSettingEntry(roomId, TRIGGERS, trigger.id, { ...trigger, schedule: now } satisfies Stored);
      return true;
    } catch (error) {
      const message = error instanceof HttpException ? error.message : "The room's sandbox couldn't be reached.";
      if (error instanceof ConflictException && STOPS_IT.some((words) => message.includes(words))) {
        await this.repository.setSettingEntry(roomId, TRIGGERS, trigger.id, { ...trigger, enabled: false, problem: `Turned off by itself: ${message}` } satisfies Stored);
      }
      // The last run that did start is still shown; this time is passed over, with why.
      await this.repository.setSettingEntry(roomId, LAST_RUNS, trigger.id, { at: last?.at ?? Date.now(), id: last?.id ?? null, slot, problem: message } satisfies LastRun);
      this.logger.warn(`A flow on a schedule in ${roomId} didn't run: ${message}`);
      return false;
    }
  }
}
