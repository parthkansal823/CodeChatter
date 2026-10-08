import type { Redis } from "ioredis";

export type RateDecision = { allowed: boolean; retryAfterSeconds: number };

/**
 * Sliding-window estimate from two fixed windows (the approach Cloudflare
 * describes): the previous window's count is weighted by how much of it
 * still overlaps the last `windowMs`. Two counters per person, no bursts
 * of 2x at window edges. `current` includes the request being decided.
 */
export function slidingWindow(input: { now: number; windowMs: number; limit: number; previous: number; current: number }): RateDecision {
  const { now, windowMs: w, limit, previous, current } = input;
  const elapsed = now % w;
  const estimate = (previous * (w - elapsed)) / w + current;
  if (estimate <= limit) return { allowed: true, retryAfterSeconds: 0 };

  // The rejected request isn't counted. Find when one more would fit.
  const counted = current - 1;
  let waitMs: number;
  if (counted < limit && previous > 0) {
    // Within this window, as the previous window's weight fades.
    waitMs = w - elapsed - ((limit - counted - 1) * w) / previous;
  } else {
    // Only after this window ends, once this window's count has faded enough.
    waitMs = w - elapsed + (counted > 0 ? Math.max(0, w - ((limit - 1) * w) / counted) : 0);
  }
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}

export type WindowUsage = { used: number; remaining: number; resetSeconds: number };

/** Where someone stands in the window right now, without counting a request. */
export function windowUsage(input: { now: number; windowMs: number; limit: number; previous: number; current: number }): WindowUsage {
  const { now, windowMs: w, limit, previous, current } = input;
  const estimate = (previous * (w - (now % w))) / w + current;
  const remaining = Math.max(0, Math.floor(limit - estimate + 1e-9));
  const used = Math.min(limit, Math.ceil(estimate - 1e-9));
  const resetSeconds = remaining > 0 ? 0 : slidingWindow({ now, windowMs: w, limit, previous, current: current + 1 }).retryAfterSeconds;
  return { used, remaining, resetSeconds };
}

type Counter = Pick<Redis, "multi" | "decr">;

/** Per-person AI request limit, shared by every API instance through Valkey. */
export class RateLimiter {
  constructor(
    private readonly redis: Counter,
    private readonly options: { limit: number; windowSeconds: number; prefix?: string },
  ) {}

  async peek(userId: string, now = Date.now()): Promise<WindowUsage> {
    const windowMs = this.options.windowSeconds * 1000;
    const index = Math.floor(now / windowMs);
    const key = (i: number) => `${this.options.prefix ?? "ai:rate"}:${userId}:${i}`;
    const results = await this.redis.multi().get(key(index - 1)).get(key(index)).exec();
    if (!results) throw new Error("Rate limit transaction was aborted.");
    for (const [error] of results) if (error) throw error;
    return windowUsage({ now, windowMs, limit: this.options.limit, previous: Number(results[0]![1] ?? 0), current: Number(results[1]![1] ?? 0) });
  }

  async hit(userId: string, now = Date.now()): Promise<RateDecision> {
    const windowMs = this.options.windowSeconds * 1000;
    const index = Math.floor(now / windowMs);
    const key = (i: number) => `${this.options.prefix ?? "ai:rate"}:${userId}:${i}`;
    const results = await this.redis.multi().get(key(index - 1)).incr(key(index)).pexpire(key(index), windowMs * 2).exec();
    if (!results) throw new Error("Rate limit transaction was aborted.");
    for (const [error] of results) if (error) throw error;
    const previous = Number(results[0]![1] ?? 0);
    const current = Number(results[1]![1]);
    const decision = slidingWindow({ now, windowMs, limit: this.options.limit, previous, current });
    // A refused request doesn't count, so waiting it out always works.
    if (!decision.allowed) await this.redis.decr(key(index));
    return decision;
  }
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const duration = (seconds: number) => (seconds < 60 ? count(seconds, "second") : count(Math.ceil(seconds / 60), "minute"));

export function rateLimitMessage(limit: number, windowSeconds: number, retryAfterSeconds: number): string {
  return `You've used your ${count(limit, "AI request")} for the last ${duration(windowSeconds)}. Try again in about ${duration(retryAfterSeconds)}.`;
}
