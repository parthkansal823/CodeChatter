import { describe, expect, it } from "vitest";

import { estimateTokens, estimateUsage, UsageTracker } from "./usage.js";

/** Just enough of ioredis for the tracker: MULTI with hincrby / expire / hgetall. */
function fakeRedis() {
  const hashes = new Map<string, Record<string, string>>();
  const ttl = new Map<string, number>();
  return {
    hashes,
    ttl,
    multi() {
      const ops: Array<() => unknown> = [];
      const chain = {
        hincrby: (key: string, field: string, by: number) => {
          ops.push(() => {
            const hash = hashes.get(key) ?? {};
            hash[field] = String(Number(hash[field] ?? 0) + by);
            hashes.set(key, hash);
            return Number(hash[field]);
          });
          return chain;
        },
        expire: (key: string, seconds: number) => (ops.push(() => ttl.set(key, seconds)), chain),
        hgetall: (key: string) => (ops.push(() => ({ ...(hashes.get(key) ?? {}) })), chain),
        exec: async () => ops.map((op) => [null, op()] as [null, unknown]),
      };
      return chain;
    },
  };
}

describe("estimateUsage", () => {
  it("counts about four characters a token, plus a fixed amount for an image", () => {
    expect(estimateTokens(10)).toBe(3);
    const request = { system: "x".repeat(400), messages: [{ role: "user" as const, content: "y".repeat(200) }] };
    expect(estimateUsage(request, 80)).toEqual({ inputTokens: 150, outputTokens: 20, estimated: true });
    expect(estimateUsage({ ...request, image: { mediaType: "image/png", data: "AAAA" } }, 0).inputTokens).toBe(1150);
  });
});

describe("UsageTracker", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("adds up today and the last 30 days, per person", async () => {
    const redis = fakeRedis();
    const tracker = new UsageTracker(redis as never);
    await tracker.record("u1", { inputTokens: 100, outputTokens: 50, estimated: false }, now);
    await tracker.record("u1", { inputTokens: 200, outputTokens: 70, estimated: true }, now);
    await tracker.record("u1", { inputTokens: 1000, outputTokens: 500, estimated: false }, new Date("2026-09-20T09:00:00Z"));
    await tracker.record("u1", { inputTokens: 9, outputTokens: 9, estimated: false }, new Date("2026-08-01T09:00:00Z"));
    await tracker.record("u2", { inputTokens: 7, outputTokens: 7, estimated: false }, now);

    const { today, last30Days } = await tracker.totals("u1", now);
    expect(today).toEqual({ requests: 2, inputTokens: 300, outputTokens: 120, estimated: true });
    // The August request is outside the window.
    expect(last30Days).toEqual({ requests: 3, inputTokens: 1300, outputTokens: 620, estimated: true });
    expect((await tracker.totals("u3", now)).today).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0, estimated: false });
  });

  it("is exact when every request reported its tokens, and expires old days", async () => {
    const redis = fakeRedis();
    const tracker = new UsageTracker(redis as never);
    await tracker.record("u1", { inputTokens: 5, outputTokens: 6, estimated: false }, now);
    expect((await tracker.totals("u1", now)).today.estimated).toBe(false);
    expect(redis.ttl.get("ai:usage:u1:2026-10-01")).toBeGreaterThan(30 * 86_400);
  });
});
