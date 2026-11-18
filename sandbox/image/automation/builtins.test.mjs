// The built-in steps (builtins.mjs), on their own: node --test sandbox/image/automation/builtins.test.mjs. They also run on the real engine in apps/runner/test/automations.e2e.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILTINS, listOf, read, run, TESTS } from "./builtins.mjs";

const tests = [
  { name: "login", status: "failed", ms: 120, suite: { name: "auth" }, tags: ["slow", "ui"] },
  { name: "search", status: "passed", ms: 900, suite: { name: "web" }, tags: ["ui"] },
  { name: "save", status: "failed", ms: 40, suite: { name: "web" }, tags: [] },
  { name: "search", status: "passed", ms: 900, suite: { name: "web" }, tags: ["ui"] },
];

test("paths and lists", () => {
  assert.equal(read(tests[0], "suite.name"), "auth");
  assert.equal(read(tests[0], "tags[1]"), "ui");
  assert.equal(read(tests[0], ""), tests[0]);
  assert.deepEqual(listOf('[{"a":1}]'), [{ a: 1 }], "JSON text is read");
  assert.deepEqual(listOf({ a: 1 }), [{ a: 1 }], "one item is a list of one");
  assert.deepEqual(listOf(""), []);
  assert.deepEqual(listOf(null), []);
});

test("Edit Fields sets, keeps and removes, and reads from the item", () => {
  const set = BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "set", fields: { "result.ok": false, label: "$item.suite.name", fixed: 1 } });
  assert.deepEqual(set[0].result, { ok: false });
  assert.equal(set[0].label, "auth");
  assert.equal(set[0].name, "login", "the rest stays");
  assert.equal(tests[0].result, undefined, "what it was given isn't changed");
  assert.deepEqual(BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "keep", fields: "name, suite.name" }), [{ name: "login", suite: { name: "auth" } }]);
  assert.deepEqual(Object.keys(BUILTINS.edit_fields({ items: tests.slice(0, 1), mode: "remove", fields: ["ms", "tags"] })[0]), ["name", "status", "suite"]);
  assert.deepEqual(BUILTINS.edit_fields({ items: undefined, fields: '{"hello":"world"}' }), [{ hello: "world" }], "with no items, it makes one");
  assert.throws(() => BUILTINS.edit_fields({ items: [{}], fields: "[1]" }), /object of names and values/);
});

test("Filter keeps what passes, or what doesn't", () => {
  assert.deepEqual(BUILTINS.filter({ items: tests, field: "status", test: "equals", value: "failed" }).map((item) => item.name), ["login", "save"]);
  assert.equal(BUILTINS.filter({ items: tests, field: "status", test: "equals", value: "failed", keep: "failing" }).length, 2);
  assert.equal(BUILTINS.filter({ items: tests, field: "ms", test: "greater", value: "100" }).length, 3);
  assert.equal(BUILTINS.filter({ items: tests, field: "tags", test: "contains", value: "slow" }).length, 1, "contains looks in a list");
  assert.equal(BUILTINS.filter({ items: tests, field: "tags", test: "empty" }).length, 1);
  assert.equal(BUILTINS.filter({ items: tests, field: "name", test: "matches", value: "^s" }).length, 3);
  assert.throws(() => BUILTINS.filter({ items: tests, test: "nope" }), /no test called/);
  assert.ok(Object.keys(TESTS).length >= 19);
});

test("Sort by text, numbers or dates, either way, with nothing last", () => {
  assert.deepEqual(BUILTINS.sort({ items: tests, field: "ms", compare_as: "number", direction: "descending" }).map((item) => item.ms), [900, 900, 120, 40]);
  assert.deepEqual(BUILTINS.sort({ items: [{ v: "b" }, { v: "a10" }, { v: "a2" }, {}], field: "v" }).map((item) => item.v), ["a2", "a10", "b", undefined], "numbers inside text sort as people expect");
  assert.deepEqual(BUILTINS.sort({ items: [{ d: "2026-02-01" }, { d: "2026-01-01" }], field: "d", compare_as: "date" }).map((item) => item.d), ["2026-01-01", "2026-02-01"]);
});

