/** Queue organisation audit events and deliver them later with pinned networking and durable retries. */
import type { WebhookDelivery, WebhookDeliveryPage, WebhookInput, WebhookItem, WebhookPatch, WebhookPayload } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";

import type { AuditEntry } from "../audit/audit.service.js";
import type { Env } from "../config/env.js";
import { openToken, sealToken } from "../github/token-box.js";
import { BlockedTargetError, InvalidTargetError, parseInternetUrl, UnresolvedHostError, vetTarget, type Resolver, type VettedTarget } from "../http-studio/ssrf-guard.js";
import { transport } from "../http-studio/transport.js";
import { DB, ENV } from "../infra/tokens.js";
import { sign } from "./signature.js";

type Hook = typeof schema.webhooks.$inferSelect;
type Delivery = typeof schema.webhookDeliveries.$inferSelect;
type LastDelivery = WebhookItem["lastDelivery"];
export const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000] as const;
const MAX_ATTEMPTS = RETRY_MS.length + 1;
const PAGE = 50;

/** Bound DNS as well as HTTP; the connection always uses the address just checked. */
async function resolveAll(host: string, timeoutMs = 10_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS lookup timed out.")), timeoutMs); timer.unref(); }),
    ]);
  } finally { clearTimeout(timer); }
}

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;
  private cleanupAfter = 0;

  constructor(@Inject(DB) private readonly handle: DbHandle, @Inject(ENV) private readonly env: Env) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runWorker(), 5000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }

  async list(orgId: string, userId: string): Promise<{ items: WebhookItem[] }> {
    await this.requireAdmin(orgId, userId);
    const hooks = await this.handle.db.select().from(schema.webhooks).where(eq(schema.webhooks.orgId, orgId)).orderBy(desc(schema.webhooks.createdAt));
    if (!hooks.length) return { items: [] };
    const d = schema.webhookDeliveries;
    const recent = await this.handle.db.selectDistinctOn([d.webhookId], {
      webhookId: d.webhookId, status: d.status, lastStatusCode: d.lastStatusCode, createdAt: d.createdAt,
    }).from(d).where(inArray(d.webhookId, hooks.map((hook) => hook.id))).orderBy(d.webhookId, desc(d.createdAt), desc(d.id));
    return { items: hooks.map((hook) => {
      const last = recent.find((row) => row.webhookId === hook.id);
      return this.item(hook, last ? { status: last.status, lastStatusCode: last.lastStatusCode, createdAt: last.createdAt.toISOString() } : null);
    }) };
  }

  async create(orgId: string, userId: string, input: WebhookInput): Promise<{ webhook: WebhookItem; secret: string }> {
    await this.requireAdmin(orgId, userId);
    const target = await this.savedTarget(input.url);
    const secret = randomBytes(32).toString("base64url");
    const [row] = await this.handle.db.insert(schema.webhooks).values({
      orgId, createdBy: userId, ...input, url: target.url.href, privateTestOwner: target.privateTestOwner,
      secretSealed: sealToken(this.env.BETTER_AUTH_SECRET, secret),
    }).returning();
    return { webhook: this.item(row!), secret };
  }

  async update(orgId: string, userId: string, id: string, input: WebhookPatch): Promise<WebhookItem> {
    await this.requireAdmin(orgId, userId);
    const old = await this.find(orgId, id);
    const target = input.url !== undefined ? await this.savedTarget(input.url) : undefined;
    // Re-enabling a normal hook rechecks its current DNS answers as well.
    if (input.active === true && !target) {
      try { await this.deliveryTarget(old); }
      catch (error) { throw new BadRequestException(error instanceof Error ? error.message : "That webhook URL cannot be reached safely."); }
    }
    const row = await this.handle.db.transaction(async (tx) => {
      const [current] = await tx.select({ active: schema.webhooks.active }).from(schema.webhooks)
        .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId))).limit(1).for("update");
      if (!current) throw new NotFoundException("That webhook doesn't exist in this organisation.");
      if (input.active === true && !current.active) {
        const d = schema.webhookDeliveries;
        await tx.update(d).set({
          // Keep an in-flight lease until its owner finishes: manual redelivery must not overlap that request.
          status: "failed", lastError: "Expired while the webhook was paused", nextAttemptAt: null,
        }).where(and(eq(d.webhookId, id), eq(d.status, "pending"), lt(d.createdAt, sql`now() - interval '24 hours'`)));
      }
      const [updated] = await tx.update(schema.webhooks).set({
        ...input, ...(target && { url: target.url.href, privateTestOwner: target.privateTestOwner }), updatedAt: new Date(),
      }).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId))).returning();
      return updated!;
    });
    return this.item(row);
  }

  async remove(orgId: string, userId: string, id: string): Promise<void> {
    await this.requireAdmin(orgId, userId);
    const rows = await this.handle.db.delete(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId))).returning({ id: schema.webhooks.id });
    if (!rows.length) throw new NotFoundException("That webhook doesn't exist in this organisation.");
  }

  async rotateSecret(orgId: string, userId: string, id: string): Promise<{ secret: string }> {
    await this.requireAdmin(orgId, userId);
    const secret = randomBytes(32).toString("base64url");
    const rows = await this.handle.db.update(schema.webhooks).set({ secretSealed: sealToken(this.env.BETTER_AUTH_SECRET, secret), updatedAt: new Date() })
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId))).returning({ id: schema.webhooks.id });
    if (!rows.length) throw new NotFoundException("That webhook doesn't exist in this organisation.");
    return { secret };
  }

  async test(orgId: string, userId: string, id: string): Promise<WebhookDelivery> {
    await this.requireAdmin(orgId, userId);
    const hook = await this.find(orgId, id);
    if (!hook.active) throw new BadRequestException("Enable this webhook before sending a test.");
    const payload = await this.payload({ orgId, actorId: userId, action: "ping", data: {} });
    const [row] = await this.handle.db.insert(schema.webhookDeliveries).values({ webhookId: id, event: "ping", payload }).returning();
    return this.delivery(row!);
  }

  async deliveries(orgId: string, userId: string, id: string, before?: string): Promise<WebhookDeliveryPage> {
    await this.requireAdmin(orgId, userId);
    await this.find(orgId, id);
    const d = schema.webhookDeliveries;
    let cursor;
    if (before) {
      [cursor] = await this.handle.db.select({ id: d.id, createdAt: d.createdAt }).from(d).where(and(eq(d.webhookId, id), eq(d.id, before))).limit(1);
      if (!cursor) throw new BadRequestException("That delivery cursor doesn't belong to this webhook.");
    }
    const rows = await this.handle.db.select().from(d).where(and(eq(d.webhookId, id), cursor
      ? or(lt(d.createdAt, cursor.createdAt), and(eq(d.createdAt, cursor.createdAt), lt(d.id, cursor.id))) : undefined))
      .orderBy(desc(d.createdAt), desc(d.id)).limit(PAGE + 1);
    const items = rows.slice(0, PAGE).map((row) => this.delivery(row));
    return { items, next: rows.length > PAGE ? items.at(-1)!.id : null };
  }

  async redeliver(orgId: string, userId: string, id: string, deliveryId: string): Promise<WebhookDelivery> {
    await this.requireAdmin(orgId, userId);
    const hook = await this.find(orgId, id);
    if (!hook.active) throw new BadRequestException("Enable this webhook before redelivering an event.");
    const d = schema.webhookDeliveries;
    // The worker no longer holds a row lock during HTTP; do not reset a live lease.
    const [row] = await this.handle.db.update(d).set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), deliveredAt: null, lockedBy: null, lockedUntil: null })
      .where(and(eq(d.webhookId, id), eq(d.id, deliveryId), or(isNull(d.lockedUntil), lte(d.lockedUntil, sql`now()`)))).returning();
    if (!row) {
      const [existing] = await this.handle.db.select({ id: d.id }).from(d).where(and(eq(d.webhookId, id), eq(d.id, deliveryId))).limit(1);
      if (existing) throw new ConflictException("That delivery is being sent. Wait for this attempt to finish.");
      throw new NotFoundException("That delivery doesn't belong to this webhook.");
    }
    return this.delivery(row);
  }

  async queue(entry: AuditEntry & { id?: string; createdAt?: Date }): Promise<void> {
    if (!entry.orgId) return;
    const orgId = entry.orgId;
    // Resolve the actor before opening a transaction: the payload lookup must
    // not wait for a second pool connection while the queue holds the first.
    const payload = await this.payload(entry);
    await this.handle.db.transaction(async (tx) => {
      const hooks = await tx.select({ id: schema.webhooks.id, events: schema.webhooks.events }).from(schema.webhooks)
        .where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.active, true))).for("share");
      const subscribed = hooks.filter((hook) => hook.events.includes("*") || hook.events.includes(entry.action));
      if (!subscribed.length) return;
      // Keep subscriptions stable until the insert commits. Deleting one hook
      // concurrently must not abort deliveries to every other matching hook.
      await tx.insert(schema.webhookDeliveries).values(subscribed.map((hook) => ({ webhookId: hook.id, event: entry.action, payload })));
    });
  }

  /** Only one tick per process; short PostgreSQL claims coordinate leases across instances. */
  async runWorker(): Promise<void> {
    if (this.stopping || this.inFlight) return;
    this.inFlight = this.work().catch(() => this.logger.warn("Webhook worker database operation failed."));
    try { await this.inFlight; } finally { this.inFlight = null; }
  }

  private async work(): Promise<void> {
    // Retention failures must not prevent delivery, and even failed cleanup attempts run at most hourly.
    if (Date.now() >= this.cleanupAfter) {
      this.cleanupAfter = Date.now() + 60 * 60_000;
      await this.cleanup().catch(() => this.logger.warn("Webhook retention cleanup failed."));
    }
    await this.batch();
  }

  private async cleanup(): Promise<void> {
    const d = schema.webhookDeliveries;
    const days = this.env.WEBHOOK_DELIVERY_RETENTION_DAYS ?? 30;
    const until = performance.now() + 5000;
    let removed: { id: string }[];
    do {
      const expired = this.handle.db.select({ id: d.id }).from(d)
        .where(and(inArray(d.status, ["delivered", "failed"]), lt(d.createdAt, sql`now() - ${days} * interval '1 day'`)))
        .orderBy(d.createdAt, d.id).limit(1000).for("update", { skipLocked: true });
      // Each batch autocommits independently, releasing its locks before the next one.
      removed = await this.handle.db.delete(d).where(inArray(d.id, expired)).returning({ id: d.id });
      if (removed.length === 1000 && performance.now() < until) await new Promise<void>((resolve) => setImmediate(resolve));
    } while (!this.stopping && removed.length === 1000 && performance.now() < until);
  }

  private async batch(): Promise<void> {
    const d = schema.webhookDeliveries;
    const w = schema.webhooks;
    const rows = await this.handle.db.transaction(async (tx) => {
      const due = tx.select({ id: d.id }).from(d).innerJoin(w, eq(d.webhookId, w.id))
        .where(and(eq(d.status, "pending"), lte(d.nextAttemptAt, sql`now()`), eq(w.active, true),
          or(isNull(d.lockedUntil), lte(d.lockedUntil, sql`now()`)),
          or(isNull(w.privateTestOwner), eq(w.privateTestOwner, this.workerId))))
        .orderBy(d.nextAttemptAt, d.id).limit(20).for("update", { of: d, skipLocked: true });
      const claimed = await tx.update(d).set({ lockedBy: this.workerId, lockedUntil: sql`now() + interval '60 seconds'` })
        .where(inArray(d.id, due)).returning();
      if (!claimed.length) return [];
      const hooks = await tx.select().from(w).where(inArray(w.id, [...new Set(claimed.map((delivery) => delivery.webhookId))]));
      return claimed.flatMap((delivery) => {
        const hook = hooks.find((hook) => hook.id === delivery.webhookId);
        return hook ? [{ delivery, hook }] : [];
      });
    });
    // All twenty requests start together, each with a ten-second DNS+HTTP budget,
    // well inside the sixty-second lease. No pooled transaction spans the network.
    await Promise.all(rows.map(async ({ delivery, hook }) => {
      try {
        const result = await this.send(hook, delivery);
        const attempts = delivery.attempts + 1;
        const delivered = result.statusCode !== null && result.statusCode >= 200 && result.statusCode < 300 && !result.error;
        const now = new Date();
        const recorded = await this.handle.db.update(d).set({
          attempts, status: delivered ? "delivered" : attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          nextAttemptAt: delivered || attempts >= MAX_ATTEMPTS ? null : new Date(now.getTime() + RETRY_MS[attempts - 1]!),
          lastStatusCode: result.statusCode, lastError: result.error, lastResponse: result.response,
          deliveredAt: delivered ? now : null, attemptLog: [...delivery.attemptLog, { attempt: attempts, at: now.toISOString(), ...result }],
          lockedBy: null, lockedUntil: null,
        }).where(and(eq(d.id, delivery.id), eq(d.lockedBy, this.workerId), eq(d.status, "pending"))).returning({ id: d.id });
        if (!recorded.length) {
          // Resume may have expired this row during HTTP. Preserve that failure and its
          // history, releasing only our own lease; a reclaimed worker's lease stays intact.
          await this.handle.db.update(d).set({ lockedBy: null, lockedUntil: null }).where(and(
            eq(d.id, delivery.id), eq(d.lockedBy, this.workerId), eq(d.status, "failed"),
            eq(d.lastError, "Expired while the webhook was paused"),
          ));
        }
      } catch {
        // A failed acknowledgement leaves only this lease recoverable; siblings still commit.
        this.logger.warn(`Webhook delivery ${delivery.id} could not be recorded; its lease will expire.`);
      }
    }));
  }

  private async send(hook: Hook, delivery: Delivery) {
    const began = performance.now();
    let statusCode: number | null = null;
    let response: string | null = null;
    let error: string | null = null;
    try {
      const target = await this.deliveryTarget(hook, 10_000);
      const secret = openToken(this.env.BETTER_AUTH_SECRET, hook.secretSealed);
      if (!secret) throw new Error("The signing secret could not be opened. Rotate this webhook's secret.");
      const body = Buffer.from(JSON.stringify(delivery.payload), "utf8");
      const timestamp = Math.floor(Date.now() / 1000);
      const res = await transport({
        url: target.url, address: { address: target.address, family: target.family }, method: "POST", body,
        headers: { "content-type": "application/json", "user-agent": "CodeChatter-Webhooks/1", "X-CodeChatter-Event": delivery.event,
          "X-CodeChatter-Delivery": delivery.id, "X-CodeChatter-Timestamp": String(timestamp), "X-CodeChatter-Signature": sign(secret, timestamp, body) },
        timeoutMs: Math.max(1, 10_000 - (performance.now() - began)), maxBytes: 64 * 1024,
      });
      statusCode = res.status;
      response = res.body.subarray(0, 2048).toString("utf8");
      if (res.status < 200 || res.status >= 300) error = `Receiver returned HTTP ${res.status}.`;
    } catch (failure) { error = (failure instanceof Error ? failure.message : "Delivery failed.").slice(0, 500); }
    return { statusCode, response, error, durationMs: Math.round(performance.now() - began) };
  }

  private async savedTarget(raw: string): Promise<VettedTarget & { privateTestOwner: string | null }> {
    try {
      try { return { ...await this.target(raw, true), privateTestOwner: null }; }
      catch (error) {
        if (error instanceof BlockedTargetError && this.allowPrivate()) {
          return { ...await this.target(raw, false), privateTestOwner: this.workerId };
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof InvalidTargetError || error instanceof BlockedTargetError || error instanceof UnresolvedHostError) {
        throw new BadRequestException(error.message.replaceAll("API Studio", "Webhooks"));
      }
      throw error;
    }
  }

  private allowPrivate(): boolean { return this.env.NODE_ENV !== "production" && this.env.WEBHOOKS_ALLOW_PRIVATE === true; }

  private async deliveryTarget(hook: Hook, timeoutMs = 10_000): Promise<VettedTarget> {
    const ownTest = hook.privateTestOwner === this.workerId && this.allowPrivate();
    if (hook.privateTestOwner && !ownTest) throw new BlockedTargetError("This private test webhook belongs to a different API process.");
    return this.target(hook.url, !ownTest, timeoutMs);
  }

  private async target(raw: string, strict: boolean, timeoutMs = 10_000): Promise<VettedTarget> {
    const url = parseInternetUrl(raw);
    if (this.env.NODE_ENV === "production" && url.protocol !== "https:") throw new InvalidTargetError("Webhook URLs must use https in production.");
    const resolve: Resolver = (host) => resolveAll(host, timeoutMs);
    if (strict) return vetTarget(raw, resolve);
    // The explicit development-only test switch keeps parsing and DNS pinning.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const family = isIP(host);
    if (family) return { url, address: host, family: family as 4 | 6 };
    const [first] = await resolve(host).catch(() => { throw new UnresolvedHostError("The webhook host could not be resolved."); });
    if (!first) throw new UnresolvedHostError("The webhook host could not be resolved.");
    return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  private async payload(entry: AuditEntry & { id?: string; createdAt?: Date }): Promise<WebhookPayload> {
    let actor: WebhookPayload["actor"] = null;
    if (entry.actorId) {
      const [user] = await this.handle.db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, entry.actorId)).limit(1);
      actor = user ?? null;
    }
    return { id: entry.id ?? randomUUID(), event: entry.action, createdAt: (entry.createdAt ?? new Date()).toISOString(), org: { id: entry.orgId! }, actor,
      target: entry.targetType && entry.targetId ? { type: entry.targetType, id: entry.targetId } : null, data: entry.data ?? {} };
  }

  private async requireAdmin(orgId: string, userId: string): Promise<void> {
    const [member] = await this.handle.db.select({ role: schema.member.role }).from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId))).limit(1);
    if (!member || (member.role !== "owner" && member.role !== "admin")) throw new ForbiddenException("Only the organisation's owners and admins can manage its webhooks.");
  }

  private async find(orgId: string, id: string): Promise<Hook> {
    const [row] = await this.handle.db.select().from(schema.webhooks).where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId))).limit(1);
    if (!row) throw new NotFoundException("That webhook doesn't exist in this organisation.");
    return row;
  }

  private item(row: Hook, lastDelivery: LastDelivery = null): WebhookItem {
    return { id: row.id, orgId: row.orgId, url: row.url, events: row.events, active: row.active, description: row.description,
      createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), lastDelivery };
  }

  private delivery(row: Delivery): WebhookDelivery {
    return { id: row.id, webhookId: row.webhookId, event: row.event, payload: row.payload as unknown as WebhookPayload, status: row.status,
      attempts: row.attempts, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, lastStatusCode: row.lastStatusCode,
      lastError: row.lastError, lastResponse: row.lastResponse, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt?.toISOString() ?? null,
      attemptLog: row.attemptLog, inFlight: Boolean(row.lockedBy && row.lockedUntil && row.lockedUntil.getTime() > Date.now()) };
  }
}
