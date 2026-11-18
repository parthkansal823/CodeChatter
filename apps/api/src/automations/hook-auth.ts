/**
 * What a call to a webhook must show besides its secret address, as n8n's Webhook node asks: a header with a value, basic auth, or a signature of the body
 * made with a shared secret, as GitHub (X-Hub-Signature-256), Stripe-like services and Shopify send. The secrets are kept sealed with the trigger
 * (automation-triggers.service.ts) and opened only to check a call; every comparison takes the same time whatever matches.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AutomationHookAuthInput } from "@codechatter/contracts";

/** As kept: the secret sealed, never shown again. */
export type StoredHookAuth =
  | { kind: "none" }
  | { kind: "header"; header: string; secretSealed: string }
  | { kind: "basic"; user: string; secretSealed: string }
  | { kind: "signature"; header: string; prefix: string; secretSealed: string };

/** What the trigger's panel is shown: everything but the secret. */
export type ShownHookAuth = { kind: StoredHookAuth["kind"]; header?: string; user?: string; prefix?: string };

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Unequal lengths still take a comparison's time.
  return left.length === right.length ? timingSafeEqual(left, right) : (timingSafeEqual(left, left), false);
};

export function storedAuthOf(input: AutomationHookAuthInput, seal: (secret: string) => string): StoredHookAuth {
  if (input.kind === "header") return { kind: "header", header: input.header.toLowerCase(), secretSealed: seal(input.value) };
  if (input.kind === "basic") return { kind: "basic", user: input.user, secretSealed: seal(input.password) };
  if (input.kind === "signature") return { kind: "signature", header: input.header.toLowerCase(), prefix: input.prefix, secretSealed: seal(input.secret) };
  return { kind: "none" };
}

export function shownAuthOf(auth: StoredHookAuth | undefined): ShownHookAuth {
  if (!auth || auth.kind === "none") return { kind: "none" };
  if (auth.kind === "header") return { kind: "header", header: auth.header };
  if (auth.kind === "basic") return { kind: "basic", user: auth.user };
  return { kind: "signature", header: auth.header, prefix: auth.prefix };
}

/**
 * Why a call doesn't show what it must, or null when it does. `secret` is the opened secret (null when it can't be opened: the call is refused). `raw` is
 * the body as it came, which a signature is made from.
 */
export function hookAuthProblem(auth: StoredHookAuth | undefined, secret: string | null, call: { headers: Record<string, string>; raw: Buffer }): string | null {
  if (!auth || auth.kind === "none") return null;
  if (secret === null) return "Its secret can't be read: set it again on the trigger.";
  if (auth.kind === "header") {
    const given = call.headers[auth.header];
    if (given === undefined) return `The ${auth.header} header is missing.`;
    return sameText(given, secret) ? null : `The ${auth.header} header doesn't match.`;
  }
  if (auth.kind === "basic") {
    const given = call.headers.authorization ?? "";
    if (!/^basic /i.test(given)) return "Basic auth is missing.";
    const decoded = Buffer.from(given.slice(6).trim(), "base64").toString("utf8");
    const at = decoded.indexOf(":");
    const user = at < 0 ? decoded : decoded.slice(0, at);
    const password = at < 0 ? "" : decoded.slice(at + 1);
    // Both compared, so which was wrong takes no longer to find.
    const ok = sameText(user, auth.user) && sameText(password, secret);
    return ok ? null : "The user name or password doesn't match.";
  }
  const given = call.headers[auth.header];
  if (given === undefined) return `The ${auth.header} header is missing.`;
  const signature = auth.prefix && given.startsWith(auth.prefix) ? given.slice(auth.prefix.length) : given;
  const mac = createHmac("sha256", secret).update(call.raw);
  const digest = mac.digest();
  // In hex, as GitHub sends it, or base64, as Shopify does.
  const ok = sameText(signature.trim().toLowerCase(), digest.toString("hex")) || sameText(signature.trim(), digest.toString("base64"));
  return ok ? null : "The signature doesn't match the body.";
}
