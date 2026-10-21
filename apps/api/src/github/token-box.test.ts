import { describe, expect, it } from "vitest";

import { openToken, sealToken } from "./token-box.js";

const secret = "a".repeat(40);
const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

describe("token box", () => {
  it("opens what it sealed, and seals the same token differently each time", () => {
    const sealed = sealToken(secret, token);
    expect(sealed).not.toContain(token);
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(openToken(secret, sealed)).toBe(token);
    expect(sealToken(secret, token)).not.toBe(sealed);
  });

  it("returns null under another secret, or when tampered with", () => {
    const sealed = sealToken(secret, token);
    expect(openToken("b".repeat(40), sealed)).toBeNull();
    const [v, iv, tag, body] = sealed.split(".") as [string, string, string, string];
    const flipped = Buffer.from(body, "base64url");
    flipped[0]! ^= 1;
    expect(openToken(secret, [v, iv, tag, flipped.toString("base64url")].join("."))).toBeNull();
    expect(openToken(secret, "v2.x.y.z")).toBeNull();
    expect(openToken(secret, "garbage")).toBeNull();
  });
});
