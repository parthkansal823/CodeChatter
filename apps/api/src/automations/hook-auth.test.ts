import { createHmac } from "node:crypto";

import { AutomationHookAuthInput } from "@codechatter/contracts";
import { describe, expect, it } from "vitest";

import { hookAuthProblem, shownAuthOf, storedAuthOf } from "./hook-auth.js";

// Sealing is the token box's job; here the "sealed" secret is just marked.
const seal = (secret: string) => `sealed:${secret}`;
const stored = (input: unknown) => storedAuthOf(AutomationHookAuthInput.parse(input), seal);
const call = (headers: Record<string, string>, body = '{"ref":"main"}') => ({ headers, raw: Buffer.from(body) });

describe("what a webhook call must show", () => {
  it("asks nothing with none", () => {
    expect(hookAuthProblem(undefined, null, call({}))).toBeNull();
    expect(hookAuthProblem({ kind: "none" }, null, call({}))).toBeNull();
  });

  it("checks a header's value, its name in any case", () => {
    const auth = stored({ kind: "header", header: "X-Api-Key", value: "s3cret-key-value" });
    expect(auth).toEqual({ kind: "header", header: "x-api-key", secretSealed: "sealed:s3cret-key-value" });
    expect(hookAuthProblem(auth, "s3cret-key-value", call({ "x-api-key": "s3cret-key-value" }))).toBeNull();
    expect(hookAuthProblem(auth, "s3cret-key-value", call({ "x-api-key": "wrong" }))).toBe("The x-api-key header doesn't match.");
    expect(hookAuthProblem(auth, "s3cret-key-value", call({}))).toBe("The x-api-key header is missing.");
  });

  it("checks basic auth", () => {
    const auth = stored({ kind: "basic", user: "ci", password: "a long password" });
    const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    expect(hookAuthProblem(auth, "a long password", call({ authorization: basic("ci", "a long password") }))).toBeNull();
    expect(hookAuthProblem(auth, "a long password", call({ authorization: basic("ci", "nope") }))).toBe("The user name or password doesn't match.");
    expect(hookAuthProblem(auth, "a long password", call({ authorization: basic("someone", "a long password") }))).toBe("The user name or password doesn't match.");
    expect(hookAuthProblem(auth, "a long password", call({ authorization: "Bearer x" }))).toBe("Basic auth is missing.");
  });

  it("checks a signature of the body, as GitHub sends it, or in base64", () => {
    const auth = stored({ kind: "signature", secret: "shared webhook secret" });
    expect(auth).toEqual({ kind: "signature", header: "x-hub-signature-256", prefix: "sha256=", secretSealed: "sealed:shared webhook secret" });
    const body = '{"ref":"refs/heads/main","commits":[]}';
    const hex = createHmac("sha256", "shared webhook secret").update(body).digest("hex");
    expect(hookAuthProblem(auth, "shared webhook secret", call({ "x-hub-signature-256": `sha256=${hex}` }, body))).toBeNull();
    expect(hookAuthProblem(auth, "shared webhook secret", call({ "x-hub-signature-256": `sha256=${hex.toUpperCase()}` }, body))).toBeNull();
    // The same signature on a body that was changed on the way.
    expect(hookAuthProblem(auth, "shared webhook secret", call({ "x-hub-signature-256": `sha256=${hex}` }, `${body} `))).toBe("The signature doesn't match the body.");
    expect(hookAuthProblem(auth, "shared webhook secret", call({}, body))).toBe("The x-hub-signature-256 header is missing.");
    const shopify = stored({ kind: "signature", header: "X-Shopify-Hmac-Sha256", prefix: "", secret: "shopify secret" });
    const base64 = createHmac("sha256", "shopify secret").update(body).digest("base64");
    expect(hookAuthProblem(shopify, "shopify secret", call({ "x-shopify-hmac-sha256": base64 }, body))).toBeNull();
  });

  it("refuses when the secret can't be read", () => {
    expect(hookAuthProblem(stored({ kind: "header", header: "X-Key", value: "12345678" }), null, call({ "x-key": "12345678" }))).toContain("can't be read");
  });

  it("never shows the secret back", () => {
    expect(shownAuthOf(stored({ kind: "signature", secret: "shared webhook secret" }))).toEqual({ kind: "signature", header: "x-hub-signature-256", prefix: "sha256=" });
    expect(shownAuthOf(stored({ kind: "basic", user: "ci", password: "a long password" }))).toEqual({ kind: "basic", user: "ci" });
    expect(shownAuthOf(undefined)).toEqual({ kind: "none" });
  });

  it("refuses settings that can't work", () => {
    expect(AutomationHookAuthInput.safeParse({ kind: "header", header: "Cookie", value: "12345678" }).success).toBe(false);
    expect(AutomationHookAuthInput.safeParse({ kind: "header", header: "X-Key", value: "short" }).success).toBe(false);
    expect(AutomationHookAuthInput.safeParse({ kind: "basic", user: "a:b", password: "12345678" }).success).toBe(false);
    expect(AutomationHookAuthInput.safeParse({ kind: "signature", header: "bad header!", secret: "12345678" }).success).toBe(false);
  });
});
