import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvalCell, EvalReport } from "@codechatter/contracts";
import * as Y from "yjs";

import {
  addCase,
  addCheck,
  addEvalRun,
  cellKey,
  columnScore,
  compareEvals,
  ensureCaseValue,
  evalCalls,
  evalInput,
  MOST_EVAL_RUNS,
  readCases,
  readEvalRuns,
  removeCase,
  removeCheck,
  renameCase,
  setCheckType,
  whyNoEvals,
  type EvalRun,
} from "./evals-model";
import { createPrompt, promptsOf, systemOf } from "./model";

const column = { id: "c1", model: "a", temperature: null, maxTokens: null, json: false };
const setup = () => {
  const doc = new Y.Doc();
  const id = createPrompt(doc, { name: "One", system: "Be brief.", messages: [{ role: "user", content: "Capital of {{place}}, for {{who}}?" }], values: { who: "a child" }, columns: [column] });
  return { doc, node: promptsOf(doc).get(id)! };
};
const cell = (over: Partial<EvalCell> = {}): EvalCell => ({ caseId: "t1", columnId: "c1", pass: true, error: null, output: "x", failed: [], latencyMs: 100, inputTokens: 5, outputTokens: 2, ...over });
const report = (cells: EvalCell[]): EvalReport => ({ cells, passed: 0, failed: 0, errors: 0, inputTokens: 0, outputTokens: 0, ms: 1 });
const run = (at: number, cells: EvalCell[] = [cell()], system = "Be brief."): EvalRun => ({ id: `r${at}`, at, by: "A", prompt: { system, messages: [{ role: "user", content: "Hi" }], values: {} }, columns: [column], cases: [{ id: "t1", name: "One" }], report: report(cells) });

describe("cases", () => {
  it("start with one check to fill in, and can be changed and removed", () => {
    const { node } = setup();
    addCase(node, "France");
    addCase(node, "Spain");
    const [france, spain] = readCases(node);
    assert.equal(france!.checks[0]!.type, "contains");
    renameCase(france!.node, "La France");
    assert.equal(readCases(node)[0]!.name, "La France");
    removeCase(node, spain!.id);
    assert.deepEqual(readCases(node).map((test) => test.name), ["La France"]);
  });

  it("work on a prompt made before they existed", () => {
    const { node } = setup();
    node.delete("cases");
    node.delete("evals");
    assert.deepEqual(readCases(node), []);
    assert.deepEqual(readEvalRuns(node), []);
    addCase(node, "France");
    addEvalRun(node, run(1));
    assert.equal(readCases(node).length, 1);
    assert.equal(readEvalRuns(node).length, 1);
  });

  it("have checks that can change kind, and go", () => {
    const { node } = setup();
    addCase(node, "France");
    const test = readCases(node)[0]!;
    addCheck(test.node, "is-json");
    const [first, second] = readCases(node)[0]!.checks;
    assert.equal(second!.type, "is-json");
    setCheckType(test.node, first!.id, "regex");
    assert.equal(readCases(node)[0]!.checks[0]!.type, "regex");
    removeCheck(test.node, second!.id);
    assert.equal(readCases(node)[0]!.checks.length, 1);
  });
});

