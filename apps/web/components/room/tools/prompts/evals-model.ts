/**
 * A prompt's test cases and the runs of them, in the `prompts` document beside the prompt they test. A case's values and checks are
 * Y.Text, so two people can type in them at once; a run is plain data, as what was tested doesn't change.
 */
import { checkNeedsValue, EVAL_LIMITS, promptVariables, type EvalCell, type EvalCheckType, type EvalInput, type EvalReport } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { readColumns, readPromptText, samePrompt, type PromptColumn, type PromptText } from "./model";

export const MOST_EVAL_RUNS = 6;

/** What each kind of check is called, in plain words, and what goes in it. */
export const CHECKS: Record<EvalCheckType, { label: string; placeholder: string }> = {
  contains: { label: "Contains", placeholder: "Paris" },
  icontains: { label: "Contains, in any case", placeholder: "paris" },
  "not-contains": { label: "Doesn't contain", placeholder: "I'm sorry" },
  equals: { label: "Is exactly", placeholder: "Paris" },
  regex: { label: "Matches the pattern", placeholder: "^[A-Z]" },
  "is-json": { label: "Is JSON", placeholder: "" },
  "contains-json": { label: "Contains JSON", placeholder: "" },
  javascript: { label: "JavaScript says yes", placeholder: "output.length < 200" },
  "llm-rubric": { label: "The AI agrees that", placeholder: "The answer is polite and correct" },
  latency: { label: "Answers within (ms)", placeholder: "5000" },
};

type Node = Y.Map<unknown>;
export type EvalCheckItem = { id: string; type: EvalCheckType; value: Y.Text };
export type EvalCaseItem = { id: string; name: string; node: Node; checks: EvalCheckItem[] };
export type EvalRun = { id: string; at: number; by: string; prompt: PromptText; columns: PromptColumn[]; cases: Array<{ id: string; name: string }>; report: EvalReport };

/** Prompts made before Evals existed don't have these lists yet. */
function list<T>(node: Node, key: string): Y.Array<T> {
  const existing = node.get(key) as Y.Array<T> | undefined;
  if (existing) return existing;
  const made = new Y.Array<T>();
  node.set(key, made);
  return made;
}

const checksOf = (test: Node) => test.get("checks") as Y.Array<Node>;
const valuesOf = (test: Node) => test.get("values") as Y.Map<Y.Text>;

function checkNode(type: EvalCheckType): Node {
  const check = new Y.Map<unknown>();
  check.set("id", randomId());
  check.set("type", type);
  check.set("value", new Y.Text());
  return check;
}

export function addCase(node: Node, name: string): void {
  const cases = list<Node>(node, "cases");
  if (cases.length >= EVAL_LIMITS.cases) return;
  const test = new Y.Map<unknown>();
  test.set("id", randomId());
  test.set("name", name);
  test.set("values", new Y.Map<Y.Text>());
  const checks = new Y.Array<Node>();
  checks.push([checkNode("contains")]);
  test.set("checks", checks);
  cases.push([test]);
}

export function readCases(node: Node): EvalCaseItem[] {
  const cases = node.get("cases") as Y.Array<Node> | undefined;
  return (cases?.toArray() ?? []).map((test) => ({
    id: String(test.get("id")),
    name: String(test.get("name") ?? ""),
    node: test,
    checks: checksOf(test)
      .toArray()
      .map((check) => ({ id: String(check.get("id")), type: check.get("type") as EvalCheckType, value: check.get("value") as Y.Text })),
  }));
}

export function removeCase(node: Node, id: string): void {
  const index = readCases(node).findIndex((test) => test.id === id);
  if (index !== -1) list<Node>(node, "cases").delete(index);
}

export const renameCase = (test: Node, name: string) => test.set("name", name.slice(0, EVAL_LIMITS.nameChars));
export const caseValue = (test: Node, name: string) => valuesOf(test).get(name);

/** The Y.Text for a case's value, made when someone first goes to type in it. */
export function ensureCaseValue(test: Node, name: string): Y.Text {
  const values = valuesOf(test);
  const existing = values.get(name);
  if (existing) return existing;
  const text = new Y.Text();
  values.set(name, text);
  return text;
}

export function addCheck(test: Node, type: EvalCheckType = "contains"): void {
  if (checksOf(test).length < EVAL_LIMITS.checks) checksOf(test).push([checkNode(type)]);
}

export function removeCheck(test: Node, id: string): void {
  const index = checksOf(test).toArray().findIndex((check) => check.get("id") === id);
  if (index !== -1) checksOf(test).delete(index);
}

