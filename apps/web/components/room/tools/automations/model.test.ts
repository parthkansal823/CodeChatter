import assert from "node:assert/strict";
import { test } from "node:test";

import type { AutomationStepResult, PieceInfo } from "@codechatter/contracts";

import { BUILTINS } from "./builtins";
import { stepsFromClipboard } from "./clipboard";
import { addSticky, changeSticky, chosenSteps, copyOfSteps, pasteSteps, removeSteps, removeSticky, stickiesOf, toggleSteps } from "./model";
import { addBranch, addStep, allSteps, asCopiedStep, canPin, newBuiltinStep, chartOfFlow, CONDITIONS, copyOfStep, isPinned, pinStep, unpinStep, duplicateStep, expressionsFor, findStep, kindOf, newCodeStep, newLoopStep, newPieceStep, newRouterStep, newStepName, newTrigger, parseFlow, pasteStep, removeBranch, removeStep, replaceStep, resultsOf, setStepNote, statusOfResult, toggleStep, updateStep, type Branch, type Flow, type FlowStep } from "./model";

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
  assert.deepEqual(edges, [
    { from: "trigger", to: "a", place: { after: "trigger" } },
    { from: "a", to: "b", place: { after: "a" } },
  ]);
});

test("for someone who can edit, there's a + wherever a step can go next, and each arrow says where a step put on it goes", () => {
  const { items, edges } = chartOfFlow(branching(), undefined, undefined, { adds: true });
  const adds = items.filter((item) => item.shape === "add");
  // After the last step, and after the last step inside the loop. Both branches have steps, so neither needs one of its own.
  assert.deepEqual(adds.map((item) => item.id).sort(), ["+after:inside", "+after:join"]);
  assert.deepEqual(adds.find((item) => item.id === "+after:join")!.place, { after: "join" });
  assert.match(adds.find((item) => item.id === "+after:inside")!.description, /^Add a step after Code$/);
  const into = (to: string) => edges.find((edge) => edge.to === to)!;
  assert.deepEqual(into("yes").place, { inBranch: "route", branch: 0 });
  assert.equal(into("yes").label, "Branch 1");
  assert.deepEqual(into("no").place, { inBranch: "route", branch: 1 });
  assert.equal(into("no").label, "Otherwise");
  assert.match(items.find((item) => item.id === "no")!.description, /, first in the Otherwise branch of Router$/);
  assert.deepEqual(into("inside").place, { insideLoop: "each" });
  assert.equal(into("inside").label, "Each");
  // What leaves a branch and joins the step after the router goes at the end of that branch.
  assert.deepEqual(edges.find((edge) => edge.from === "yes_more" && edge.to === "join")!.place, { after: "yes_more" });

  const empty = chartOfFlow(flowOf({ ...newRouterStep("route"), nextAction: code("after") }), undefined, undefined, { adds: true });
  const branchAdds = empty.items.filter((item) => item.id.startsWith("+branch:"));
  assert.deepEqual(branchAdds.map((item) => item.place), [{ inBranch: "route", branch: 0 }, { inBranch: "route", branch: 1 }]);
  // An empty branch still goes on to what's after the router, through its +.
  assert.ok(empty.edges.some((edge) => edge.from === "+branch:route:0" && edge.to === "after"));
  const loop = chartOfFlow(flowOf(newLoopStep("each")), undefined, undefined, { adds: true });
  assert.deepEqual(loop.items.find((item) => item.id === "+inside:each")!.place, { insideLoop: "each" });
  assert.equal(chartOfFlow(branching(), undefined).items.filter((item) => item.shape === "add").length, 0, "nothing to add for someone who can't edit");
});

