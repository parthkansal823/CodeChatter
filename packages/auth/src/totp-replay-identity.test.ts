/** Prove replay claims use a single trusted identity and fail closed when session/challenge resolution is missing, ambiguous or unavailable. */
import { APIError, getAuthoritativeSessionFromCtx } from "better-auth/api";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { totpReplayHooks } from "./totp-replay.js";

vi.mock("better-auth/api", async (original) => ({ ...await original<typeof import("better-auth/api")>(), getAuthoritativeSessionFromCtx: vi.fn() }));

function fixture({ sessionCookie = false, challengeCookie = false, signed = "valid-signed-challenge", expiresAt = new Date(Date.now() + 60_000) as unknown, userExists = true } = {}) {
  const redis = { status: "ready", set: vi.fn(async () => "OK"), eval: vi.fn(async () => 1) };
  const state = {
    authCookies: { sessionToken: { name: "custom.session" } },
    secret: "identity-unit-only-signing-secret",
    createAuthCookie: vi.fn(() => ({ name: "custom.challenge" })),
    internalAdapter: {
      findVerificationValue: vi.fn(async () => ({ value: "trusted-person", expiresAt })),
      findUserById: vi.fn(async () => userExists ? { id: "trusted-person" } : null),
    },
    getPlugin: vi.fn(() => ({ options: {} })),
  };
  const ctx = {
    path: "/two-factor/verify-totp", body: { code: "012345", userId: "untrusted-body-person" }, context: state,
    getCookie: vi.fn((name: string) => name === "custom.session" ? sessionCookie ? "opaque" : null : challengeCookie ? "opaque" : null),
    getSignedCookie: vi.fn(async () => signed),
  };
  return { redis, state, ctx: ctx as unknown as Parameters<ReturnType<typeof totpReplayHooks>["before"]>[0], guard: totpReplayHooks(redis as unknown as Redis, "identity-unit-only-key") };
}

describe("TOTP replay trusted identity", () => {
  beforeEach(() => vi.mocked(getAuthoritativeSessionFromCtx).mockReset().mockResolvedValue(null));

  it("rejects an unresolved identity instead of letting the plugin recover and authenticate unguarded", async () => {
    const f = fixture({ signed: "" });
    await expect(f.guard.before(f.ctx)).rejects.toMatchObject({ body: { code: "INVALID_TWO_FACTOR_COOKIE" } });
    expect(f.redis.set).not.toHaveBeenCalled();
  });

  it("rejects dual credentials before either authoritative lookup can race to a different person", async () => {
    const f = fixture({ sessionCookie: true, challengeCookie: true });
    await expect(f.guard.before(f.ctx)).rejects.toMatchObject({ body: { code: "INVALID_TWO_FACTOR_COOKIE" } });
    expect(getAuthoritativeSessionFromCtx).not.toHaveBeenCalled();
    expect(f.redis.set).not.toHaveBeenCalled();
  });

  it("uses the signed verification's trusted user rather than an identity from the body", async () => {
    const f = fixture({ challengeCookie: true });
    await f.guard.before(f.ctx);
    expect(f.state.internalAdapter.findUserById.mock.calls[0]?.[0] === "trusted-person").toBe(true);
    expect(f.redis.set).toHaveBeenCalledTimes(1);
    const key = f.redis.set.mock.calls[0]?.[0];
    expect(typeof key === "string" && !key.includes("untrusted-body-person")).toBe(true);
    await f.guard.after(f.ctx, new APIError("UNAUTHORIZED", { code: "INVALID_CODE" }));
    expect(f.redis.eval).toHaveBeenCalledTimes(1);
  });

  it.each([new Date(Date.now() - 1_000), "not-a-date"])("rejects an expired or malformed cached verification timestamp", async (expiresAt) => {
    const f = fixture({ challengeCookie: true, expiresAt });
    await expect(f.guard.before(f.ctx)).rejects.toMatchObject({ body: { code: "INVALID_TWO_FACTOR_COOKIE" } });
    expect(f.redis.set).not.toHaveBeenCalled();
  });

  it("rejects a challenge whose user no longer exists", async () => {
    const f = fixture({ challengeCookie: true, userExists: false });
    await expect(f.guard.before(f.ctx)).rejects.toMatchObject({ body: { code: "INVALID_TWO_FACTOR_COOKIE" } });
    expect(f.redis.set).not.toHaveBeenCalled();
  });

  it("sanitises identity-store exceptions and never starts an unguarded verification", async () => {
    const f = fixture({ sessionCookie: true });
    vi.mocked(getAuthoritativeSessionFromCtx).mockRejectedValueOnce(new Error("sensitive underlying store exception"));
    await expect(f.guard.before(f.ctx)).rejects.toMatchObject({ body: { code: "TOTP_REPLAY_STORE_UNAVAILABLE", message: "Couldn't check this code right now. Try again shortly." } });
    expect(f.redis.set).not.toHaveBeenCalled();
  });
});
