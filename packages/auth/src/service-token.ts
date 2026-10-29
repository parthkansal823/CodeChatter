import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived tokens between our own services: the API calling the runner,
 * and the runner opening a room document on the collab server.
 *
 *   svc.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>
 *
 * Deliberately not a JWT library: one algorithm, no header to negotiate, and
 * every token names its audience and the one thing it is for (`sub`), so a
 * token minted for room A can't open room B or be replayed at another service.
 * Import from "@codechatter/auth/service-token" (no Better Auth, no database).
 */
export type ServiceAudience = "runner" | "collab" | "preview";

export interface ServiceClaims {
  aud: ServiceAudience;
  /** What the token grants access to: a room id (runner) or a document name (collab). */
  sub: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
  /** The person the call is made for, when there is one. */
  uid?: string;
  name?: string;
  /** Runner: the sandbox image the room's owner picked ("default" is the server's). */
  img?: "base" | "full" | "default";
}

const PREFIX = "svc.";

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function isServiceToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith(PREFIX);
}

export function signServiceToken(secret: string, claims: Omit<ServiceClaims, "exp">, ttlSeconds = 60): string {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  return `${PREFIX}${body}.${mac(secret, body)}`;
}

/** The claims, or null if the token is malformed, forged, expired, or for another audience. */
export function verifyServiceToken(secret: string, token: unknown, audience: ServiceAudience): ServiceClaims | null {
  if (!isServiceToken(token)) return null;
  const [body, signature] = token.slice(PREFIX.length).split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(mac(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as ServiceClaims;
    if (claims.aud !== audience || typeof claims.sub !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}
