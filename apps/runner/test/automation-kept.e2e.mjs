// A flow's timezone, and which of its runs are kept, the whole way, in E2ETST's sandbox by Activepieces' real engine: a code step seeing the flow's own
// time (and UTC without one, or with a name that isn't a timezone); runs its trigger started that its settings don't keep, still read by their id (and by
// a flow that called one) but not listed, counted in Insights, and gone a minute after; runs by hand always kept. It removes what it made. About two minutes.
//   node --env-file=../../.env test/automation-kept.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cookies = new Map();
async function call(path, json) {
  const response = await fetch(`${BASE}${path}`, {
    method: json === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(90_000),
    headers: { origin: BASE, ...(json !== undefined && { "content-type": "application/json" }), cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}
const signedIn = await call("/api/auth/sign-in/email", { email: "test1@codechatter.local", password: "codechatter123" });
if (signedIn.status !== 200) throw new Error(`sign-in: ${signedIn.status}`);
const automations = (body) => call(`/api/rooms/${ROOM}/automations`, body);

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const stamp = Date.now().toString(36);
const FOLDER = `kept-${stamp}`;

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function start(path, extra = {}) {
  const started = await automations({ op: "run", path, payload: {}, ...extra });
  return started.body?.id ? finished(started.body.id) : { status: "NOT STARTED", error: started.body };
}
const listed = async (path) => ((await automations({ op: "runs", ...(path && { path }) })).body?.runs ?? []).map((run) => run.id);
const lastOutput = (run) => Object.values(run?.steps ?? {}).at(-1)?.output;

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source, input = {}, next = null) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const callStep = (name, flow, next = null) => ({ name, type: "CODE", displayName: "Call a flow", valid: true, skip: false, builtin: "call_flow", settings: { sourceCode: { code: "export const code = async () => null;", packageJson: "{}" }, input: { flow, data: {}, wait: true }, errorHandlingOptions: handling }, nextAction: next });
  const trigger = (room, next) => ({
    name: "trigger",
    type: "PIECE_TRIGGER",
    displayName: "When",
    valid: true,
    settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, ...(room && { room }) },
    nextAction: next,
  });
  const write = (key, first, settings, room = null) => {
    const path = `${FOLDER}/${key}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify({ id: `flow_${key}_${stamp}`, displayName: `${key} ${stamp}`, schemaVersion: "27", ...(settings && { settings }), trigger: trigger(room, first) }, null, 2));
    return path;
  };
  const CLOCK = "export const code = async () => ({ offset: new Date().getTimezoneOffset(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone });\n";
  const ZONED = write("zoned", code("clock", CLOCK), { timezone: "Asia/Kolkata" });
  const PLAIN = write("plain", code("clock", CLOCK));
  const ODD = write("odd", code("clock", CLOCK), { timezone: "Mars/Olympus" });
  const FORGOTTEN = write("forgotten", code("ok", "export const code = async () => ({ ok: true });\n"), { saveSucceeded: false });
  const FAILING = write("failing", code("boom", "export const code = async () => { throw new Error('No stock left'); };\n"), { saveFailed: false });
  write("called", code("answer", "export const code = async () => ({ answer: 42 });\n"), { saveSucceeded: false }, { event: "flow.called" });
  const FEW = write("few", code("ok", "export const code = async () => ({ ok: true });\n"), { keepRuns: 2 });
  const CALLER = write("caller", callStep("call", `flow_called_${stamp}`, code("after", "export const code = async (inputs) => ({ got: inputs.got });\n", { got: "{{call.output.answer}}" })));
  await sleep(2000);

  // ---- Its timezone ----
  const zoned = lastOutput(await start(ZONED));
  check("a flow's steps see its own timezone", zoned?.offset === -330 && /^Asia\/(Kolkata|Calcutta)$/.test(zoned?.zone ?? ""), zoned);
  const plain = lastOutput(await start(PLAIN));
  check("and UTC without one", plain?.offset === 0, plain);
  const odd = await start(ODD);
  check("a name that isn't a timezone leaves the run in UTC", odd?.status === "SUCCEEDED" && lastOutput(odd)?.offset === 0, { status: odd?.status, output: lastOutput(odd) });

  // ---- Which runs are kept ----
  const byHand = await start(FORGOTTEN);
  const byTrigger = await start(FORGOTTEN, { trigger: "webhook" });
  check("two runs, by hand and by its trigger", byHand?.status === "SUCCEEDED" && byTrigger?.status === "SUCCEEDED", { byHand: byHand?.status, byTrigger: byTrigger?.status });
  check("a run its trigger started that its flow doesn't keep is still read by its id", byTrigger?.kept === false && lastOutput(byTrigger)?.ok === true, byTrigger);
  const forgottenRuns = await listed(FORGOTTEN);
  check("but isn't listed, while the run by hand is", forgottenRuns.includes(byHand?.id) && !forgottenRuns.includes(byTrigger?.id), forgottenRuns);
  check("nor among every run", !(await listed()).includes(byTrigger?.id));
  const failedByTrigger = await start(FAILING, { trigger: "webhook" });
  const failedByHand = await start(FAILING);
  const failingRuns = await listed(FAILING);
  check("a failed run not kept, and a failed run by hand kept", failedByTrigger?.status === "FAILED" && failedByHand?.status === "FAILED" && !failingRuns.includes(failedByTrigger?.id) && failingRuns.includes(failedByHand?.id), { failingRuns, byTrigger: failedByTrigger?.status });
  const caller = await start(CALLER);
  check("a flow that calls one not kept still gets its answer", caller?.status === "SUCCEEDED" && lastOutput(caller)?.got === 42, { status: caller?.status, output: lastOutput(caller), message: caller?.message });
  const insights = await automations({ op: "insights", days: 7 });
  const counted = (insights.body?.flows ?? []).find((flow) => flow.name === `forgotten ${stamp}`);
  check("runs not kept still count in Insights", counted?.runs === 2, counted);

  // ---- How many runs each flow keeps: its own number, without pushing out another flow's ----
  const plainBefore = await listed(PLAIN);
  const few = [];
  for (let i = 0; i < 3; i++) few.push(await start(FEW));
  const fewRuns = await listed(FEW);
  check("a flow keeps as many runs as its settings say, the newest", few.every((run) => run?.status === "SUCCEEDED") && fewRuns.length === 2 && fewRuns[0] === few[2]?.id && fewRuns[1] === few[1]?.id, { fewRuns, made: few.map((run) => run?.id) });
  const oldest = await automations({ op: "run-details", id: few[0]?.id });
  check("and the oldest has gone", oldest.status !== 200 && /isn't kept/.test(JSON.stringify(oldest.body)), oldest.status);
  const plainAfter = await listed(PLAIN);
  check("while another flow keeps its own", plainBefore.length > 0 && plainBefore.every((id) => plainAfter.includes(id)), { plainBefore, plainAfter });

  // ---- A minute later, they've gone ----
  await sleep(62_000);
  await start(PLAIN);
  const gone = await automations({ op: "run-details", id: byTrigger?.id });
  check("a minute after it ends, a run not kept has gone", gone.status !== 200 && /isn't kept/.test(JSON.stringify(gone.body)), gone);
  const stillThere = await automations({ op: "run-details", id: byHand?.id });
  check("and the run by hand is still kept", stillThere.status === 200 && stillThere.body?.id === byHand?.id, stillThere.status);
} catch (error) {
  check("no crash", false, error.stack ?? error.message);
} finally {
  const folder = findByPath(doc, FOLDER);
  if (folder) trash(doc, folder.id);
  // Its service token lasts a minute, so after the wait the connection may be coming back: the removal has to reach collab before it closes.
  for (let i = 0; i < 60 && (provider.hasUnsyncedChanges || !provider.isSynced); i++) await sleep(250);
  await sleep(500);
  check("what it made is gone", !provider.hasUnsyncedChanges && !findByPath(doc, FOLDER));
  provider.destroy();
  collab.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
