import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { emptyAuth, emptyBody } from "../../../../../../packages/contracts/src/http-studio/request";
import type { RequestData } from "./model";
import { workerSource } from "./script-worker-source";
import { checksOf, readResult, scriptRequestOf, stoppedBecause, withScriptRequest, type ScriptInput } from "./scripts";

const request = (patch: Partial<RequestData> = {}): RequestData => ({
  id: "r1",
  name: "Get a pet",
  parentId: null,
  protocol: "http",
  method: "GET",
  url: "{{base}}/pets/1",
  params: [],
  headers: [
    { id: "h1", key: "Accept", value: "application/json", enabled: true },
    { id: "h2", key: "X-Off", value: "no", enabled: false },
  ],
  body: { ...emptyBody(), form: [] },
  auth: emptyAuth(),
  assertions: [],
  extracts: [],
  preScript: "",
  testScript: "",
  messages: [],
  example: null,
  ...patch,
});

/** The worker as the frame runs it, in a context of its own: what it posts back. */
async function runInWorker(code: string, input: ScriptInput): Promise<unknown> {
  const { source } = workerSource(code);
  let posted: unknown;
  const context = vm.createContext({ postMessage: (message: unknown) => (posted = JSON.parse(JSON.stringify(message))) });
  context.self = context;
  vm.runInContext(source, context);
  await (context.onmessage as (event: { data: ScriptInput }) => Promise<void>)({ data: input });
  return posted;
}
const response = { status: 201, statusText: "Created", timeMs: 120, size: 30, headers: [["Content-Type", "application/json"]] as Array<[string, string]>, body: '{"id":7,"name":"Milo","tags":["cat"]}' };

test("a pre-request script sees the request as written, and only its enabled headers", () => {
  assert.deepEqual(scriptRequestOf(request()), { method: "GET", url: "{{base}}/pets/1", headers: [{ key: "Accept", value: "application/json" }], body: null });
  assert.equal(scriptRequestOf(request({ method: "POST", body: { ...emptyBody(), mode: "json", text: '{"a":1}', form: [] } })).body, '{"a":1}');
});

test("what a pre-request script changes is used for that send", () => {
  const changed = withScriptRequest(request({ method: "POST", body: { ...emptyBody(), mode: "json", text: "{}", form: [] } }), {
    method: "put",
    url: "{{base}}/pets/2",
    headers: [{ key: "Accept", value: "application/json" }, { key: "X-Id", value: "abc" }],
    body: '{"b":2}',
  });
  assert.equal(changed.method, "PUT");
  assert.equal(changed.url, "{{base}}/pets/2");
  assert.deepEqual(changed.headers.map((row) => [row.key, row.value, row.enabled]), [["Accept", "application/json", true], ["X-Id", "abc", true]]);
  assert.equal(changed.body.text, '{"b":2}');
  // A method that isn't one, and a body that isn't text, are left as they were.
  const form = request({ body: { ...emptyBody(), mode: "form", form: [{ id: "f", key: "a", value: "1", enabled: true }] } });
  const kept = withScriptRequest(form, { method: "BREW", url: "x", headers: [], body: "changed" });
  assert.equal(kept.method, "GET");
  assert.equal(kept.body.form[0]!.value, "1");
  assert.equal(kept.body.text, "");
});

test("pm in the worker: variables, the request, logs and tests", async () => {
  const before = (await runInWorker(
    `pm.environment.set("token", "abc");
pm.environment.unset("old");
pm.request.headers.upsert({ key: "Authorization", value: "Bearer " + pm.environment.get("token") });
pm.request.headers.add("X-Two", 2);
pm.request.headers.remove("accept");
pm.request.url = pm.environment.replaceIn("{{base}}/pets/" + 2);
console.log("sending", { to: pm.request.url });
console.warn("careful");`,
    { kind: "pre", name: "Get a pet", variables: { base: "https://api.test", old: "x" }, request: scriptRequestOf(request()) },
  )) as Record<string, unknown>;
  const result = readResult(before, 1);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.variables, { token: "abc", old: null });
  assert.equal(result.request?.url, "https://api.test/pets/2");
  assert.deepEqual(result.request?.headers, [{ key: "Authorization", value: "Bearer abc" }, { key: "X-Two", value: "2" }]);
  assert.deepEqual(result.logs, [{ level: "log", text: 'sending {"to":"https://api.test/pets/2"}' }, { level: "warn", text: "careful" }]);

  const after = readResult(
    await runInWorker(
      `pm.test("Created", () => pm.response.to.have.status(201));
pm.test("Is ok", () => pm.response.to.be.ok);
pm.test("Has a type", () => pm.response.to.have.header("content-type"));
pm.test("Named Milo", () => pm.expect(pm.response.json().name).to.equal("Milo"));
pm.test("Tagged", () => pm.expect(pm.response.json().tags).to.include("cat"));
pm.test("Quick", () => pm.expect(pm.response.responseTime).to.be.below(100));
pm.test("Later", async () => { await Promise.resolve(); pm.expect(1).to.not.equal(1); });
pm.environment.set("petId", pm.response.json().id);`,
      { kind: "test", name: "Get a pet", variables: {}, request: scriptRequestOf(request()), response },
    ),
    1,
  );
  assert.deepEqual(
    after.tests.map((each) => [each.name, each.passed]),
    [["Created", true], ["Is ok", true], ["Has a type", true], ["Named Milo", true], ["Tagged", true], ["Quick", false], ["Later", false]],
  );
  assert.match(after.tests[5]!.error ?? "", /expected 120 to be below 100/);
  assert.deepEqual(after.variables, { petId: "7" });
  assert.deepEqual(
    checksOf(after, "after").map((check) => check.name),
    ["Created", "Is ok", "Has a type", "Named Milo", "Tagged", "Quick", "Later"],
  );
});

test("a script has no network, and says where it stopped", async () => {
  const blocked = readResult(await runInWorker("await fetch('https://example.test');", { kind: "pre", name: "x", variables: {}, request: scriptRequestOf(request()) }), 1);
  assert.match(blocked.error ?? "", /fetch is not a function/);
  const sent = readResult(await runInWorker("pm.sendRequest('https://example.test');", { kind: "pre", name: "x", variables: {}, request: scriptRequestOf(request()) }), 1);
  assert.match(sent.error ?? "", /no network/);
  // A frame's own answers: a script that ran out of time, or didn't parse, with its line in the script.
  assert.match(readResult({ timedOut: true }, 10).error ?? "", /longer than 5 seconds/);
  const { userLine } = workerSource("ok();\nbroken(;");
  const syntax = readResult({ failed: "Uncaught SyntaxError: Unexpected token ';'", line: userLine + 1 }, userLine);
  assert.equal(stoppedBecause(syntax), "It stopped at line 2: SyntaxError: Unexpected token ';'");
  assert.deepEqual(checksOf(syntax, "before").map((check) => [check.name, check.passed]), [["The script before sending", false]]);
});

test("whatever comes back is read safely", () => {
  assert.deepEqual(readResult(null, 1), { tests: [], logs: [], variables: {} });
  const odd = readResult({ tests: [{ name: 5, passed: "yes" }], logs: "no", variables: { "": "x", fine: 3, gone: null } }, 1);
  assert.deepEqual(odd.tests, [{ name: "5", passed: false }]);
  assert.deepEqual(odd.logs, []);
  assert.deepEqual(odd.variables, { fine: "3", gone: null });
});
