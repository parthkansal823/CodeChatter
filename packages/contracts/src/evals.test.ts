import { describe, expect, it } from "vitest";

import { EvalInput, promptfooConfig } from "./evals.js";

const column = { id: "c1", model: "gemma4:e4b", temperature: null, maxTokens: null, json: false };
const test = { id: "t1", name: "France", values: { place: "France" }, checks: [{ type: "contains", value: "Paris" }] };
const good = { system: "Be brief.", messages: [{ role: "user", content: "Capital of {{place}}?" }], columns: [column], cases: [test] };
const parse = (over: object = {}) => EvalInput.parse({ ...good, ...over });

describe("what may be sent", () => {
  it("takes a prompt, columns and cases", () => {
    expect(parse().oneAtATime).toBe(false);
    expect(parse().grader).toBeNull();
  });

  it("needs a case and a column, and something from the user last", () => {
    expect(EvalInput.safeParse({ ...good, cases: [] }).success).toBe(false);
    expect(EvalInput.safeParse({ ...good, columns: [] }).success).toBe(false);
    expect(EvalInput.safeParse({ ...good, messages: [{ role: "assistant", content: "Hi" }] }).success).toBe(false);
  });

  it("stops at the limits", () => {
    expect(EvalInput.safeParse({ ...good, cases: Array(31).fill(test) }).success).toBe(false);
    expect(EvalInput.safeParse({ ...good, columns: Array(5).fill(column) }).success).toBe(false);
    expect(EvalInput.safeParse({ ...good, cases: [{ ...test, checks: Array(11).fill(test.checks[0]) }] }).success).toBe(false);
  });

  it("wants a check to say what it looks for, unless it doesn't need to", () => {
    const withCheck = (check: object) => EvalInput.safeParse({ ...good, cases: [{ ...test, checks: [check] }] }).success;
    expect(withCheck({ type: "contains", value: "  " })).toBe(false);
    expect(withCheck({ type: "is-json" })).toBe(true);
    expect(withCheck({ type: "contains-json", value: "" })).toBe(true);
    expect(withCheck({ type: "latency", value: "soon" })).toBe(false);
    expect(withCheck({ type: "latency", value: "5000" })).toBe(true);
    expect(withCheck({ type: "webhook", value: "http://example.com" })).toBe(false);
  });

  it("refuses a column id or variable that isn't a plain name", () => {
    expect(EvalInput.safeParse({ ...good, columns: [{ ...column, id: "../x" }] }).success).toBe(false);
    expect(EvalInput.safeParse({ ...good, cases: [{ ...test, values: { "bad name": "x" } }] }).success).toBe(false);
  });
});

describe("the config promptfoo gets", () => {
  it("has the conversation as one prompt, the system's first", () => {
    const [prompt] = promptfooConfig(parse()).prompts;
    expect(JSON.parse(prompt!.raw)).toEqual([{ role: "system", content: "Be brief." }, { role: "user", content: "Capital of {{place}}?" }]);
    expect(JSON.parse(promptfooConfig(parse({ system: "" })).prompts[0]!.raw)).toEqual([{ role: "user", content: "Capital of {{place}}?" }]);
  });

  it("has a provider for each column, with only the settings it chose", () => {
    const { providers } = promptfooConfig(parse({ columns: [column, { ...column, id: "c2", model: "other", temperature: 0, maxTokens: 50, json: true }] }));
    expect(providers[0]).toEqual({ id: "openai:chat:gemma4:e4b", label: "c1", config: {} });
    expect(providers[1]).toEqual({ id: "openai:chat:other", label: "c2", config: { temperature: 0, max_tokens: 50, response_format: { type: "json_object" } } });
  });

  it("turns checks into assertions", () => {
    const checks = [{ type: "contains", value: "a" }, { type: "is-json" }, { type: "latency", value: "5000" }, { type: "javascript", value: "output.length < 5" }];
    expect(promptfooConfig(parse({ cases: [{ ...test, checks }] })).tests[0]!.assert).toEqual([{ type: "contains", value: "a" }, { type: "is-json" }, { type: "latency", threshold: 5000 }, { type: "javascript", value: "output.length < 5" }]);
  });

  it("names who judges only when there's someone to", () => {
    expect(promptfooConfig(parse())).not.toHaveProperty("defaultTest");
    expect(promptfooConfig(parse({ grader: "gemma4:e4b" })).defaultTest).toEqual({ options: { provider: "openai:chat:gemma4:e4b" } });
  });

  it("runs one at a time when the models share a machine", () => {
    expect(promptfooConfig(parse({ oneAtATime: true })).evaluateOptions.maxConcurrency).toBe(1);
    expect(promptfooConfig(parse()).evaluateOptions.maxConcurrency).toBe(4);
  });
});
