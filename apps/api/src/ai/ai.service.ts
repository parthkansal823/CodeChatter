import type { AiStatus, AiTokenCount, AiUsage } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, count, eq, gte, like, max, min } from "drizzle-orm";
import type { Redis } from "ioredis";

import type { Env } from "../config/env.js";
import { DB, ENV, VALKEY } from "../infra/tokens.js";
import { MessagesService } from "../messages/messages.service.js";
import { aiStatus, resolveAiSetup, type AiSetup } from "./ai.config.js";
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
  private readonly usageTracker: UsageTracker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) redis: Redis,
    @Inject(DB) private readonly handle: DbHandle,
    private readonly messages: MessagesService,
  ) {
    this.setup = resolveAiSetup(env);
    this.provider = createProvider(this.setup.settings);
    this.contextChars = env.AI_CONTEXT_CHARS;
    this.limiter = new RateLimiter(redis, { limit: env.AI_RATE_LIMIT, windowSeconds: env.AI_RATE_WINDOW_SECONDS });
    this.usageTracker = new UsageTracker(redis);
    if (this.provider) this.logger.log(`AI copilot: ${this.setup.provider} (${this.setup.model})`);
    else this.logger.log(`AI copilot off: ${this.setup.problem}`);
  }

  status(): AiStatus {
    return aiStatus(this.setup, this.env);
  }

  hit(userId: string): Promise<RateDecision> {
    return this.limiter.hit(userId);
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
      .where(and(like(docUpdates.docName, `room:${roomId}:%`), gte(docUpdates.ts, since)))
      .groupBy(docUpdates.docName, user.name)
      .limit(200);
    return rows.flatMap((row) => (row.first && row.last ? [{ docName: row.docName, who: row.who, edits: row.edits, first: row.first, last: row.last }] : []));
  }
}
