import { describe, expect, it } from "vitest";

import { parsePromptfoo } from "./evals.js";

const input = {
  cases: [
    { id: "t1", name: "France", values: {}, checks: [] },
    { id: "t2", name: "Spain", values: {}, checks: [] },
  ],
  columns: [
    { id: "c1", model: "a", temperature: null, maxTokens: null, json: false },
    { id: "c2", model: "b", temperature: null, maxTokens: null, json: false },
  ],
};
const usage = { prompt: 7, completion: 5, cached: 0, total: 12, numRequests: 1 };
// Shaped from promptfoo 0.125.1's real output.
const passed = { success: true, score: 1, latencyMs: 23, testIdx: 0, provider: { id: "openai:chat:a", label: "c1" }, response: { output: "Paris is the capital." }, tokenUsage: usage, prompt: { raw: "the whole prompt" }, gradingResult: { pass: true, componentResults: [{ pass: true, score: 1, reason: "Assertion passed", assertion: { type: "contains", value: "Paris" } }] } };
const failed = { success: false, score: 0, error: 'Expected output to contain "madrid"', latencyMs: 51, testIdx: 1, provider: { id: "openai:chat:a", label: "c1" }, response: { output: "I do not know." }, tokenUsage: usage, gradingResult: { pass: false, componentResults: [{ pass: false, score: 0, reason: 'Expected output to contain "madrid"', assertion: { type: "icontains", value: "madrid" } }] } };
const broke = { success: false, score: 0, error: "API error: 429 This room's code has used its requests", latencyMs: 0, testIdx: 1, provider: { id: "openai:chat:b", label: "c2" }, response: { error: "API error" }, tokenUsage: {} };
const report = (results: unknown[], ms = 100) => parsePromptfoo(JSON.stringify({ evalId: "x", results: { version: 3, results } }), input, ms);

describe("promptfoo's report", () => {
  it("tells passes, failed checks and failed calls apart", () => {
    const out = report([passed, failed, broke]);
    expect(out).toMatchObject({ passed: 1, failed: 1, errors: 1, inputTokens: 14, outputTokens: 10, ms: 100 });
    expect(out.cells[0]).toEqual({ caseId: "t1", columnId: "c1", pass: true, error: null, output: "Paris is the capital.", failed: [], latencyMs: 23, inputTokens: 7, outputTokens: 5 });
  });

  it("says which check failed, and why, with the answer that failed it", () => {
    const cell = report([failed]).cells[0]!;
    expect(cell.pass).toBe(false);
    expect(cell.error).toBeNull();
    expect(cell.output).toBe("I do not know.");
    expect(cell.failed).toEqual([{ type: "icontains", value: "madrid", reason: 'Expected output to contain "madrid"' }]);
  });

  it("keeps a time limit's number", () => {
    const late = { ...failed, gradingResult: { componentResults: [{ pass: false, reason: "Took too long", assertion: { type: "latency", threshold: 50 } }] } };
    expect(report([late]).cells[0]!.failed[0]!.value).toBe("50");
  });

  it("says why a call failed", () => {
    const cell = report([broke]).cells[0]!;
    expect(cell.error).toContain("429");
    expect(cell.output).toBe("");
  });

  it("keeps only what's named, cut short", () => {
    const long = { ...passed, response: { output: "x".repeat(5000) } };
    const cell = report([long]).cells[0]!;
    expect(cell.output.length).toBeLessThanOrEqual(801);
    expect(JSON.stringify(report([passed]))).not.toContain("the whole prompt");
  });

  it("writes out an answer that isn't text", () => {
    expect(report([{ ...passed, response: { output: { answer: 1 } } }]).cells[0]!.output).toBe('{"answer":1}');
  });

  it("leaves out what it can't place, and doesn't count missing tokens", () => {
    const out = report([{ ...passed, testIdx: 9 }, { ...passed, provider: { label: "nobody" } }, { ...passed, tokenUsage: undefined }]);
    expect(out.cells).toHaveLength(1);
    expect(out.inputTokens).toBe(0);
  });

  it("refuses something that isn't a report", () => {
    expect(() => parsePromptfoo("{}", input, 1)).toThrow(/wasn't what was expected/);
    expect(() => parsePromptfoo("not json", input, 1)).toThrow();
  });
});
