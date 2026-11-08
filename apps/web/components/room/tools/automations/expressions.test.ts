import assert from "node:assert/strict";
import { test } from "node:test";

import { fieldsOf, insertAt, partsOf, previewOf } from "./expressions";

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
