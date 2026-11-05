import { describe, expect, it } from "vitest";

import { EMPTY_SHA256, encodeKey, objectStoreFromEnv, sha256Hex, signRequest } from "./s3.js";

// AWS's published Signature V4 examples for S3 ("Examples: Signature Calculations").
const EXAMPLE = {
  region: "us-east-1",
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  now: new Date("2013-05-24T00:00:00Z"),
};

describe("signRequest", () => {
  it("matches AWS's GET Object example", () => {
    const headers = signRequest({
      ...EXAMPLE,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { Range: "bytes=0-9" },
      payloadHash: EMPTY_SHA256,
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(headers["x-amz-date"]).toBe("20130524T000000Z");
  });

  it("matches AWS's PUT Object example", () => {
    const body = "Welcome to Amazon S3.";
    const headers = signRequest({
      ...EXAMPLE,
      method: "PUT",
      url: new URL(`https://examplebucket.s3.amazonaws.com/${encodeKey("test$file.text")}`),
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: sha256Hex(body),
    });
    expect(headers.authorization).toContain("SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
    expect(headers.authorization).toContain("Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("signs the query string sorted and encoded", () => {
    const a = signRequest({ ...EXAMPLE, method: "GET", url: new URL("https://h.example/b?prefix=a%20b&list-type=2"), payloadHash: EMPTY_SHA256 });
    const b = signRequest({ ...EXAMPLE, method: "GET", url: new URL("https://h.example/b?list-type=2&prefix=a%20b"), payloadHash: EMPTY_SHA256 });
    expect(a.authorization).toBe(b.authorization);
  });
});

describe("encodeKey", () => {
  it("encodes each segment and keeps the slashes", () => {
    expect(encodeKey("rooms/AB12CD/a b+c(1).png")).toBe("rooms/AB12CD/a%20b%2Bc%281%29.png");
  });
});

describe("objectStoreFromEnv", () => {
  it("is off unless the endpoint, bucket and keys are all set", () => {
    expect(objectStoreFromEnv({ S3_ENDPOINT: "http://localhost:8333", S3_BUCKET: "b", S3_ACCESS_KEY: "k" })).toBeNull();
    expect(objectStoreFromEnv({ S3_ENDPOINT: "http://localhost:8333", S3_BUCKET: "b", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s" })?.bucket).toBe("b");
  });
});
