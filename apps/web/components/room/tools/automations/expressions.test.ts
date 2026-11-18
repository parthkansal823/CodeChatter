import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldsOf, insertAt, partsOf, previewOf, suggestionsAt } from "./expressions";

test("a step's data lists its fields with the expression that reads each", () => {
  const fields = fieldsOf({ lines: 1100, user: { login: "asha" }, files: [{ path: "a.ts" }], "odd key": true }, "measure.output");
  const by = (path: string) => fields.find((field) => field.path === path);
  assert.equal(by("measure.output.lines")!.expression, "{{measure.output.lines}}");
  assert.equal(by("measure.output.lines")!.type, "number");
  assert.equal(by("measure.output.user")!.sample, "1 fields");
  assert.equal(by("measure.output.user.login")!.sample, "asha");
  assert.equal(by("measure.output.files")!.sample, "1 items");
  assert.ok(by("measure.output.files[0].path"), "a list shows its first item's fields");
  assert.ok(by('measure.output["odd key"]'), "a name that isn't a plain word is quoted");
  assert.deepEqual(fieldsOf("text", "x.output"), [], "a plain value has no fields of its own");
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < 20; i++) cursor = (cursor.next = {}) as Record<string, unknown>;
  assert.ok(fieldsOf(deep, "x").length <= 6, "it stops a few levels down");
});

test("a path's parts", () => {
  assert.deepEqual(partsOf("step_1.output.files[0].path"), ["step_1", "output", "files", 0, "path"]);
  assert.deepEqual(partsOf('a.output["odd key"]'), ["a", "output", "odd key"]);
  assert.deepEqual(partsOf("a.output['x']"), ["a", "output", "x"]);
  assert.equal(partsOf("a.output.x + 1"), null, "anything that isn't a path");
  assert.equal(partsOf(""), null);
});

test("an expression shows what it comes to on this run", () => {
  const data = { measure: { output: { lines: 1100, user: { login: "asha" } } }, trigger: { output: { body: { branch: "hotfix/x" } } } };
  assert.deepEqual(previewOf("{{measure.output.lines}}", data), { kind: "value", value: 1100 });
  assert.deepEqual(previewOf(" {{ measure.output.user }} ", data), { kind: "value", value: { login: "asha" } });
  assert.deepEqual(previewOf("By {{measure.output.user.login}} on {{trigger.output.body.branch}}", data), { kind: "text", text: "By asha on hotfix/x" });
  assert.deepEqual(previewOf("Lines: {{measure.output.user}}", data), { kind: "text", text: 'Lines: {"login":"asha"}' });
  assert.equal(previewOf("{{nothing.output.x}}", data).kind, "none");
  assert.equal(previewOf("{{measure.output.lines * 2}}", data).kind, "none", "it doesn't guess at what the engine would work out");
  assert.equal(previewOf("plain text", data).kind, "none");
});

test("using a field puts its expression where the cursor is", () => {
  assert.deepEqual(insertAt("Hello !", 6, 6, "{{a.output.name}}"), { text: "Hello {{a.output.name}}!", cursor: 23 });
  assert.deepEqual(insertAt("replace me", 0, 10, "{{x}}"), { text: "{{x}}", cursor: 5 });
  assert.deepEqual(insertAt("", 5, 9, "{{x}}"), { text: "{{x}}", cursor: 5 });
});

test("typing {{ offers what the steps before give, narrowed as it's typed", () => {
  const bases = ["{{trigger.output.body}}", "{{fetch.output}}"];
  const data = { trigger: { output: { body: { pr: 42, title: "Fix" } } }, fetch: { output: { status: 200, body: { items: [{ id: "a1" }] } } } };
  const text = "PR {{";
  const all = suggestionsAt(text, text.length, bases, data)!;
  assert.equal(all.start, 3);
  assert.equal(all.query, "");
  assert.deepEqual(all.items.slice(0, 3).map((item) => item.expression), ["{{trigger.output.body}}", "{{trigger.output.body.pr}}", "{{trigger.output.body.title}}"]);
  assert.ok(all.items.some((item) => item.expression === "{{fetch.output.body.items[0].id}}" && item.sample === "a1"));
  const narrowed = suggestionsAt("PR {{ fetch.out", 15, bases, data)!;
  assert.equal(narrowed.query, "fetch.out");
  assert.ok(narrowed.items.length > 0 && narrowed.items.every((item) => item.path.toLowerCase().includes("fetch.out")));
  // Inside the name, not just at its start, comes after.
  const inside = suggestionsAt("{{id", 4, bases, data)!;
  assert.equal(inside.items[0]?.path, "fetch.output.body.items[0].id");
});

test("nothing's offered outside {{ }}, and a closing }} after the cursor is replaced", () => {
  assert.equal(suggestionsAt("no braces", 9, ["{{a.output}}"], null), null);
  assert.equal(suggestionsAt("{{a.output}} done", 17, ["{{a.output}}"], null), null);
  const closing = suggestionsAt("x {{a}} y", 5, ["{{a.output}}"], null)!;
  assert.deepEqual({ start: closing.start, end: closing.end }, { start: 2, end: 7 });
  // Without a run's data, the steps themselves.
  assert.deepEqual(closing.items.map((item) => item.expression), ["{{a.output}}"]);
  assert.equal(closing.items[0]?.type, null);
});
