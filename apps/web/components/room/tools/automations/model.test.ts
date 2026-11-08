import assert from "node:assert/strict";
import { test } from "node:test";

import type { AutomationStepResult, PieceInfo } from "@codechatter/contracts";

import { addStep, allSteps, chartOfFlow, expressionsFor, findStep, kindOf, newCodeStep, newLoopStep, newPieceStep, newRouterStep, newStepName, newTrigger, parseFlow, removeStep, resultsOf, statusOfResult, updateStep, type Flow, type FlowStep } from "./model";

const code = (name: string, next: FlowStep | null = null): FlowStep => ({ ...newCodeStep(name), nextAction: next });
const trigger = (next: FlowStep | null): FlowStep => ({ name: "trigger", type: "PIECE_TRIGGER", displayName: "When called", settings: { pieceName: "@activepieces/piece-webhook", triggerName: "catch_webhook" }, nextAction: next });
const flowOf = (next: FlowStep | null): Flow => ({ displayName: "Test", schemaVersion: "27", trigger: trigger(next) });
const ran = (status: string, output?: unknown): AutomationStepResult => ({ type: "CODE", status, output });
const PIECE: PieceInfo = {
  label: "GitHub",
  description: "",
  version: "1.0.0",
  categories: [],
  auth: null,
  actions: { create_issue: { label: "Create issue", description: "", needsAuth: true, fields: { title: { type: "SHORT_TEXT", label: "Title", description: "", required: true }, state: { type: "SHORT_TEXT", label: "State", description: "", required: false, default: "open" } } } },
  triggers: { new_issue: { label: "New issue", description: "", needsAuth: true, fields: { labels: { type: "SHORT_TEXT", label: "Labels", description: "", required: false, default: "bug" } } } },
};