export function setCheckType(test: Node, id: string, type: EvalCheckType): void {
  checksOf(test)
    .toArray()
    .find((check) => check.get("id") === id)
    ?.set("type", type);
}

/** Newest first. */
export const readEvalRuns = (node: Node): EvalRun[] => ((node.get("evals") as Y.Array<EvalRun> | undefined)?.toArray() ?? []).reverse();

export function addEvalRun(node: Node, run: EvalRun): void {
  const runs = list<EvalRun>(node, "evals");
  const write = () => {
    runs.push([run]);
    if (runs.length > MOST_EVAL_RUNS) runs.delete(0, runs.length - MOST_EVAL_RUNS);
  };
  if (node.doc) node.doc.transact(write);
  else write();
}

/** Why these can't run yet. */
export function whyNoEvals(cases: readonly EvalCaseItem[], columns: readonly PromptColumn[]): string | null {
  if (cases.length === 0) return "Add a test case first.";
  if (columns.length === 0) return "Add a column to try it on.";
  for (const test of cases) {
    const empty = test.checks.find((check) => checkNeedsValue(check.type) && !check.value.toString().trim());
    if (empty) return `In "${test.name || "a case"}", a check is missing what to look for.`;
    const late = test.checks.find((check) => check.type === "latency" && !/^\d+$/.test(check.value.toString().trim()));
    if (late) return `In "${test.name || "a case"}", a time limit has to be a whole number of milliseconds.`;
  }
  return null;
}

/** What's sent: a case's own value for a variable, or the prompt's when it hasn't one. */
export function evalInput(node: Node, options: { oneAtATime: boolean; grader: string | null }): EvalInput {
  const prompt = readPromptText(node);
  const variables = promptVariables([prompt.system, ...prompt.messages.map((message) => message.content)]);
  return {
    system: prompt.system,
    messages: prompt.messages,
    columns: readColumns(node),
    oneAtATime: options.oneAtATime,
    grader: options.grader,
    cases: readCases(node).map((test) => ({
      id: test.id,
      name: test.name,
      values: Object.fromEntries(
        variables.flatMap((name) => {
          const own = caseValue(test.node, name)?.toString();
          const value = own || prompt.values[name];
          return value === undefined ? [] : [[name, value]];
        }),
      ),
      checks: test.checks.map((check) => ({ type: check.type, value: check.value.toString().trim() })),
    })),
  };
}

/** How many calls a run makes: an answer per case and column, and one more for each check the AI judges. */
export function evalCalls(input: Pick<EvalInput, "cases" | "columns">): number {
  const judged = input.cases.reduce((sum, test) => sum + test.checks.filter((check) => check.type === "llm-rubric").length, 0);
  return (input.cases.length + judged) * input.columns.length;
}

export type ColumnScore = { passed: number; total: number; averageMs: number | null; inputTokens: number; outputTokens: number };

export function columnScore(report: EvalReport, columnId: string): ColumnScore {
  const cells = report.cells.filter((cell) => cell.columnId === columnId);
  const timed = cells.filter((cell): cell is EvalCell & { latencyMs: number } => cell.latencyMs !== null && !cell.error);
  return {
    passed: cells.filter((cell) => cell.pass).length,
    total: cells.length,
    averageMs: timed.length ? timed.reduce((sum, cell) => sum + cell.latencyMs, 0) / timed.length : null,
    inputTokens: cells.reduce((sum, cell) => sum + cell.inputTokens, 0),
    outputTokens: cells.reduce((sum, cell) => sum + cell.outputTokens, 0),
  };
}

export const cellKey = (cell: Pick<EvalCell, "caseId" | "columnId">) => `${cell.caseId}:${cell.columnId}`;

export type EvalChanges = { newlyFailing: Set<string>; fixed: Set<string>; promptChanged: boolean; at: number };

/** What changed from an earlier run, for the cases and columns that are in both. */
export function compareEvals(now: EvalRun, before: EvalRun | null | undefined): EvalChanges | null {
  if (!before) return null;
  const earlier = new Map(before.report.cells.map((cell) => [cellKey(cell), cell.pass]));
  const newlyFailing = new Set<string>();
  const fixed = new Set<string>();
  for (const cell of now.report.cells) {
    const was = earlier.get(cellKey(cell));
    if (was === true && !cell.pass) newlyFailing.add(cellKey(cell));
    if (was === false && cell.pass) fixed.add(cellKey(cell));
  }
  return { newlyFailing, fixed, promptChanged: !samePrompt(now.prompt, before.prompt), at: before.at };
}
