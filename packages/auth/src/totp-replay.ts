/** Reserve TOTP attempts atomically before Better Auth can authenticate, release definite rejections, and retain accepted codes across devices for their full validity span. */
import { createHmac, randomUUID } from "node:crypto";

import { APIError, getAuthoritativeSessionFromCtx, isAPIError } from "better-auth/api";
import type { Redis } from "ioredis";

// Installed Better Auth: period defaults to 30 seconds; createOTP.verify defaults
// to the current counter and one either side. A code can span three periods.
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_STORE_TIMEOUT_MS = 2_000;
const REUSED_MESSAGE = "That code has just been used. Wait for the next one.";
const UNAVAILABLE_MESSAGE = "Couldn't check this code right now. Try again shortly.";
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

// These installed-plugin errors precede a successful verification/session. Other
// failures may follow side effects: retain that claim rather than permit replay.
const REJECTED = new Set(["INVALID_CODE", "VALIDATION_ERROR", "TOTP_NOT_ENABLED", "TOTP_NOT_CONFIGURED", "INVALID_TWO_FACTOR_COOKIE", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", "ACCOUNT_TEMPORARILY_LOCKED"]);
type HookContext = Parameters<typeof getAuthoritativeSessionFromCtx>[0];
export type TotpClaim = { key: string; owner: string };
type ReplayStore = Pick<Redis, "set" | "eval" | "status">;

const unavailable = () => new APIError("SERVICE_UNAVAILABLE", { code: "TOTP_REPLAY_STORE_UNAVAILABLE", message: UNAVAILABLE_MESSAGE });
const invalidIdentity = () => new APIError("UNAUTHORIZED", { code: "INVALID_TWO_FACTOR_COOKIE", message: "Your sign-in check expired. Please sign in again." });

/** A timeout is an uncertain claim, never permission to continue authenticating. */
async function bounded<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(unavailable()), TOTP_STORE_TIMEOUT_MS); }),
    ]);
  } catch {
    // Never include Redis errors: they may contain command arguments or URLs.
    throw unavailable();
  } finally { clearTimeout(timer); }
}

/** Claims are reservations until the plugin accepts or definitively rejects the code. */
export function totpReplayClaims(redis: ReplayStore, secret: string) {
  return {
    async claim(userId: string, code: string, periodSeconds = TOTP_PERIOD_SECONDS): Promise<TotpClaim> {
      if (redis.status !== "ready" || !Number.isFinite(periodSeconds) || periodSeconds <= 0) throw unavailable();
      // HMAC prevents a storage reader guessing a six-digit code from a known ID.
      const hash = createHmac("sha256", secret).update(JSON.stringify([userId, code])).digest("hex");
      const claim = { key: `cc:totp-used:v1:${hash}`, owner: randomUUID() };
      const ttl = Math.ceil(periodSeconds * (2 * TOTP_WINDOW_STEPS + 1) * 1_000);
      const result = await bounded(() => redis.set(claim.key, claim.owner, "PX", ttl, "NX"));
      if (result === null) throw new APIError("UNAUTHORIZED", { code: "TOTP_CODE_ALREADY_USED", message: REUSED_MESSAGE });
      if (result !== "OK") throw unavailable();
      return claim;
    },
    async reject(claim: TotpClaim, result: unknown): Promise<void> {
      if (!isAPIError(result) || !REJECTED.has(result.body?.code ?? "")) return;
      try {
        if (redis.status !== "ready") return;
        // A late failed request must never delete a newer request's accepted key.
        await bounded(() => redis.eval(RELEASE, 1, claim.key, claim.owner));
      } catch { /* Conservative expiry if cleanup is uncertain; never fail open. */ }
    },
  };
}

/** Use the same authoritative session or signed challenge identity as the installed plugin. */
export function totpReplayHooks(redis: ReplayStore, secret: string) {
  const claims = totpReplayClaims(redis, secret);
  // Better Auth preserves this nested context across the before/after hooks;
  // WeakMap keeps the ownership marker out of returned JSON and request bodies.
  const pending = new WeakMap<object, TotpClaim>();
  return {
    async before(ctx: HookContext): Promise<void> {
      if (ctx.path !== "/two-factor/verify-totp") return;
      const body = ctx.body as { code?: unknown } | undefined;
      if (typeof body?.code !== "string") return; // Plugin owns input validation.
      const cookie = ctx.context.createAuthCookie("two_factor");
      const hasSession = Boolean(ctx.getCookie(ctx.context.authCookies.sessionToken.name));
      const hasChallenge = Boolean(ctx.getCookie(cookie.name));
      // The plugin repeats its authoritative lookup. Reject ambiguous credentials
      // so a session revocation/recovery cannot switch the user after our claim.
      if (hasSession && hasChallenge) throw invalidIdentity();
      let userId: string;
      try {
        const session = await getAuthoritativeSessionFromCtx(ctx);
        if (session) userId = session.user.id;
        else {
          const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
          if (!signed) throw invalidIdentity();
          const verification = await ctx.context.internalAdapter.findVerificationValue(signed);
          const expires = verification ? new Date(verification.expiresAt).getTime() : NaN;
          if (!verification || !Number.isFinite(expires) || expires <= Date.now()) throw invalidIdentity();
          const user = await ctx.context.internalAdapter.findUserById(verification.value);
          if (!user) throw invalidIdentity();
          userId = user.id;
        }
      } catch (error) {
        if (isAPIError(error) && error.body?.code === "INVALID_TWO_FACTOR_COOKIE") throw error;
        throw unavailable();
      }
      const plugin = ctx.context.getPlugin("two-factor");
      const options = plugin?.options as { totpOptions?: { period?: number } } | undefined;
      const claim = await claims.claim(userId, body.code, options?.totpOptions?.period || TOTP_PERIOD_SECONDS);
      pending.set(ctx.context, claim);
    },
    async after(ctx: HookContext, result: unknown): Promise<void> {
      if (ctx.path !== "/two-factor/verify-totp") return;
      const claim = pending.get(ctx.context);
      pending.delete(ctx.context);
      if (claim) await claims.reject(claim, result);
    },
  };
}
