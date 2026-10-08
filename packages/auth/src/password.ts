import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

const pbkdf2Async = promisify(pbkdf2);

// OWASP 2025 argon2id baseline: 19 MiB, 2 iterations, 1 lane.
// `algorithm: 2` is Algorithm.Argon2id; the package exports it as an ambient
// const enum, which isolatedModules cannot inline.
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * v1 stored PBKDF2-HMAC-SHA256 (150k iterations, 16-byte salt) as separate
 * hex fields. tools/migrate-v1 packs them as
 * `pbkdf2_sha256$<iterations>$<salt hex>$<hash hex>` so they can be verified
 * once and then upgraded to argon2id on the user's next sign-in.
 */
export const LEGACY_PREFIX = "pbkdf2_sha256$";

export function isLegacyHash(stored: string): boolean {
  return stored.startsWith(LEGACY_PREFIX);
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS);
}

async function verifyLegacy(stored: string, password: string): Promise<boolean> {
  const [, iterations, saltHex, hashHex] = stored.split("$");
  if (!iterations || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await pbkdf2Async(password, Buffer.from(saltHex, "hex"), Number(iterations), expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (isLegacyHash(hash)) return verifyLegacy(hash, password);
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** For tests and the v1 migration: produce a v1-style legacy hash. */
export async function legacyHashForTests(password: string, iterations = 150_000): Promise<string> {
  const salt = randomBytes(16);
  const derived = await pbkdf2Async(password, salt, iterations, 32, "sha256");
  return `${LEGACY_PREFIX}${iterations}$${salt.toString("hex")}$${derived.toString("hex")}`;
}
