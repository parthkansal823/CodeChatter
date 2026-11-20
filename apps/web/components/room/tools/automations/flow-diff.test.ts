// What changed in a flow between two versions (flow-diff.ts): run from apps/runner with `pnpm exec tsx --test <this file's absolute path>`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { changesInWords, flowChanges, flowIn, stable } from "./flow-diff";
import type { Flow, FlowStep } from "./model";

const step = (name: string, settings: Record<string, unknown> = {}, nextAction: FlowStep | null = null, extra: Partial<FlowStep> = {}): FlowStep => ({ name, type: "CODE", displayName: name, settings, nextAction, ...extra });
const flowOf = (first: FlowStep | null, extra: Partial<Flow> = {}): Flow => ({ displayName: "Orders", schemaVersion: "27", trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: "When called", settings: {}, nextAction: first }, ...extra });

test("the same flow, with its settings' keys in another order, hasn't changed", () => {
  const before = flowOf(step("a", { x: 1, y: { p: 1, q: 2 } }));
  const after = flowOf(step("a", { y: { q: 2, p: 1 }, x: 1 }));
  assert.deepEqual(flowChanges(before, after), { steps: [], flow: [] });
  assert.equal(changesInWords(flowChanges(before, after)), "The same as now");
  assert.equal(stable({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
});

test("steps added, removed, changed and moved, in the order they are now", () => {
  const before = flowOf(step("a", { code: 1 }, step("b", {}, step("c"))));
  const after = flowOf(step("b", {}, step("a", { code: 2 }, step("d", {}, null, { skip: true, displayName: "D" }))));
  const changes = flowChanges(before, after);
  assert.deepEqual(changes.steps, [
    { change: "changed", name: "b", title: "b", what: ["where it is"] },
    { change: "changed", name: "a", title: "a", what: ["its settings", "where it is"] },
    { change: "added", name: "d", title: "D", what: [] },
    { change: "removed", name: "c", title: "c", what: [] },
  ]);
  assert.equal(changesInWords(changes), "1 step added, 2 steps changed, 1 step removed");
});

test("a step's name shown, turned off, its kind, and the trigger", () => {
  const before = flowOf(step("a"));
  const after: Flow = { ...flowOf(step("a", {}, null, { displayName: "Send it", skip: true, type: "PIECE" })), trigger: { ...flowOf(null).trigger, settings: { pieceName: "x" }, nextAction: step("a", {}, null, { displayName: "Send it", skip: true, type: "PIECE" }) } };
  const changes = flowChanges(before, after);
  assert.deepEqual(changes.steps, [
    { change: "changed", name: "trigger", title: "The trigger, When called", what: ["its settings"] },
    { change: "changed", name: "a", title: "Send it", what: ["its kind", "its name, from a", "turned off"] },
  ]);
});

test("a step inside a branch moved to another branch is where it is, changed", () => {
  const router = (children: Array<FlowStep | null>) => step("route", {}, null, { type: "ROUTER", children });
  const changes = flowChanges(flowOf(router([step("x"), null])), flowOf(router([null, step("x")])));
  assert.deepEqual(changes.steps, [{ change: "changed", name: "x", title: "x", what: ["where it is"] }]);
});

test("the flow's own fields", () => {
  const before = flowOf(null, { description: "Old", tags: ["a"], settings: { timeoutSeconds: 60 } });
  const after = flowOf(null, { displayName: "Orders v2", tags: ["a", "b"], settings: { timeoutSeconds: 60 }, stickies: [{ id: "n", text: "Hi", x: 0, y: 0, width: 1, height: 1 }] });
  const changes = flowChanges(before, after);
  assert.deepEqual(changes.flow, ["its name, from Orders", "what it's for", "its tags", "notes on the chart"]);
  assert.equal(changesInWords({ steps: [], flow: ["its tags"] }), "the flow's tags");
  assert.equal(changesInWords(changes), "the flow's own fields");
});

test("the flow in a checkpoint: at its path, or moved, by its id, and not a file that isn't one", () => {
  const text = (id: string) => JSON.stringify({ ...flowOf(null), id });
  const files = new Map([["a/one.flow.json", text("flow_1")], ["b/moved.flow.json", text("flow_2")], ["c/broken.flow.json", "{ not json"]]);
  assert.equal(flowIn(files, "a/one.flow.json", "flow_1")?.path, "a/one.flow.json");
  assert.equal(flowIn(files, "old/place.flow.json", "flow_2")?.path, "b/moved.flow.json");
  assert.equal(flowIn(files, "old/place.flow.json", "flow_3"), null);
  assert.equal(flowIn(files, "c/broken.flow.json", undefined), null);
});
