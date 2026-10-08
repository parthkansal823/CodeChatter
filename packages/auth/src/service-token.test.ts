import { afterEach, describe, expect, it, vi } from "vitest";

import { signServiceToken, verifyServiceToken } from "./service-token.js";

const SECRET = "test-secret-that-is-long-enough-for-hmac";

describe("service tokens", () => {
  afterEach(() => vi.useRealTimers());

  it("round-trips the claims for the intended audience", () => {
    const token = signServiceToken(SECRET, { aud: "runner", sub: "TEAM22", uid: "u1", name: "Parth" });
    expect(verifyServiceToken(SECRET, token, "runner")).toMatchObject({ aud: "runner", sub: "TEAM22", uid: "u1", name: "Parth" });
  });

  it("rejects another audience, a wrong secret, and tampering", () => {
    const token = signServiceToken(SECRET, { aud: "collab", sub: "room:TEAM22:files" });
    expect(verifyServiceToken(SECRET, token, "runner")).toBeNull();
    expect(verifyServiceToken("another-secret-of-similar-length-000000", token, "collab")).toBeNull();
    const [prefix, body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ aud: "collab", sub: "room:OTHER1:files", exp: 9e9 })).toString("base64url");
    expect(verifyServiceToken(SECRET, `${prefix}.${forged}.${sig}`, "collab")).toBeNull();
    expect(verifyServiceToken(SECRET, `${prefix}.${body}.${sig}x`, "collab")).toBeNull();
  });

  it("expires", () => {
    vi.useFakeTimers();
    const token = signServiceToken(SECRET, { aud: "runner", sub: "TEAM22" }, 60);
    vi.advanceTimersByTime(61_000);
    expect(verifyServiceToken(SECRET, token, "runner")).toBeNull();
  });

  it("ignores anything that isn't a service token", () => {
    for (const value of [undefined, null, 42, "", "session", "svc.", "svc.onlybody"]) {
      expect(verifyServiceToken(SECRET, value, "runner")).toBeNull();
    }
  });
});
