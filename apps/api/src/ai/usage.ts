import type { AiTokenCount, AiUsageTotals } from "@codechatter/contracts";
import type { Redis } from "ioredis";

import type { ModelRequest } from "./prompts.js";

/** About four characters a token for English and code: close enough for a counter that says "about". */
export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

const IMAGE_TOKENS = 1000;

export function estimateUsage(request: ModelRequest, outputChars: number): AiTokenCount {
  const chars = request.system.length + request.messages.reduce((sum, turn) => sum + turn.content.length, 0);
  return { inputTokens: estimateTokens(chars) + (request.image ? IMAGE_TOKENS : 0), outputTokens: estimateTokens(outputChars), estimated: true };
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const DAYS = 30;
const KEEP_SECONDS = (DAYS + 2) * 86_400;

type Counter = Pick<Redis, "multi">;

const empty = (): AiUsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, estimated: false });

/** Per-person usage, one Valkey hash per UTC day, kept a month. Counts only: no prompts or answers are stored. */
export class UsageTracker {
  constructor(
    private readonly redis: Counter,
    private readonly prefix = "ai:usage",
  ) {}

  private key(userId: string, day: string) {
    return `${this.prefix}:${userId}:${day}`;
  }

  async record(userId: string, tokens: AiTokenCount, now = new Date()): Promise<void> {
    const key = this.key(userId, dayKey(now));
    await this.redis
      .multi()
      .hincrby(key, "requests", 1)
      .hincrby(key, "in", tokens.inputTokens)
      .hincrby(key, "out", tokens.outputTokens)
      .hincrby(key, "est", tokens.estimated ? 1 : 0)
      .expire(key, KEEP_SECONDS)
      .exec();
  }

  async totals(userId: string, now = new Date()): Promise<{ today: AiUsageTotals; last30Days: AiUsageTotals }> {
    const pipeline = this.redis.multi();
    for (let i = 0; i < DAYS; i++) pipeline.hgetall(this.key(userId, dayKey(new Date(now.getTime() - i * 86_400_000))));
    const results = (await pipeline.exec()) ?? [];
    const today = empty();
    const month = empty();
    results.forEach(([error, hash], index) => {
      if (error) throw error;
      const row = (hash ?? {}) as Record<string, string>;
      for (const target of index === 0 ? [today, month] : [month]) {
        target.requests += Number(row.requests ?? 0);
        target.inputTokens += Number(row.in ?? 0);
        target.outputTokens += Number(row.out ?? 0);
        target.estimated ||= Number(row.est ?? 0) > 0;
      }
    });
    return { today, last30Days: month };
  }
}
