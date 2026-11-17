/** Run the installed Better Auth TOTP endpoint against the real hooks to prove rejection cleanup, enrollment protection and session-free concurrent replay denial. */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { totpReplayHooks } from "./totp-replay.js";

const ORIGIN = "http://localhost:8080";
const SECRET = "unit-only-better-auth-replay-secret-with-sufficient-length";
const PASSWORD = "unit-only-password-for-disposable-memory-users";

async function fixture() {
  const records: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], verification: [], twoFactor: [] };
  const claims = new Map<string, { value: string; expires: number }>();
  const secondary = new Map<string, { value: string; expires: number }>();
  const raw = {
    status: "ready",
    set: async (key: string, value: string, _px: string, ttl: number, _nx: string) => {
      const current = claims.get(key);
      if (current && current.expires > Date.now()) return null;
      claims.set(key, { value, expires: Date.now() + ttl });
      return "OK";
    },
    eval: async (_script: string, _count: number, key: string, owner: string) => {
      if (claims.get(key)?.value !== owner) return 0;
      claims.delete(key);
      return 1;
    },
  };
  const replay = totpReplayHooks(raw as unknown as Redis, SECRET);
  const read = (key: string) => {
    const item = secondary.get(key);
    if (!item || item.expires <= Date.now()) { secondary.delete(key); return null; }
    return item.value;
  };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: SECRET,
    database: memoryAdapter(records),
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    advanced: { cookiePrefix: "cc", useSecureCookies: false },
    session: { cookieCache: { enabled: false } },
    plugins: [twoFactor({ issuer: "CodeChatter" })],
    secondaryStorage: {
      get: async (key) => read(key),
      set: async (key, value, ttl) => { secondary.set(key, { value, expires: ttl ? Date.now() + ttl * 1_000 : Infinity }); },
      delete: async (key) => { secondary.delete(key); },
      getAndDelete: async (key) => { const value = read(key); secondary.delete(key); return value; },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => { await replay.before(ctx); }),
      after: createAuthMiddleware(async (ctx) => { await replay.after(ctx, ctx.context.returned); }),
    },
  });
  function person() {
    const cookies = new Map<string, string>();
    return {
      async call(path: string, body?: unknown) {
        const response = await auth.handler(new Request(`${ORIGIN}/api/auth/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: { origin: ORIGIN, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...(body !== undefined && { "content-type": "application/json" }) },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }));
        const set = response.headers.getSetCookie();
        for (const cookie of set) {
          const pair = cookie.split(";", 1)[0]!;
          const at = pair.indexOf("=");
          if (/max-age=0/i.test(cookie)) cookies.delete(pair.slice(0, at));
          else cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
        return { status: response.status, body: await response.json().catch(() => null) as Record<string, unknown> | null, set };
      },
    };
  }
  const signed = person();
  const created = await signed.call("sign-up/email", { name: "Disposable memory user", email: "unit@codechatter.local", password: PASSWORD });
  expect(created.status === 200).toBe(true);
  expect((await signed.call("two-factor/enable", { password: PASSWORD })).status === 200).toBe(true);
  const encrypted = records.twoFactor?.[0]?.secret;
  expect(typeof encrypted === "string").toBe(true);
  const seed = await symmetricDecrypt({ key: SECRET, data: encrypted as string });
  const code = async () => (await auth.api.generateTOTP({ body: { secret: seed } })).code;
  const challenge = async () => {
    const caller = person();
    const result = await caller.call("sign-in/email", { email: "unit@codechatter.local", password: PASSWORD });
    expect(result.status === 200 && result.body?.twoFactorRedirect === true).toBe(true);
    return caller;
  };
  return { auth, records, claims, raw, signed, code, challenge };
}

describe("installed TOTP plugin with replay hooks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("undoes wrong-code reservations, consumes enrollment, and refuses another challenge before any session or trust cookie", async () => {
    const f = await fixture();
    const code = await f.code();
    const wrong = `${code[0] === "0" ? "1" : "0"}${code.slice(1)}`;
    for (let i = 0; i < 2; i++) {
      const result = await f.signed.call("two-factor/verify-totp", { code: wrong });
      expect(result.body?.code === "INVALID_CODE").toBe(true);
      expect(f.claims.size).toBe(0);
    }
    expect((await f.signed.call("two-factor/verify-totp", { code })).status === 200).toBe(true);
    expect(f.records.user?.[0]?.twoFactorEnabled === true && f.records.twoFactor?.[0]?.verified === true).toBe(true);
    expect(f.claims.size).toBe(1);
    const other = await f.challenge();
    const denied = await other.call("two-factor/verify-totp", { code, trustDevice: true });
    expect(denied.status === 401 && denied.body?.code === "TOTP_CODE_ALREADY_USED").toBe(true);
    expect(denied.set.some((cookie) => /cc\.(session_token|trust_device)=/.test(cookie))).toBe(false);
    expect((await other.call("get-session")).body === null).toBe(true);
    expect((await f.signed.call("get-session")).body !== null).toBe(true);
  });

  it("lets only one of two independent challenges authenticate concurrently, then permits the next code in the rejected challenge", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const f = await fixture();
    const enrollment = await f.code();
    expect((await f.signed.call("two-factor/verify-totp", { code: enrollment })).status === 200).toBe(true);
    const [one, two] = await Promise.all([f.challenge(), f.challenge()]);
    clock.mockReturnValue(Date.now() + 30_000);
    let next = await f.code();
    if (next === enrollment) { clock.mockReturnValue(Date.now() + 30_000); next = await f.code(); }
    const results = await Promise.all([one.call("two-factor/verify-totp", { code: next, trustDevice: true }), two.call("two-factor/verify-totp", { code: next, trustDevice: true })]);
    expect(results.filter((r) => r.status === 200).length).toBe(1);
    expect(results.filter((r) => r.status === 401 && r.body?.code === "TOTP_CODE_ALREADY_USED").length).toBe(1);
    const loser = results[0]?.status === 200 ? two : one;
    expect((await loser.call("get-session")).body === null).toBe(true);
    clock.mockReturnValue(Date.now() + 30_000);
    let retry = await f.code();
    if ([next, enrollment].includes(retry)) { clock.mockReturnValue(Date.now() + 30_000); retry = await f.code(); }
    expect((await loser.call("two-factor/verify-totp", { code: retry })).status === 200).toBe(true);
    expect((await loser.call("get-session")).body !== null).toBe(true);
  });

  it("fails closed before enrollment mutations when replay storage is down, and permits retry after recovery", async () => {
    const f = await fixture();
    const code = await f.code();
    f.raw.status = "reconnecting";
    const result = await f.signed.call("two-factor/verify-totp", { code });
    expect(result.status === 503 && result.body?.code === "TOTP_REPLAY_STORE_UNAVAILABLE").toBe(true);
    expect(f.records.user?.[0]?.twoFactorEnabled !== true && f.records.twoFactor?.[0]?.verified !== true).toBe(true);
    expect(f.claims.size).toBe(0);
    f.raw.status = "ready";
    expect((await f.signed.call("two-factor/verify-totp", { code })).status === 200).toBe(true);
  });
});
