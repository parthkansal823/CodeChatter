// Which runs each flow keeps (runs.mjs): node --test sandbox/image/automation/runs.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_KEEP_RUNS, flowKeyOf, keepRunsOf, MOST_KEEP_RUNS, runsToDrop } from "./runs.mjs";

test("a flow's folder: its id, or its path hashed to a safe name", () => {
  assert.equal(flowKeyOf("flow_abc-1", "a/b.flow.json"), "flow_abc-1");
  const byPath = flowKeyOf(null, "a/b.flow.json");
  assert.match(byPath, /^path-[0-9a-f]{24}$/);
  assert.equal(flowKeyOf(undefined, "a/b.flow.json"), byPath, "the same path, the same folder");
  assert.notEqual(flowKeyOf(null, "a/c.flow.json"), byPath);
  assert.match(flowKeyOf("../escape", "x"), /^path-/, "an id that isn't one isn't used as a folder");
});

test("how many runs a flow keeps", () => {
  assert.equal(keepRunsOf({}), DEFAULT_KEEP_RUNS);
  assert.equal(keepRunsOf({ settings: { keepRuns: 3 } }), 3);
  assert.equal(keepRunsOf({ settings: { keepRuns: 100000 } }), MOST_KEEP_RUNS);
  assert.equal(keepRunsOf({ settings: { keepRuns: 0 } }), DEFAULT_KEEP_RUNS);
  assert.equal(keepRunsOf({ settings: { keepRuns: "7" } }), DEFAULT_KEEP_RUNS);
});

test("the oldest beyond the number go, but never one waiting", () => {
  const markers = [
    { id: "20261120-100000-aaaa", status: "SUCCEEDED" },
    { id: "20261120-090000-bbbb", status: "PAUSED" },
    { id: "20261120-110000-cccc", status: "FAILED" },
    { id: "20261120-080000-dddd", status: "SUCCEEDED" },
  ];
  assert.deepEqual(runsToDrop(markers, 2), ["20261120-080000-dddd"]);
  assert.deepEqual(runsToDrop(markers, 4), []);
  assert.deepEqual(runsToDrop(markers, 1), ["20261120-100000-aaaa", "20261120-080000-dddd"]);
});