test("a step turned off says so, and its note is shown", () => {
  const flow = setStepNote(toggleStep(flowOf(code("a", code("b"))), "a"), "a", "Waiting for the API key");
  const item = chartOfFlow(flow, undefined).items.find((each) => each.id === "a")!;
  assert.equal(item.muted, true);
  assert.match(item.detail, /^Off · Code/);
  assert.equal(item.note, "Waiting for the API key");
  assert.match(item.description, /turned off.*note: Waiting for the API key/);
  assert.equal(findStep(toggleStep(flow, "a"), "a")!.skip, false, "turning it on again");
  assert.equal(toggleStep(flow, "trigger"), flow, "the trigger can't be turned off");
  assert.deepEqual(setStepNote(flow, "a", "  ").stepNotes, {}, "an empty note goes");
  assert.deepEqual(removeStep(flow, "a").stepNotes, {}, "a removed step's note goes with it");
});

test("copying and pasting gives the copy and what's inside it new names, and its expressions follow them", () => {
  const inside: FlowStep = { ...newCodeStep("inner_1"), settings: { ...newCodeStep("inner_1").settings, input: { item: "{{loop_1.output.item}}", before: "{{a.output.value}}" } } };
  const flow: Flow = { ...flowOf(code("a", { ...newLoopStep("loop_1"), firstLoopAction: inside })), stepNotes: { loop_1: "the loop" } };
  const copy = copyOfStep(flow, "loop_1")!;
  assert.equal(copy.nextAction, null, "what comes after isn't copied");
  const pasted = pasteStep(flow, { after: "a" }, copy);
  assert.equal(pasted.name, "loop_2");
  const loop = findStep(pasted.flow, "loop_2")!;
  assert.equal(loop.firstLoopAction!.name, "inner_2");
  assert.deepEqual(loop.firstLoopAction!.settings.input, { item: "{{loop_2.output.item}}", before: "{{a.output.value}}" });
  assert.equal(loop.nextAction!.name, "loop_1", "it goes in, and what was there comes after it");
  assert.equal(pasted.flow.stepNotes!.loop_2, "the loop");
  assert.equal(new Set(allSteps(pasted.flow.trigger).map((step) => step.name)).size, allSteps(pasted.flow.trigger).length, "every name is still its own");
  assert.equal(copyOfStep(flow, "trigger"), null, "the trigger isn't copied");

  const twice = duplicateStep(pasted.flow, "a")!;
  assert.equal(twice.name, "a_1");
  assert.equal(findStep(twice.flow, "a")!.nextAction!.name, "a_1");
  assert.equal(asCopiedStep({ name: "x", type: "PIECE_TRIGGER", settings: {} }), null, "a trigger from the clipboard isn't pasted");
  assert.equal(asCopiedStep("not a step"), null);
  assert.equal(asCopiedStep({ ...newCodeStep("x"), nextAction: code("y") })!.nextAction, null);
});

test("replacing a step keeps its name and what comes after it", () => {
  const flow = flowOf(code("a", code("b")));
  const replaced = replaceStep(flow, "a", newPieceStep("ignored", "@activepieces/piece-github", PIECE, "create_issue"));
  const step = findStep(replaced, "a")!;
  assert.equal(step.type, "PIECE");
  assert.equal(step.nextAction!.name, "b");
  const retriggered = replaceStep(flow, "trigger", newTrigger("@activepieces/piece-github", PIECE, "new_issue"));
  assert.equal((retriggered.trigger.settings as { triggerName: string }).triggerName, "new_issue");
  assert.equal(retriggered.trigger.nextAction!.name, "a");
  assert.equal(replaceStep(flow, "trigger", newCodeStep("x")), flow, "a trigger only becomes another trigger");
  assert.equal(replaceStep(flow, "a", newRouterStep("r")), flow, "nothing with steps inside it replaces a step");
  const withRouter = flowOf(newRouterStep("r"));
  assert.equal(replaceStep(withRouter, "r", newCodeStep("x")), withRouter, "a router keeps its branches");
});