test("Limit from the start or the end", () => {
  assert.equal(BUILTINS.limit({ items: tests, max: 2 }).length, 2);
  assert.deepEqual(BUILTINS.limit({ items: tests, max: "1", from: "end" }), [tests[3]]);
  assert.deepEqual(BUILTINS.limit({ items: tests, max: 0 }), []);
});

test("Aggregate gathers a field, or every item", () => {
  assert.deepEqual(BUILTINS.aggregate({ items: tests, fields: "ms" }), { count: 4, ms: [120, 900, 40, 900] });
  assert.deepEqual(BUILTINS.aggregate({ items: tests, fields: "name, suite.name" }), { count: 4, name: ["login", "search", "save", "search"], "suite.name": ["auth", "web", "web", "web"] }, "two fields that would share a name keep their whole paths");
  assert.deepEqual(BUILTINS.aggregate({ items: [{ a: 1 }, { a: null }, { b: 2 }], fields: "a" }), { count: 3, a: [1] }, "empty values are skipped");
  assert.deepEqual(BUILTINS.aggregate({ items: [{ a: 1 }] }), { items: [{ a: 1 }], count: 1 });
});

test("Summarize, overall and in groups", () => {
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "count" }), { count: 4 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "sum", field: "ms", group_by: "status" }), [
    { status: "failed", sum_ms: 160 },
    { status: "passed", sum_ms: 1800 },
  ]);
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "average", field: "ms" }), { average_ms: 490 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "count_unique", field: "name" }), { count_unique_name: 3 });
  assert.deepEqual(BUILTINS.summarize({ items: tests, operation: "max", field: "ms", group_by: "suite.name" }), [
    { name: "auth", max_ms: 120 },
    { name: "web", max_ms: 900 },
  ]);
  assert.deepEqual(BUILTINS.summarize({ items: tests.slice(0, 2), operation: "join", field: "name", separator: " | " }), { join_name: "login | search" });
  assert.deepEqual(BUILTINS.summarize({ items: [], operation: "min", field: "ms" }), { min_ms: null });
});

test("Remove Duplicates, by everything or by some fields, keeping the first or the last", () => {
  assert.equal(BUILTINS.remove_duplicates({ items: tests }).length, 3);
  assert.deepEqual(BUILTINS.remove_duplicates({ items: tests, fields: "status" }).map((item) => item.name), ["login", "search"]);
  assert.deepEqual(BUILTINS.remove_duplicates({ items: tests, fields: "status", keep: "last" }).map((item) => item.name), ["save", "search"]);
});

test("Split Out turns a list inside each item into items", () => {
  assert.deepEqual(BUILTINS.split_out({ items: tests.slice(0, 2), field: "tags" }), [{ tags: "slow" }, { tags: "ui" }, { tags: "ui" }]);
  const kept = BUILTINS.split_out({ items: [{ id: 1, files: [{ path: "a" }, { path: "b" }] }], field: "files", keep_other_fields: true });
  assert.deepEqual(kept, [{ id: 1, path: "a" }, { id: 1, path: "b" }]);
});

test("Rename Keys", () => {
  assert.deepEqual(BUILTINS.rename_keys({ items: [{ a: 1, b: { c: 2 } }], renames: { a: "x", "b.c": "y" } }), [{ x: 1, b: {}, y: 2 }]);
});

