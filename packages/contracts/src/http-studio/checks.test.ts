import { describe, expect, it } from "vitest";

import { describeAssertion, evaluateAssertion, evaluateExtraction, looselyEquals, parseJsonPath, readJsonPath, type Assertion, type CheckedResponse } from "./checks.js";

const body = { data: { items: [{ id: 7, name: "Ada", tags: ["x", "y"] }], total: 1, "odd key": true, "0": "zero" }, ok: true, missing: null };
const response: CheckedResponse = {
  status: 201,
  headers: [
    ["Content-Type", "application/json"],
    ["X-Request-Id", "abc"],
  ],
  body: JSON.stringify(body),
  timeMs: 120,
};
const assertion = (patch: Partial<Assertion>): Assertion => ({ id: "a", enabled: true, kind: "status", target: "", op: "equals", expected: "", ...patch });

describe("JSON paths", () => {
  it("parses dotted and bracketed forms", () => {
    expect(parseJsonPath("$.data.items[0].id")).toEqual(["data", "items", 0, "id"]);
    expect(parseJsonPath("data.items[0]['id']")).toEqual(["data", "items", 0, "id"]);
    expect(parseJsonPath("$")).toEqual([]);
    expect(parseJsonPath("")).toEqual([]);
    expect(parseJsonPath('$["odd key"]')).toEqual(["odd key"]);
    expect(parseJsonPath("a..b")).toBeNull();
    expect(parseJsonPath("a[0]b")).toBeNull();
    expect(parseJsonPath("a[x]")).toBeNull();
  });

  it("reads values, lengths and nulls", () => {
    expect(readJsonPath(body, "$.data.items[0].name")).toEqual({ found: true, value: "Ada" });
    expect(readJsonPath(body, "data.items.0.tags.length")).toEqual({ found: true, value: 2 });
    expect(readJsonPath(body, "$.data['odd key']")).toEqual({ found: true, value: true });
    expect(readJsonPath(body, "$.data.0")).toEqual({ found: true, value: "zero" });
    expect(readJsonPath(body, "$.missing")).toEqual({ found: true, value: null });
    expect(readJsonPath(body, "$.missing.deeper")).toEqual({ found: false });
    expect(readJsonPath(body, "$.data.items[3]")).toEqual({ found: false });
    expect(readJsonPath(body, "$.data.toString")).toEqual({ found: false });
  });
});

describe("assertions", () => {
  it("compares loosely, the way people type expectations", () => {
    expect(looselyEquals(200, "200")).toBe(true);
    expect(looselyEquals(true, "true")).toBe(true);
    expect(looselyEquals("Ada", "Ada")).toBe(true);
    expect(looselyEquals("Ada", '"Ada"')).toBe(true);
    expect(looselyEquals({ a: 1 }, '{"a":1}')).toBe(true);
    expect(looselyEquals(null, "null")).toBe(true);
    expect(looselyEquals(7, "8")).toBe(false);
  });

  it.each([
    [{ kind: "status", op: "equals", expected: "201" }, true],
    [{ kind: "status", op: "equals", expected: "200" }, false],
    [{ kind: "status", op: "below", expected: "300" }, true],
    [{ kind: "time", op: "below", expected: "500" }, true],
    [{ kind: "time", op: "below", expected: "100" }, false],
    [{ kind: "json", target: "$.data.items[0].id", op: "equals", expected: "7" }, true],
    [{ kind: "json", target: "$.data.items[0].tags", op: "contains", expected: "y" }, true],
    [{ kind: "json", target: "$.data.items[0].name", op: "contains", expected: "d" }, true],
    [{ kind: "json", target: "$.data", op: "contains", expected: "total" }, true],
    [{ kind: "json", target: "$.data.total", op: "exists", expected: "" }, true],
    [{ kind: "json", target: "$.data.nope", op: "notExists", expected: "" }, true],
    [{ kind: "json", target: "$.data.total", op: "above", expected: "0" }, true],
    [{ kind: "json", target: "$.data.items[0].name", op: "matches", expected: "^A" }, true],
    [{ kind: "header", target: "x-request-id", op: "exists", expected: "" }, true],
    [{ kind: "header", target: "content-type", op: "contains", expected: "json" }, true],
    [{ kind: "header", target: "etag", op: "exists", expected: "" }, false],
    [{ kind: "body", op: "contains", expected: "Ada" }, true],
  ] as const)("%o passes: %s", (patch, passes) => {
    expect(evaluateAssertion(assertion(patch), response).passed).toBe(passes);
  });

  it("explains failures", () => {
    expect(evaluateAssertion(assertion({ kind: "json", target: "$.data.items[0].id", op: "equals", expected: "8" }), response).message).toBe("It was 7.");
    expect(evaluateAssertion(assertion({ kind: "json", target: "$.x", op: "equals", expected: "1" }), { ...response, body: "<html>" }).message).toBe("The body isn't JSON.");
    expect(evaluateAssertion(assertion({ kind: "json", target: "a[", op: "exists" }), response).message).toMatch(/isn't a JSON path/);
    expect(evaluateAssertion(assertion({ kind: "body", op: "matches", expected: "(" }), response).message).toMatch(/isn't a valid regular expression/);
  });

  it("names assertions in plain words", () => {
    expect(describeAssertion({ kind: "status", target: "", op: "equals", expected: "200" })).toBe("Status equals 200");
    expect(describeAssertion({ kind: "json", target: "$.id", op: "exists", expected: "" })).toBe("JSON $.id exists");
    expect(describeAssertion({ kind: "time", target: "", op: "below", expected: "500" })).toBe("Response time is below 500 ms");
  });
});

describe("extractions", () => {
  it("copies values into variables", () => {
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "id", source: "json", path: "$.data.items[0].id" }, response)).toEqual({ variable: "id", value: "7" });
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "name", source: "json", path: "data.items[0].name" }, response)).toEqual({ variable: "name", value: "Ada" });
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "tags", source: "json", path: "$.data.items[0].tags" }, response)).toEqual({ variable: "tags", value: '["x","y"]' });
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "rid", source: "header", path: "X-REQUEST-ID" }, response)).toEqual({ variable: "rid", value: "abc" });
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "code", source: "status", path: "" }, response)).toEqual({ variable: "code", value: "201" });
  });

  it("says why nothing was set", () => {
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "", source: "status", path: "" }, response).error).toMatch(/Name the variable/);
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "x", source: "json", path: "$.nope" }, response).error).toBe("Nothing is at $.nope.");
    expect(evaluateExtraction({ id: "e", enabled: true, variable: "x", source: "header", path: "ETag" }, response).error).toBe("The response had no ETag header.");
  });
});
