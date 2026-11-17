/** Check atomic, hashed, bounded TOTP reservations and safe cleanup without a real account or printing authenticator material. */
import { APIError } from "better-auth/api";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOTP_STORE_TIMEOUT_MS, totpReplayClaims } from "./totp-replay.js";

function store() {
  const values = new Map<string, { value: string; expires: number }>();
  const fake = {
    status: "ready",
    set: vi.fn(async (key: string, value: string, px: string, ttl: number, nx: string) => {
      expect(px === "PX" && nx === "NX").toBe(true);
      const existing = values.get(key);
      if (existing && existing.expires > Date.now()) return null;
      values.set(key, { value, expires: Date.now() + ttl });
      return "OK";
    }),
    eval: vi.fn(async (_script: string, count: number, key: string, owner: string) => {
      expect(count).toBe(1);
      if (values.get(key)?.value !== owner) return 0;
      values.delete(key);
      return 1;
    }),
  };
  return { values, fake, redis: fake as unknown as Redis };
}
const KEY = "unit-only-replay-hmac-key-with-sufficient-length";
const code = "012345";
const invalid = () => new APIError("UNAUTHORIZED", { code: "INVALID_CODE", message: "Invalid code" });

describe("TOTP replay reservations", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts once, refuses another device's same code, and permits another person's identical code", async () => {
    const { redis } = store();
    const guard = totpReplayClaims(redis, KEY);
    await guard.claim("person-a", code);
    await expect(guard.claim("person-a", code)).rejects.toMatchObject({ status: "UNAUTHORIZED", body: { code: "TOTP_CODE_ALREADY_USED", message: "That code has just been used. Wait for the next one." } });
    await expect(guard.claim("person-b", code)).resolves.toBeDefined();
  });

  it("forgets a plugin-rejected wrong code without consuming a different correct one", async () => {
    const { redis, values } = store();
    const guard = totpReplayClaims(redis, KEY);
    const reservation = await guard.claim("person", code);
    await guard.reject(reservation, invalid());
    expect(values.size).toBe(0);
    await expect(guard.claim("person", code)).resolves.toBeDefined();
    await expect(guard.claim("person", "654321")).resolves.toBeDefined();
  });

  it("allows exactly one simultaneous claim", async () => {
    const { redis } = store();
    const guard = totpReplayClaims(redis, KEY);
    const results = await Promise.allSettled([guard.claim("person", code), guard.claim("person", code)]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
  });

  it("stores only a keyed hash of person and code, with a noncredential ownership marker", async () => {
    const { redis, fake } = store();
    const guard = totpReplayClaims(redis, KEY);
    const reservation = await guard.claim("private-person-id", code);
    expect(reservation.key.startsWith("cc:totp-used:v1:")).toBe(true);
    expect(reservation.key.includes(code) || reservation.key.includes("private-person-id") || reservation.key.includes(KEY)).toBe(false);
    expect(fake.set.mock.calls[0][1] === code).toBe(false);
    expect(fake.set.mock.calls[0][3]).toBe(90_000);
    const other = await totpReplayClaims(store().redis, "another-unit-only-key").claim("private-person-id", code);
    expect(other.key === reservation.key).toBe(false);
  });

  it("keeps a code through the whole adjacent-window validity span across a period edge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T00:00:29.999Z"));
    const guard = totpReplayClaims(store().redis, KEY);
    await guard.claim("person", code);
    vi.advanceTimersByTime(89_999);
    await expect(guard.claim("person", code)).rejects.toMatchObject({ body: { code: "TOTP_CODE_ALREADY_USED" } });
    vi.advanceTimersByTime(1);
    await expect(guard.claim("person", code)).resolves.toBeDefined();
  });

  it("uses the configured plugin period, including nondefault periods", async () => {
    const { redis, fake } = store();
    await totpReplayClaims(redis, KEY).claim("person", code, 60);
    expect(fake.set.mock.calls[0][3]).toBe(180_000);
  });

  it("does not let an old rejection delete a newer accepted claim after expiry", async () => {
    vi.useFakeTimers();
    const { redis, values } = store();
    const guard = totpReplayClaims(redis, KEY);
    const first = await guard.claim("person", code);
    vi.advanceTimersByTime(90_001);
    const second = await guard.claim("person", code);
    await guard.reject(first, invalid());
    expect(values.get(second.key)?.value === second.owner).toBe(true);
  });

  it("retains successful and ambiguous failures because authentication may have happened", async () => {
    const { redis, values } = store();
    const guard = totpReplayClaims(redis, KEY);
    const claim = await guard.claim("person", code);
    for (const result of [{ user: {} }, new Error("uncertain"), new APIError("INTERNAL_SERVER_ERROR", { code: "FAILED_TO_CREATE_SESSION" })]) await guard.reject(claim, result);
    expect(values.size).toBe(1);
  });

  it("fails closed without leaking store exceptions when disconnected or SET fails", async () => {
    const { redis, fake } = store();
    fake.status = "reconnecting";
    await expect(totpReplayClaims(redis, KEY).claim("person", code)).rejects.toMatchObject({ status: "SERVICE_UNAVAILABLE", body: { code: "TOTP_REPLAY_STORE_UNAVAILABLE" } });
    expect(fake.set).not.toHaveBeenCalled();
    fake.status = "ready";
    fake.set.mockRejectedValueOnce(new Error("sensitive store error"));
    await expect(totpReplayClaims(redis, KEY).claim("person", code)).rejects.toMatchObject({ body: { message: "Couldn't check this code right now. Try again shortly." } });
  });

  it("times out a queued command and never treats an uncertain result as acceptance", async () => {
    vi.useFakeTimers();
    const { redis, fake } = store();
    fake.set.mockImplementationOnce(() => new Promise(() => {}));
    const result = totpReplayClaims(redis, KEY).claim("person", code);
    const assertion = expect(result).rejects.toMatchObject({ body: { code: "TOTP_REPLAY_STORE_UNAVAILABLE" } });
    await vi.advanceTimersByTimeAsync(TOTP_STORE_TIMEOUT_MS);
    await assertion;
  });

  it("fails safely if cleanup storage is away; the reservation expires naturally", async () => {
    const { redis, fake, values } = store();
    const guard = totpReplayClaims(redis, KEY);
    const claim = await guard.claim("person", code);
    fake.eval.mockRejectedValueOnce(new Error("unavailable"));
    await guard.reject(claim, invalid());
    expect(values.size).toBe(1);
  });
});
