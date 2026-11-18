// Sub-flows, as n8n's Execute Workflow, the whole way in E2ETST's sandbox with Activepieces' engine: a flow's "Call a flow" step runs another, one that
// starts on "Called by another flow", with what it sends, and gets what its last step gave; the called flow's run is its own, saying who called it; not
// waiting, it's queued; a flow that can't be called, one that fails, and a flow calling itself are each stopped with why. It removes what it made.
//   node --env-file=../../.env test/automation-subflows.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const ROOM = "E2ETST";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 400)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cookies = new Map();
async function call(path, { method = "GET", json } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(90_000),
    headers: { origin: BASE, ...(json !== undefined && { "content-type": "application/json" }), ...(cookies.size && { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: response.status, body };
}
const signedIn = await call("/api/auth/sign-in/email", { method: "POST", json: { email: "test1@codechatter.local", password: "codechatter123" } });
if (signedIn.status !== 200) throw new Error(`sign-in: ${signedIn.status}`);
const automations = (body) => call(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const FOLDER = `subflows-test-${stamp}`;

async function finished(id) {
  for (let i = 0; i < 180; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
const runsOf = async (path) => (await automations({ op: "runs", path })).body.runs ?? [];
async function run(path, payload = {}) {
  const started = await automations({ op: "run", path, payload });
  return started.body?.id ? finished(started.body.id) : null;
}

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source, input = {}, next = null) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const callStep = (name, flow, data, wait = true, next = null) => ({ name, type: "CODE", displayName: "Call a flow", valid: true, skip: false, builtin: "call_flow", settings: { sourceCode: { code: "export const code = async () => null;", packageJson: "{}" }, input: { flow, data, wait }, errorHandlingOptions: handling }, nextAction: next });
  const trigger = (room, next) => ({
    name: "trigger",
    type: "PIECE_TRIGGER",
    displayName: "When",
    valid: true,
    settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, ...(room && { room }) },
    nextAction: next,
  });
  const ids = { doubler: `flow_doubler_${stamp}`, caller: `flow_caller_${stamp}`, later: `flow_later_${stamp}`, plain: `flow_plain_${stamp}`, callsPlain: `flow_callsplain_${stamp}`, failing: `flow_failing_${stamp}`, callsFailing: `flow_callsfailing_${stamp}`, self: `flow_self_${stamp}` };
  const paths = Object.fromEntries(Object.keys(ids).map((key) => [key, `${FOLDER}/${key}.flow.json`]));
  const write = (key, name, trig) => createFileAtPath(doc, paths[key], JSON.stringify({ id: ids[key], displayName: name, schemaVersion: "27", trigger: trig }, null, 2));
  // Called: doubles what it's sent, in two steps, so the last one's output is what goes back.
  write("doubler", "Doubler", trigger({ event: "flow.called" }, code("read", "export const code = async (inputs) => ({ n: Number(inputs.n) });", { n: "{{trigger.output.n}}" }, code("double", "export const code = async (inputs) => ({ doubled: inputs.n * 2 });", { n: "{{read.output.n}}" }))));
  // Calls it with what it was sent, then uses the answer.
  write("caller", "Caller", trigger(null, callStep("call", ids.doubler, { n: "{{trigger.output.body.n}}" }, true, code("after", "export const code = async (inputs) => ({ got: inputs.got });", { got: "{{call.output.doubled}}" }))));
  write("later", "Later", trigger(null, callStep("call", ids.doubler, { n: 5 }, false)));
  write("plain", "Not callable", trigger(null, code("hi", "export const code = async () => 'hi';")));
  write("callsPlain", "Calls one that can't be", trigger(null, callStep("call", ids.plain, {})));
  write("failing", "Fails when called", trigger({ event: "flow.called" }, code("boom", "export const code = async () => { throw new Error('No stock left'); };")));
  write("callsFailing", "Calls one that fails", trigger(null, callStep("call", ids.failing, {})));
  write("self", "Calls itself", trigger({ event: "flow.called" }, callStep("again", ids.self, {})));
  await sleep(1500);

  // ---- Calling and waiting: the last step's output comes back ----
  const caller = await run(paths.caller, { n: 21 });
  check("aFlowCallsAnother", caller?.status === "SUCCEEDED", caller?.status + " " + (caller?.message ?? ""));
  check("andGetsWhatItsLastStepGave", JSON.stringify(caller?.steps?.call?.output) === JSON.stringify({ doubled: 42 }) && caller?.steps?.after?.output?.got === 42, caller?.steps);
  const doublerRuns = await runsOf(paths.doubler);
  const called = doublerRuns[0] ? await finished(doublerRuns[0].id) : null;
  check("theCalledFlowsRunIsItsOwn", called?.status === "SUCCEEDED" && called.trigger === "flow" && called.by === "Called by Caller" && called.steps?.read?.output?.n === 21, called ?? "no run");
  const live = (await automations({ op: "status" })).body;
  check("theLiveViewStayedTheCallers", live.id !== called?.id, live.id);

  // ---- Not waiting: queued, and runs after ----
  const later = await run(paths.later);
  check("notWaitingGivesItsRunsId", later?.status === "SUCCEEDED" && later.steps?.call?.output?.queued === true && typeof later.steps.call.output.runId === "string", later?.steps?.call?.output);
  const queued = later?.steps?.call?.output?.runId ? await finished(later.steps.call.output.runId) : null;
  check("andItRunsAfter", queued?.status === "SUCCEEDED" && queued.steps?.double?.output?.doubled === 10 && queued.by === "Called by Later", queued ?? "no run");

  // ---- What's stopped, and why ----
  const plain = await run(paths.callsPlain);
  check("aFlowThatCantBeCalledIsnt", plain?.status === "FAILED" && /can't be called: its trigger isn't "Called by another flow"/.test(plain.failedStep?.message ?? plain.message ?? ""), plain?.failedStep ?? plain?.message);
  check("andDidntRun", (await runsOf(paths.plain)).length === 0);
  const failing = await run(paths.callsFailing);
  check("aCalledFlowFailingFailsTheStep", failing?.status === "FAILED" && /Fails when called failed: .*No stock left/.test(failing.failedStep?.message ?? failing.message ?? ""), failing?.failedStep ?? failing?.message);
  const self = await run(paths.self);
  check("aFlowCallingItselfStopsAtTheDepth", self?.status === "FAILED" && /more than 5 deep/.test(JSON.stringify(self)), self?.failedStep ?? self?.message);
  check("withARunForEachLevel", (await runsOf(paths.self)).length === 6, (await runsOf(paths.self)).length);

  // ---- And it can't be turned on like a room event ----
  const turnOn = await call(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: paths.doubler, flowId: ids.doubler, kind: "event", event: { event: "flow.called" } } });
  check("aCalledFlowIsntTurnedOn", turnOn.status === 400 && /Call a flow/.test(JSON.stringify(turnOn.body)), turnOn);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