describe("what's sent", () => {
  it("uses a case's value, or the prompt's when it hasn't one", () => {
    const { node } = setup();
    addCase(node, "France");
    const test = readCases(node)[0]!;
    ensureCaseValue(test.node, "place").insert(0, "France");
    test.checks[0]!.value.insert(0, " Paris ");
    const input = evalInput(node, { oneAtATime: true, grader: "a" });
    assert.deepEqual(input.cases[0]!.values, { place: "France", who: "a child" });
    assert.deepEqual(input.cases[0]!.checks, [{ type: "contains", value: "Paris" }]);
    assert.equal(input.system, "Be brief.");
    assert.deepEqual([input.oneAtATime, input.grader], [true, "a"]);
  });

  it("treats a value emptied again as no value of its own", () => {
    const { node } = setup();
    addCase(node, "France");
    ensureCaseValue(readCases(node)[0]!.node, "who");
    assert.equal(evalInput(node, { oneAtATime: false, grader: null }).cases[0]!.values.who, "a child");
  });

  it("leaves out values for variables the prompt no longer has", () => {
    const { node } = setup();
    addCase(node, "France");
    ensureCaseValue(readCases(node)[0]!.node, "gone").insert(0, "x");
    assert.ok(!("gone" in evalInput(node, { oneAtATime: false, grader: null }).cases[0]!.values));
  });

  it("counts its calls, with one more for what the AI judges", () => {
    const check = (type: string) => ({ type, value: "x" }) as never;
    assert.equal(evalCalls({ cases: [{ id: "a", name: "", values: {}, checks: [check("contains")] }, { id: "b", name: "", values: {}, checks: [check("llm-rubric")] }], columns: [column, { ...column, id: "c2" }] }), 6);
  });

  it("says why it can't go yet", () => {
    const { node } = setup();
    assert.match(whyNoEvals(readCases(node), [column])!, /test case/);
    addCase(node, "France");
    assert.match(whyNoEvals(readCases(node), [column])!, /"France".*missing/);
    const test = readCases(node)[0]!;
    test.checks[0]!.value.insert(0, "Paris");
    assert.equal(whyNoEvals(readCases(node), [column]), null);
    assert.match(whyNoEvals(readCases(node), [])!, /column/);
    setCheckType(test.node, test.checks[0]!.id, "latency");
    assert.match(whyNoEvals(readCases(node), [column])!, /milliseconds/);
    setCheckType(test.node, test.checks[0]!.id, "is-json");
    assert.equal(whyNoEvals(readCases(node), [column]), null);
  });

  it("merges two people typing in the same check", () => {
    const { doc, node } = setup();
    addCase(node, "France");
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    readCases(node)[0]!.checks[0]!.value.insert(0, "Par");
    readCases(promptsOf(other).get([...promptsOf(other).keys()][0]!)!)[0]!.checks[0]!.value.insert(0, "is");
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    assert.equal(readCases(node)[0]!.checks[0]!.value.toString().length, 5);
    assert.ok(systemOf(node));
  });
});

describe("runs", () => {
  it("come back newest first, keeping only the last few", () => {
    const { node } = setup();
    for (let at = 1; at <= MOST_EVAL_RUNS + 2; at += 1) addEvalRun(node, run(at));
    const runs = readEvalRuns(node);
    assert.equal(runs.length, MOST_EVAL_RUNS);
    assert.equal(runs[0]!.at, MOST_EVAL_RUNS + 2);
  });

  it("add up per column", () => {
    const score = columnScore(report([cell(), cell({ caseId: "t2", pass: false, latencyMs: 300 }), cell({ caseId: "t3", pass: false, error: "No answer", latencyMs: 0 }), cell({ columnId: "c2" })]), "c1");
    assert.deepEqual(score, { passed: 1, total: 3, averageMs: 200, inputTokens: 15, outputTokens: 6 });
    assert.equal(columnScore(report([]), "c1").averageMs, null);
  });
});

describe("what changed", () => {
  it("is nothing to say for a first run", () => {
    assert.equal(compareEvals(run(2), null), null);
  });

  it("finds what's newly failing and what's fixed", () => {
    const before = run(1, [cell({ caseId: "a" }), cell({ caseId: "b", pass: false }), cell({ caseId: "same" })]);
    const now = run(2, [cell({ caseId: "a", pass: false }), cell({ caseId: "b" }), cell({ caseId: "same" }), cell({ caseId: "new", pass: false })]);
    const changes = compareEvals(now, before)!;
    assert.deepEqual([...changes.newlyFailing], [cellKey({ caseId: "a", columnId: "c1" })]);
    assert.deepEqual([...changes.fixed], [cellKey({ caseId: "b", columnId: "c1" })]);
    assert.equal(changes.at, 1);
  });

  it("says whether the prompt was different", () => {
    assert.equal(compareEvals(run(2), run(1))!.promptChanged, false);
    assert.equal(compareEvals(run(2, [cell()], "Be long."), run(1))!.promptChanged, true);
  });
});
