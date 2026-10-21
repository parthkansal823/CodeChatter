import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** The key: BETTER_AUTH_SECRET through HKDF, so it's never the secret itself and only ever used for this. */
const keyFrom = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "codechatter", "github-token v1", 32));

/** Seal a token with AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>", base64url. */
export function sealToken(secret: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
}

/** Open a sealed token; null when it was sealed under another secret or tampered with. */
export function openToken(secret: string, sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
