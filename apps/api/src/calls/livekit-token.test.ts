import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { livekitAdminToken, livekitToken } from "./livekit-token.js";

const parts = (token: string) => {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString()),
    signed: `${header}.${payload}`,
    signature: signature!,
  };
};

describe("livekitAdminToken", () => {
  it("manages one call, for a minute", () => {
    const token = parts(livekitAdminToken({ apiKey: "key", apiSecret: "a-secret-that-is-long-enough-1234", room: "room-TEAM22", now: 1_700_000_000_000 }));
    expect(token.signature).toBe(createHmac("sha256", "a-secret-that-is-long-enough-1234").update(token.signed).digest("base64url"));
    expect(token.payload.iss).toBe("key");
    expect(token.payload.exp - token.payload.iat).toBe(60);
    expect(token.payload.video).toEqual({ room: "room-TEAM22", roomAdmin: true });
  });
});

describe("livekitToken", () => {
  const grant = { apiKey: "key", apiSecret: "a-secret-that-is-long-enough-1234", identity: "u1", name: "Ana", room: "room-TEAM22", canPublish: true, now: 1_700_000_000_000 };

  it("is an HS256 JWT signed with the API secret", () => {
    const token = parts(livekitToken(grant));
    expect(token.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(token.signature).toBe(createHmac("sha256", grant.apiSecret).update(token.signed).digest("base64url"));
    expect(token.signature).not.toBe(createHmac("sha256", "another-secret").update(token.signed).digest("base64url"));
  });

  it("names the person, the call and what they may do, for six hours", () => {
    const { payload } = parts(livekitToken({ ...grant, metadata: '{"slot":2}' }));
    expect(payload).toMatchObject({
      iss: "key",
      sub: "u1",
      name: "Ana",
      nbf: 1_700_000_000,
      exp: 1_700_000_000 + 6 * 60 * 60,
      metadata: '{"slot":2}',
      video: { room: "room-TEAM22", roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: true, canUpdateOwnMetadata: false },
    });
  });

  it("can only watch and listen when it may not publish", () => {
    const { payload } = parts(livekitToken({ ...grant, canPublish: false }));
    expect(payload.video).toMatchObject({ canPublish: false, canPublishData: false, canSubscribe: true });
  });
});
