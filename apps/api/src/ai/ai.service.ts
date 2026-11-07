import type { AiPromptModels, AiStatus, AiTokenCount, AiUsage } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, count, eq, gte, like, max, min, notLike } from "drizzle-orm";
import type { Redis } from "ioredis";

import type { Env } from "../config/env.js";
import { GUEST_DOMAIN } from "../demo/guest-domain.js";
import { DB, ENV, VALKEY } from "../infra/tokens.js";
import { MessagesService } from "../messages/messages.service.js";
import { aiStatus, embeddingModelOf, ollamaUrl, playableModels, resolveAiSetup, type AiSetup } from "./ai.config.js";
import { COMPLETION } from "./complete.js";
import { createProvider, type AiProvider } from "./providers.js";
import { RateLimiter, type RateDecision } from "./rate-limit.js";
import type { ActivityRow, ChatLine } from "./summary.js";
import { UsageTracker } from "./usage.js";

/** The configured model (if any), the per-person limit and usage counters. Settings are read once at boot, so .env changes need an API restart. */
@Injectable()
export class AiService {
  private readonly logger = new Logger("AI");
  readonly setup: AiSetup;
  readonly provider: AiProvider | null;
  readonly contextChars: number;
  private readonly limiter: RateLimiter;
  private readonly completionLimiter: RateLimiter;
  private readonly gatewayLimiter: RateLimiter;
  private readonly usageTracker: UsageTracker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) redis: Redis,
    @Inject(DB) private readonly handle: DbHandle,
    private readonly messages: MessagesService,
  ) {
    this.setup = resolveAiSetup(env);
    this.provider = createProvider(this.setup.settings);
    // Ollama's default context window is small; a longer prompt loses its start (the instructions) silently.
    this.contextChars = env.AI_CONTEXT_CHARS ?? (this.setup.provider === "ollama" ? 8_000 : 48_000);
    this.limiter = new RateLimiter(redis, { limit: env.AI_RATE_LIMIT, windowSeconds: env.AI_RATE_WINDOW_SECONDS });
    // Inline completions come many to a minute while someone types, so they count in a bucket of their own.
    this.completionLimiter = new RateLimiter(redis, { limit: env.AI_COMPLETE_RATE_LIMIT, windowSeconds: COMPLETION.windowSeconds, prefix: "ai:complete" });
    this.gatewayLimiter = new RateLimiter(redis, { limit: Math.max(1, env.AI_GATEWAY_RATE_LIMIT), windowSeconds: env.AI_RATE_WINDOW_SECONDS, prefix: "ai:gateway" });
    this.usageTracker = new UsageTracker(redis);
    if (this.provider) this.logger.log(`AI copilot: ${this.setup.provider} (${this.setup.model})`);
    else this.logger.log(`AI copilot off: ${this.setup.problem}`);
  }

  private local: { at: number; value: AiStatus["ollama"] } | null = null;

  /**
   * Ollama on this server's machine, if it answers within a moment: the setup
   * panel offers its models, and with AI_PROVIDER=ollama it confirms the link.
   * Checked at most every 30 seconds.
   */
  async localOllama(): Promise<AiStatus["ollama"]> {
    if (this.setup.provider !== "none" && this.setup.provider !== "ollama") return null;
    if (this.local && Date.now() - this.local.at < 30_000) return this.local.value;
    const url = ollamaUrl(this.env);
    let value: AiStatus["ollama"] = null;
    if (url) {
      try {
        const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(600) });
        const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
        if (response.ok) value = { url, models: (body.models ?? []).map((m) => String(m.name ?? "")).filter(Boolean).slice(0, 50) };
      } catch {
        // Not installed or not running: nothing to offer.
      }
    }
    this.local = { at: Date.now(), value };
    return value;
  }

  async promptModels(): Promise<AiPromptModels> {
    const local = await this.localOllama();
    const anthropic = this.setup.provider === "anthropic";
    return {
      models: playableModels(this.setup, this.env, local?.models ?? []),
      default: this.setup.settings ? this.setup.model : null,
      // Current Claude models refuse sampling settings, and it has no JSON switch.
      temperature: !anthropic,
      json: !anthropic,
      oneAtATime: this.setup.provider === "ollama",
      contextChars: this.contextChars,
      gateway: { on: Boolean(this.setup.settings) && this.env.AI_GATEWAY_RATE_LIMIT > 0, requests: this.env.AI_GATEWAY_RATE_LIMIT, windowSeconds: this.env.AI_RATE_WINDOW_SECONDS },
      embedding: embeddingModelOf(this.setup, this.env, local?.models ?? []),
    };
  }

  status(): AiStatus {
    return aiStatus(this.setup, this.env);
  }

  hit(userId: string): Promise<RateDecision> {
    return this.limiter.hit(userId);
  }

  hitCompletion(userId: string): Promise<RateDecision> {
    return this.completionLimiter.hit(userId);
  }

  /** Inline completions allowed per person per minute. */
  get completionLimit(): number {
    return this.env.AI_COMPLETE_RATE_LIMIT;
  }

  hitGateway(roomId: string): Promise<RateDecision> {
    return this.gatewayLimiter.hit(roomId);
  }

  /** What the AI gateway needs to know about a room. Null when it's gone or archived. */
  async gatewayRoom(roomId: string): Promise<{ kind: "workspace" | "interview"; ownerId: string | null; guest: boolean } | null> {
    const { rooms, user } = schema;
    const [row] = await this.handle.db
      .select({ kind: rooms.kind, ownerId: rooms.createdBy, email: user.email, archivedAt: rooms.archivedAt })
      .from(rooms)
      .leftJoin(user, eq(rooms.createdBy, user.id))
      .where(eq(rooms.id, roomId))
      .limit(1);
    if (!row || row.archivedAt) return null;
    return { kind: row.kind, ownerId: row.ownerId, guest: row.email?.endsWith(`@${GUEST_DOMAIN}`) ?? false };
  }

  record(userId: string, tokens: AiTokenCount): Promise<void> {
    return this.usageTracker.record(userId, tokens);
  }

  async usage(userId: string): Promise<AiUsage> {
    const [totals, window] = await Promise.all([this.usageTracker.totals(userId), this.limiter.peek(userId)]);
    return { ...totals, rateLimit: { limit: this.env.AI_RATE_LIMIT, windowSeconds: this.env.AI_RATE_WINDOW_SECONDS, ...window } };
  }

  /** Chat since `since`, oldest first. */
  async chatSince(roomId: string, since: Date): Promise<ChatLine[]> {
    const page = await this.messages.list(roomId, { limit: 200 });
    return page
      .filter((m) => Date.parse(m.createdAt) >= since.getTime())
      .reverse()
      .map((m) => ({ createdAt: m.createdAt, author: m.author?.name ?? "Someone", kind: m.kind, body: m.body }));
  }

  /** Who saved edits to the room's documents since `since` (the update log keeps who and when, not what). */
  async activitySince(roomId: string, since: Date): Promise<ActivityRow[]> {
    const { docUpdates, user } = schema;
    const rows = await this.handle.db
      .select({ docName: docUpdates.docName, who: user.name, edits: count(), first: min(docUpdates.ts), last: max(docUpdates.ts) })
      .from(docUpdates)
      .leftJoin(user, eq(docUpdates.userId, user.id))
      // Room codes are 6 letters and digits, so they can't carry LIKE wildcards.
      // Someone's private notes (room:ID:mine:USER) aren't the room's activity.
      .where(and(like(docUpdates.docName, `room:${roomId}:%`), notLike(docUpdates.docName, `room:${roomId}:mine:%`), gte(docUpdates.ts, since)))
      .groupBy(docUpdates.docName, user.name)
      .limit(200);
    return rows.flatMap((row) => (row.first && row.last ? [{ docName: row.docName, who: row.who, edits: row.edits, first: row.first, last: row.last }] : []));
  }
}