test("a router can have more branches, and lose them, but keeps one with a test and the one for when nothing matches", () => {
  const flow = flowOf({ ...newRouterStep("route"), children: [code("first"), code("otherwise")] });
  const more = addBranch(flow, "route");
  const router = findStep(more, "route")!;
  const branches = router.settings.branches as Branch[];
  assert.deepEqual(branches.map((branch) => branch.branchType), ["CONDITION", "CONDITION", "FALLBACK"]);
  assert.equal(branches[1]!.branchName, "Branch 2");
  assert.deepEqual(router.children!.map((child) => child?.name ?? null), ["first", null, "otherwise"], "the new branch is empty, and the others keep their steps");
  const fewer = removeBranch(more, "route", 0);
  assert.deepEqual((findStep(fewer, "route")!.children ?? []).map((child) => child?.name ?? null), [null, "otherwise"]);
  assert.equal(findStep(fewer, "first"), null, "a branch's steps go with it");
  assert.equal(removeBranch(fewer, "route", 0), fewer, "the last branch with a test stays");
  assert.equal(removeBranch(more, "route", 2), more, "the one for when nothing matches stays");
});

test("a step's output can be pinned, and the pin goes with it when it's copied or removed", () => {
  const flow = flowOf(code("a", code("b")));
  const pinned = pinStep(flow, "a", { lines: 3 });
  assert.deepEqual(pinned.pinned, { a: { lines: 3 } });
  assert.ok(isPinned(pinned, findStep(pinned, "a")!));
  const item = chartOfFlow(pinned, undefined).items.find((each) => each.id === "a")!;
  assert.match(item.detail, /^Pinned · Code/);
  assert.match(item.description, /pinned/);
  assert.deepEqual(pinStep(flow, "trigger", { body: { n: 1 } }).pinned, { trigger: { body: { n: 1 } } }, "the trigger's data can be pinned too");
  assert.equal(canPin(newRouterStep("r")), false);
  assert.equal(canPin(newLoopStep("l")), false);
  // A step replaced is another step: its pin goes.
  assert.deepEqual(replaceStep(pinned, "a", newPieceStep("x", "@activepieces/piece-github", PIECE, "create_issue")).pinned, {});
  assert.deepEqual(replaceStep(pinStep(flow, "trigger", {}), "trigger", newTrigger("@activepieces/piece-github", PIECE, "new_issue")).pinned, {}, "and a trigger changed loses its pin");
  assert.deepEqual(unpinStep(pinned, "a").pinned, {});
  assert.equal(unpinStep(flow, "a"), flow, "nothing to unpin");
  assert.deepEqual(removeStep(pinned, "a").pinned, {}, "a removed step's pin goes with it");
  const pasted = pasteStep(pinned, { after: "b" }, copyOfStep(pinned, "a")!);
  assert.deepEqual(pasted.flow.pinned![pasted.name], { lines: 3 }, "a copy keeps the pin, under its own name");
  assert.deepEqual(pinStep(flow, "a", undefined).pinned, { a: null }, "nothing came out is pinned as null");
});

test("a built-in step is a code step marked with what it is, shown by its name", () => {
  const step = newBuiltinStep("filter_1", "filter");
  assert.equal(step.type, "CODE");
  assert.equal(step.builtin, "filter");
  assert.equal(step.displayName, "Filter");
  assert.deepEqual(step.settings.input, BUILTINS.filter!.defaults);
  assert.equal(kindOf(step), "Filter");
  const item = chartOfFlow(flowOf(step), undefined).items.find((each) => each.id === "filter_1")!;
  assert.equal(item.glyph, "data");
  assert.match(item.detail, /^Filter/);
  for (const [name, builtin] of Object.entries(BUILTINS)) for (const key of Object.keys(builtin.defaults)) assert.ok(builtin.fields[key], `${name} has a field for ${key}`);
});

