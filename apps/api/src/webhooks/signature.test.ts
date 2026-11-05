/** Check signature compatibility, raw-byte integrity and the replay window. */
import { describe, expect, it } from "vitest";

import { sign, verify } from "./signature.js";

describe("outgoing webhook signatures", () => {
  const body = '{"event":"ping"}';
  const at = 1_700_000_000;

  it("matches a known HMAC-SHA256 vector", () => {
    expect(sign("secret", at, body)).toBe("sha256=4d39bd2442f073b6bc62e95d0297ce25475582a17389ab860abdc778fe1d9f77");
  });
  it("verifies the raw body and rejects another secret or even changed whitespace", () => {
    const signature = sign("secret", at, body);
    expect(verify("secret", String(at), Buffer.from(body), signature, 300, at)).toBe(true);
    expect(verify("wrong", at, body, signature, 300, at)).toBe(false);
    expect(verify("secret", at, `${body}\n`, signature, 300, at)).toBe(false);
  });
  it("rejects old and future timestamps outside the window", () => {
    const signature = sign("secret", at, body);
    expect(verify("secret", at, body, signature, 300, at + 301)).toBe(false);
    expect(verify("secret", at, body, signature, 300, at - 301)).toBe(false);
    expect(verify("secret", at, body, signature, 300, at + 300)).toBe(true);
    expect(verify("secret", at, body, signature, 10, at + 11)).toBe(false);
  });
  it("rejects malformed signatures, timestamps and tolerances", () => {
    const signature = sign("secret", at, body);
    for (const value of ["", "sha256=x", signature.slice(0, -1), `${signature}00`]) {
      expect(verify("secret", at, body, value, 300, at)).toBe(false);
    }
    for (const value of ["1e3", "1700000000.0", "-1", "01700000000", "NaN"]) {
      expect(verify("secret", value, body, signature, 300, at)).toBe(false);
    }
    expect(verify("secret", at, body, signature, -1, at)).toBe(false);
  });
});