test("a flow is read, or says what's wrong", () => {
  assert.ok("flow" in parseFlow(JSON.stringify(flowOf(null))));
  assert.match(("error" in parseFlow("not json") && parseFlow("not json")) ? (parseFlow("not json") as { error: string }).error : "", /isn't valid JSON/);
  assert.match((parseFlow("{}") as { error: string }).error, /no trigger/);
  assert.match((parseFlow("null") as { error: string }).error, /no trigger/);
  assert.match((parseFlow('{"trigger":"x"}') as { error: string }).error, /no trigger/);
  const defaults = parseFlow(JSON.stringify({ trigger: trigger(null) }));
  assert.ok("flow" in defaults && defaults.flow.displayName === "Automation" && defaults.flow.schemaVersion === "27");
});

test("a flow keeps its id and anything else it has through an edit", () => {
  const read = parseFlow(JSON.stringify({ ...flowOf(code("first")), id: "flow_1", notes: [{ text: "keep me" }] }));
  assert.ok("flow" in read);
  const edited = updateStep(read.flow, "first", (step) => void (step.displayName = "Renamed"));
  assert.equal(edited.id, "flow_1");
  assert.deepEqual((edited as Flow & { notes?: unknown }).notes, [{ text: "keep me" }]);
  assert.equal(addStep(edited, { after: "first" }, code("second")).id, "flow_1");
  assert.equal(removeStep(edited, "first").id, "flow_1");
});

const branching = (): Flow => {
  const router: FlowStep = { ...newRouterStep("route"), children: [code("yes", code("yes_more")), code("no")], nextAction: code("join") };
  const loop: FlowStep = { ...newLoopStep("each"), firstLoopAction: code("inside"), nextAction: router };
  return flowOf(code("first", loop));
};

test("every step is found: in order, inside loops and branches", () => {
  assert.deepEqual(allSteps(branching().trigger).map((step) => step.name), ["trigger", "first", "each", "inside", "route", "yes", "yes_more", "no", "join"]);
  assert.equal(findStep(branching(), "yes_more")?.name, "yes_more");
  assert.equal(findStep(branching(), "nothing"), null);
});

test("a step that points back at itself can't hang it", () => {
  const looped = code("a");
  looped.nextAction = looped;
  assert.equal(allSteps(looped).length, 1);
});

test("the chart joins each step to the next", () => {
  const { items, edges } = chartOfFlow(flowOf(code("a", code("b"))), undefined);
  assert.deepEqual(items.map((item) => item.id), ["trigger", "a", "b"]);
  assert.deepEqual(edges, [{ from: "trigger", to: "a" }, { from: "a", to: "b" }]);
});

test("a router's branches go their own ways and come back together", () => {
  const { edges } = chartOfFlow(branching(), undefined);
  const to = (name: string) => edges.filter((edge) => edge.to === name).map((edge) => edge.from).sort();
  assert.deepEqual(to("yes"), ["route"]);
  assert.deepEqual(to("no"), ["route"]);
  assert.deepEqual(to("yes_more"), ["yes"]);
  assert.deepEqual(to("join"), ["no", "yes_more"]);
});

test("an empty branch goes straight to what's after the router", () => {
  const router: FlowStep = { ...newRouterStep("route"), children: [code("yes"), null], nextAction: code("join") };
  const { edges } = chartOfFlow(flowOf(router), undefined);
  assert.deepEqual(edges.filter((edge) => edge.to === "join").map((edge) => edge.from).sort(), ["route", "yes"]);
});

test("a loop leads inside it, and on to what's next", () => {
  const { edges } = chartOfFlow(branching(), undefined);
  assert.ok(edges.some((edge) => edge.from === "each" && edge.to === "inside"));
  assert.ok(edges.some((edge) => edge.from === "each" && edge.to === "route"));
  assert.ok(!edges.some((edge) => edge.from === "inside" && edge.to === "route"), "what's after a loop follows the loop");
});

test("what a run did lights up the chart", () => {
  const { items } = chartOfFlow(flowOf(code("a", code("b", code("c")))), { trigger: ran("SUCCEEDED"), a: ran("SUCCEEDED"), b: ran("FAILED") });
  const of = (name: string) => items.find((item) => item.id === name)!;
  assert.equal(of("a").status, "ok");
  assert.equal(of("b").status, "failed");
  assert.equal(of("c").status, "idle");
  assert.match(of("b").description, /failed/);
  assert.match(of("c").description, /didn't run/);
  assert.doesNotMatch(chartOfFlow(flowOf(code("a")), undefined).items[1]!.description, /didn't run/, "with no run, nothing's said about running");
});

test("a step inside a loop shows how many times, and fails if any time did", () => {
  const steps = { each: { type: "LOOP_ON_ITEMS", status: "SUCCEEDED", output: { iterations: [{ inside: ran("SUCCEEDED") }, { inside: ran("FAILED") }, { inside: ran("SUCCEEDED") }] } } };
  const results = resultsOf(steps);
  assert.equal(results.get("inside")?.times, 3);
  assert.equal(results.get("inside")?.status, "failed");
  assert.equal(results.get("inside")?.results.length, 3);
  const { items } = chartOfFlow(flowOf({ ...newLoopStep("each"), firstLoopAction: code("inside") }), steps);
  assert.match(items.find((item) => item.id === "inside")!.detail, /3 times/);
});

test("results are worded from what the engine says", () => {
  assert.equal(statusOfResult({ status: "SUCCEEDED" }), "ok");
  assert.equal(statusOfResult({ status: "FAILED" }), "failed");
  assert.equal(statusOfResult({ status: "RUNNING" }), "running");
  assert.equal(statusOfResult({ status: "STOPPED" }), "skipped");
  assert.equal(statusOfResult(null), "idle");
  assert.equal(statusOfResult({ status: "SOMETHING NEW" }), "idle");
});

test("a step says what it is", () => {
  const pieces = { "@activepieces/piece-github": PIECE };
  const step = newPieceStep("a", "@activepieces/piece-github", PIECE, "create_issue");
  assert.equal(kindOf(step, pieces), "GitHub: Create issue");
  assert.equal(kindOf(step), "github");
  assert.equal(kindOf(newCodeStep("a")), "Code");
  assert.equal(kindOf(newRouterStep("a")), "Router");
  assert.equal(kindOf(newLoopStep("a")), "Loop");
  assert.equal(kindOf(newTrigger("@activepieces/piece-github", PIECE, "new_issue"), pieces), "GitHub: New issue");
});

test("new steps have their fields' defaults, and only those", () => {
  const step = newPieceStep("a", "@activepieces/piece-github", PIECE, "create_issue");
  assert.deepEqual(step.settings.input, { state: "open" });
  assert.equal(step.settings.pieceVersion, "1.0.0");
  assert.equal(step.displayName, "Create issue");
  assert.deepEqual(newTrigger("@activepieces/piece-github", PIECE, "new_issue").settings.input, { labels: "bug" });
});

test("a new step's name is one nothing else has", () => {
  assert.equal(newStepName(flowOf(code("step_1", code("step_2")))), "step_3");
  assert.equal(newStepName(flowOf(null), "Send a Slack message!"), "send_a_slack_message_1");
  assert.match(newStepName(flowOf(null), "../../evil"), /^[a-z0-9_]+$/);
  assert.equal(newStepName(flowOf(null), "!!!"), "step_1");
});

test("a step is added after another, keeping what followed", () => {
  const flow = flowOf(code("a", code("b")));
  const after = addStep(flow, { after: "a" }, code("new"));
  assert.deepEqual(allSteps(after.trigger).map((step) => step.name), ["trigger", "a", "new", "b"]);
  assert.deepEqual(allSteps(flow.trigger).map((step) => step.name), ["trigger", "a", "b"], "the flow it was given is as it was");
  assert.equal(addStep(flow, { after: "nothing" }, code("new")), flow);
});

test("a step is added inside a loop or a branch", () => {
  const looped = addStep(flowOf(newLoopStep("each")), { insideLoop: "each" }, code("inside"));
  assert.equal(findStep(looped, "each")?.firstLoopAction?.name, "inside");
  const second = addStep(looped, { insideLoop: "each" }, code("before"));
  assert.deepEqual(allSteps(findStep(second, "each")!.firstLoopAction).map((step) => step.name), ["before", "inside"]);
  const routed = addStep(flowOf(newRouterStep("route")), { inBranch: "route", branch: 1 }, code("no"));
  assert.equal(findStep(routed, "route")?.children?.[1]?.name, "no");
  assert.equal(findStep(routed, "route")?.children?.[0], null);
  assert.equal(addStep(flowOf(code("a")), { insideLoop: "a" }, code("x")).trigger.nextAction?.firstLoopAction, undefined, "only a loop has an inside");
});

test("taking a step out joins what was either side of it", () => {
  const flow = flowOf(code("a", code("b", code("c"))));
  assert.deepEqual(allSteps(removeStep(flow, "b").trigger).map((step) => step.name), ["trigger", "a", "c"]);
  assert.deepEqual(allSteps(flow.trigger).map((step) => step.name), ["trigger", "a", "b", "c"], "the flow it was given is as it was");
});

test("taking out a router or loop takes what's inside with it", () => {
  assert.deepEqual(allSteps(removeStep(branching(), "route").trigger).map((step) => step.name), ["trigger", "first", "each", "inside", "join"]);
  assert.deepEqual(allSteps(removeStep(branching(), "each").trigger).map((step) => step.name), ["trigger", "first", "route", "yes", "yes_more", "no", "join"]);
});

test("a step in a branch or a loop can be taken out", () => {
  assert.equal(findStep(removeStep(branching(), "yes"), "route")?.children?.[0]?.name, "yes_more");
  assert.equal(findStep(removeStep(branching(), "no"), "route")?.children?.[1], null);
  assert.equal(findStep(removeStep(branching(), "inside"), "each")?.firstLoopAction, null);
});

test("the trigger stays", () => {
  const flow = flowOf(code("a"));
  assert.equal(removeStep(flow, "trigger"), flow);
});

test("a step's changes stay in a copy", () => {
  const flow = flowOf(code("a"));
  const changed = updateStep(flow, "a", (step) => {
    step.displayName = "Renamed";
  });
  assert.equal(findStep(changed, "a")?.displayName, "Renamed");
  assert.equal(findStep(flow, "a")?.displayName, "Code");
});

test("a step can use what ran before it, and not what runs after", () => {
  assert.deepEqual(expressionsFor(branching(), "first"), ["{{trigger.output.body}}"]);
  assert.deepEqual(expressionsFor(branching(), "join"), ["{{trigger.output.body}}", "{{first.output}}", "{{each.output}}", "{{route.output}}"]);
});

test("inside a loop, its item too", () => {
  assert.deepEqual(expressionsFor(branching(), "inside"), ["{{trigger.output.body}}", "{{first.output}}", "{{each.output.item}}", "{{each.output.index}}"]);
});

test("in a branch, what's before the router", () => {
  assert.deepEqual(expressionsFor(branching(), "yes_more"), ["{{trigger.output.body}}", "{{first.output}}", "{{each.output}}", "{{yes.output}}"]);
  assert.deepEqual(expressionsFor(branching(), "no"), ["{{trigger.output.body}}", "{{first.output}}", "{{each.output}}"]);
});
