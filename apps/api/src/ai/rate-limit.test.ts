import { describe, expect, it } from "vitest";

import { RateLimiter, rateLimitMessage, slidingWindow, windowUsage } from "./rate-limit.js";

const W = 600_000;

describe("slidingWindow", () => {
  it("allows up to the limit in a fresh window", () => {
    expect(slidingWindow({ now: 0, windowMs: W, limit: 30, previous: 0, current: 30 }).allowed).toBe(true);
    expect(slidingWindow({ now: 0, windowMs: W, limit: 30, previous: 0, current: 31 }).allowed).toBe(false);
  });

  it("weights the previous window by how much of it still overlaps", () => {
    // Halfway through: 30 last window count as 15.
    expect(slidingWindow({ now: W / 2, windowMs: W, limit: 30, previous: 30, current: 15 }).allowed).toBe(true);
    expect(slidingWindow({ now: W / 2, windowMs: W, limit: 30, previous: 30, current: 16 }).allowed).toBe(false);
  });

  it("says how long until one more request fits", () => {
    // Full current window: wait for it to end, then until 29/30 of it has faded… nearly the whole next window.
    const full = slidingWindow({ now: 0, windowMs: W, limit: 30, previous: 0, current: 31 });
    expect(full.retryAfterSeconds).toBe(600 + 20);
    // Half the previous window still counts: wait until one request's weight fades.
    const fading = slidingWindow({ now: W / 2, windowMs: W, limit: 30, previous: 30, current: 16 });
    expect(fading.retryAfterSeconds).toBe(20);
    expect(fading.retryAfterSeconds).toBeGreaterThan(0);
  });
});

/** Just enough of ioredis for the limiter: MULTI get/incr/pexpire, and decr. */
function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    multi() {
      const ops: Array<() => unknown> = [];
      const chain = {
        get: (key: string) => (ops.push(() => (store.has(key) ? String(store.get(key)) : null)), chain),
        incr: (key: string) => (ops.push(() => store.set(key, (store.get(key) ?? 0) + 1).get(key)), chain),
        pexpire: (_key: string, _ms: number) => (ops.push(() => 1), chain),
        exec: async () => ops.map((op) => [null, op()] as [null, unknown]),
      };
      return chain;
    },
    async decr(key: string) {
      store.set(key, (store.get(key) ?? 0) - 1);
      return store.get(key)!;
    },
  };
}

describe("RateLimiter", () => {
  it("refuses the request over the limit without counting it", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter(redis as never, { limit: 3, windowSeconds: 600 });
    const now = 1_000 * W; // the start of a window
    for (let i = 0; i < 3; i++) expect((await limiter.hit("u1", now)).allowed).toBe(true);
    const refused = await limiter.hit("u1", now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(redis.store.get("ai:rate:u1:1000")).toBe(3);
    // Someone else is unaffected.
    expect((await limiter.hit("u2", now)).allowed).toBe(true);
  });

  it("lets requests through again after the wait it asked for", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter(redis as never, { limit: 3, windowSeconds: 600 });
    const start = 1_000 * W + W / 2;
    for (let i = 0; i < 3; i++) await limiter.hit("u1", start);
    const refused = await limiter.hit("u1", start);
    expect(refused.allowed).toBe(false);
    expect((await limiter.hit("u1", start + refused.retryAfterSeconds * 1000 - 5_000)).allowed).toBe(false);
    expect((await limiter.hit("u1", start + refused.retryAfterSeconds * 1000)).allowed).toBe(true);
  });
});

describe("windowUsage", () => {
  it("reports used and remaining without a request being counted", () => {
    expect(windowUsage({ now: 0, windowMs: W, limit: 30, previous: 0, current: 4 })).toEqual({ used: 4, remaining: 26, resetSeconds: 0 });
    // Halfway through, half of last window's 30 still counts.
    expect(windowUsage({ now: W / 2, windowMs: W, limit: 30, previous: 30, current: 5 })).toEqual({ used: 20, remaining: 10, resetSeconds: 0 });
  });

  it("says when the next request fits once the limit is reached", () => {
    const full = windowUsage({ now: 0, windowMs: W, limit: 30, previous: 0, current: 30 });
    expect(full).toMatchObject({ used: 30, remaining: 0 });
    expect(full.resetSeconds).toBeGreaterThan(0);
    // A fractional estimate just under the limit leaves nothing: a whole request wouldn't fit.
    expect(windowUsage({ now: W / 2, windowMs: W, limit: 30, previous: 29, current: 15 }).remaining).toBe(0);
  });
});

describe("RateLimiter.peek", () => {
  it("matches what hit() has counted and never counts itself", async () => {
    const redis = fakeRedis();
    const limiter = new RateLimiter(redis as never, { limit: 3, windowSeconds: 600 });
    const now = 1_000 * W;
    await limiter.hit("u1", now);
    await limiter.hit("u1", now);
    expect(await limiter.peek("u1", now)).toEqual({ used: 2, remaining: 1, resetSeconds: 0 });
    expect(await limiter.peek("u1", now)).toEqual({ used: 2, remaining: 1, resetSeconds: 0 });
    await limiter.hit("u1", now);
    expect((await limiter.peek("u1", now)).remaining).toBe(0);
    expect((await limiter.peek("u1", now)).resetSeconds).toBeGreaterThan(0);
  });
});

describe("rateLimitMessage", () => {
  it("is friendly and specific", () => {
    expect(rateLimitMessage(30, 600, 125)).toBe("You've used your 30 AI requests for the last 10 minutes. Try again in about 3 minutes.");
    expect(rateLimitMessage(1, 60, 1)).toBe("You've used your 1 AI request for the last 1 minute. Try again in about 1 second.");
  });
});