test("a router's tests are the engine's own names", () => {
  assert.equal(CONDITIONS.length, 22);
  assert.ok(CONDITIONS.some((condition) => condition.value === "TEXT_START_WITH"), "starts with has no S in the engine");
  assert.ok(!CONDITIONS.some((condition) => condition.value === "TEXT_STARTS_WITH"));
  assert.equal(new Set(CONDITIONS.map((condition) => condition.value)).size, CONDITIONS.length);
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

test("notes placed freely on the chart: added, moved, sized, typed in, removed, and a broken one passed over", () => {
  const flow = flowOf(code("a"));
  const added = addSticky(flow, { x: 10.4, y: -20.6 })!;
  const [note] = added.flow.stickies!;
  assert.deepEqual({ ...note, id: "" }, { id: "", text: "", x: 10, y: -21, width: 220, height: 120 });
  const moved = changeSticky(added.flow, added.id, { x: 300.7, y: 40, text: "Check the rate limit first." });
  assert.deepEqual(moved.stickies![0], { id: added.id, text: "Check the rate limit first.", x: 301, y: 40, width: 220, height: 120 });
  assert.equal(changeSticky(moved, added.id, { width: 20, height: 10 }).stickies![0]!.width, 140, "never smaller than a note can be");
  assert.equal(changeSticky(moved, added.id, { text: "x".repeat(5000) }).stickies![0]!.text.length, 4000);
  assert.equal(changeSticky(moved, "not_there", { x: 1 }), moved, "a note that isn't there changes nothing");
  assert.equal(removeSticky(moved, added.id).stickies, undefined, "the last one leaves no list behind");
  assert.deepEqual(stickiesOf({ ...flow, stickies: [{ id: "ok", text: "fine", x: 0, y: 0, width: 50, height: 400 }, { id: 3 } as never, null as never] }), [{ id: "ok", text: "fine", x: 0, y: 0, width: 140, height: 400 }]);
  let many = flow;
  for (let i = 0; i < 50; i++) many = addSticky(many, { x: i, y: 0 })!.flow;
  assert.equal(addSticky(many, { x: 0, y: 0 }), null, "50 at most");
});

test("several steps chosen together: in the flow's order, done to all at once, copied and pasted one after another", () => {
  const route = { ...newRouterStep("route"), children: [code("left"), code("right")] };
  const flow = flowOf(code("a", code("b", { ...route, nextAction: code("c") })));
  assert.deepEqual(chosenSteps(flow, ["c", "a", "trigger", "gone"]), ["a", "c"], "the flow's order; never the trigger or a step that isn't there");
  assert.deepEqual(chosenSteps(flow, ["route", "left", "b"]), ["b", "route"], "a router carries what's inside it");
  const removed = removeSteps(flow, ["a", "route"]);
  assert.deepEqual(allSteps(removed.trigger).map((step) => step.name), ["trigger", "b", "c"]);
  const off = toggleSteps(flow, ["a", "b"]);
  assert.equal(off.off, true);
  assert.deepEqual(["a", "b"].map((name) => findStep(off.flow, name)!.skip), [true, true]);
  const mixed = toggleSteps(toggleStep(flow, "a"), ["a", "b"]);
  assert.equal(mixed.off, true, "off when any of them is on");
  assert.equal(toggleSteps(off.flow, ["a", "b"]).off, false, "on again when all are off");
  const copied = copyOfSteps(flow, ["c", "a"]);
  assert.deepEqual(copied.map((step) => step.name), ["a", "c"]);
  assert.ok(copied.every((step) => step.nextAction === null), "each without what came after it");
  const pasted = pasteSteps(flow, { after: "c" }, copied);
  assert.deepEqual(pasted.names, ["a_1", "c_1"]);
  assert.deepEqual(allSteps(pasted.flow.trigger).map((step) => step.name).slice(-2), ["a_1", "c_1"], "one after another, where they went");
});

test("what the system clipboard has: one step, a list of them, or nothing", () => {
  assert.equal(stepsFromClipboard(code("x")).length, 1);
  assert.deepEqual(stepsFromClipboard([code("x"), code("y")]).map((step) => step.name), ["x", "y"]);
  assert.deepEqual(stepsFromClipboard([code("x"), { not: "a step" }]), [], "one that isn't a step spoils the lot");
  assert.deepEqual(stepsFromClipboard("text"), []);
  assert.deepEqual(stepsFromClipboard([]), []);
});