test("Merge: one after the other, matched by a field, side by side, or every pairing", () => {
  const issues = [{ id: 1, title: "Bug" }, { id: 2, title: "Idea" }];
  const owners = [{ issue: 1, owner: "Asha" }, { issue: 3, owner: "Ben" }];
  assert.equal(BUILTINS.merge({ first: issues, second: owners }).length, 4);
  assert.deepEqual(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue" }), [{ id: 1, title: "Bug", issue: 1, owner: "Asha" }]);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "all_first" }).length, 2);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "all" }).length, 3);
  assert.deepEqual(BUILTINS.merge({ first: issues, second: owners, mode: "match", first_key: "id", second_key: "issue", keep: "unmatched" }), [{ id: 2, title: "Idea" }]);
  assert.deepEqual(BUILTINS.merge({ first: [{ a: 1 }], second: [{ b: 2 }, { b: 3 }], mode: "position" }), [{ a: 1, b: 2 }, { b: 3 }]);
  assert.equal(BUILTINS.merge({ first: issues, second: owners, mode: "every_pair" }).length, 4);
  assert.throws(() => BUILTINS.merge({ first: issues, second: owners, mode: "match" }), /needs a field/);
});

test("Compare Datasets", () => {
  const before = [{ id: 1, v: "a" }, { id: 2, v: "b" }, { id: 3, v: "c" }];
  const after = [{ id: 1, v: "a" }, { id: 2, v: "B" }, { id: 4, v: "d" }];
  const result = BUILTINS.compare_datasets({ first: before, second: after, first_key: "id" });
  assert.deepEqual(result.same, [{ id: 1, v: "a" }]);
  assert.deepEqual(result.different, [{ key: 2, first: { id: 2, v: "b" }, second: { id: 2, v: "B" }, fields: ["v"] }]);
  assert.deepEqual(result.only_in_first, [{ id: 3, v: "c" }]);
  assert.deepEqual(result.only_in_second, [{ id: 4, v: "d" }]);
});

test("Stop and Error, and a step that isn't there", async () => {
  assert.throws(() => BUILTINS.stop_and_error({ message: "Coverage dropped" }), /Coverage dropped/);
  await assert.rejects(run("nope", {}), /no built-in step called "nope"/);
  assert.deepEqual(await run("limit", { items: [1, 2, 3], max: 1 }), [1]);
});

test("Call a flow: asks the worker on its own port, and gives back what it answers", async () => {
  const { createServer } = await import("node:http");
  const heard = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const call = JSON.parse(body);
      heard.push({ path: req.url, call });
      res.setHeader("content-type", "application/json");
      if (call.flowId === "flow_broken") return res.writeHead(409).end(JSON.stringify({ error: "Doubler failed: no number" }));
      if (!call.wait) return res.end(JSON.stringify({ runId: "20261118-100000-abcd1234", queued: true }));
      res.end(JSON.stringify({ output: { doubled: call.data.n * 2 }, runId: "20261118-100000-0000ffff" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = process.env.AP_SANDBOX_WS_PORT;
  process.env.AP_SANDBOX_WS_PORT = String(server.address().port);
  try {
    assert.deepEqual(await run("call_flow", { flow: "flow_doubler", data: { n: 21 } }), { doubled: 42 });
    assert.deepEqual(heard[0], { path: "/v1/codechatter/call-flow", call: { flowId: "flow_doubler", data: { n: 21 }, wait: true } });
    // What to send typed as JSON text, and not waiting.
    assert.deepEqual(await run("call_flow", { flow: "flow_doubler", data: '{"n": 1}', wait: false }), { runId: "20261118-100000-abcd1234", queued: true });
    assert.deepEqual(heard[1].call, { flowId: "flow_doubler", data: { n: 1 }, wait: false });
    await assert.rejects(run("call_flow", { flow: "flow_broken", data: {} }), /Doubler failed: no number/);
    await assert.rejects(run("call_flow", { flow: "flow_doubler", data: "{ not json" }), /isn't valid JSON/);
    delete process.env.AP_SANDBOX_WS_PORT;
    await assert.rejects(run("call_flow", { flow: "flow_doubler" }), /only works in a run/);
  } finally {
    if (before === undefined) delete process.env.AP_SANDBOX_WS_PORT;
    else process.env.AP_SANDBOX_WS_PORT = before;
    server.close();
  }
});
