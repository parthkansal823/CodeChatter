// A flow's error flow, as n8n's error workflow, the whole way in E2ETST's sandbox with Activepieces' engine: a run that fails starts the flow named under
// "If it fails, run", which gets the run, its error and the flow; a step tried alone doesn't; an error flow that fails doesn't start another; one that isn't
// there says so on the failed run. It removes what it made.
//   node --env-file=../../.env test/automation-error-flow.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const FOLDER = `error-flow-test-${stamp}`;

async function finished(id) {
  for (let i = 0; i < 120; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
const runsOf = async (path) => (await automations({ op: "runs", path })).body.runs ?? [];
async function waitForRuns(path, count, seconds = 60) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(1000)) {
    const runs = await runsOf(path);
    if (runs.length >= count && runs.every((run) => run.finishedAt)) return runs;
  }
  return runsOf(path);
}

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const code = (name, source, input) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } } }, nextAction: null });
  const trigger = (room, next) => ({
    name: "trigger",
    type: "PIECE_TRIGGER",
    displayName: "When",
    valid: true,
    settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, ...(room && { room }) },
    nextAction: next,
  });
  const ids = { failing: `flow_failing_${stamp}`, handler: `flow_handler_${stamp}`, broken: `flow_broken_${stamp}`, leads: `flow_leads_${stamp}`, lost: `flow_lost_${stamp}` };
  const paths = Object.fromEntries(Object.keys(ids).map((key) => [key, `${FOLDER}/${key}.flow.json`]));
  const boom = "export const code = async () => { throw new Error('The orders API said 500'); };";
  // Fails at its second step, and names the handler as its error flow.
  createFileAtPath(doc, paths.failing, JSON.stringify({ id: ids.failing, displayName: "Sync the orders", schemaVersion: "27", errorFlow: ids.handler, trigger: trigger(null, { ...code("prepare", "export const code = async () => ({ ok: true });", {}), nextAction: code("fetch", boom, {}) }) }, null, 2));
  // The error flow: says what it was given.
  createFileAtPath(doc, paths.handler, JSON.stringify({ id: ids.handler, displayName: "Tell someone", schemaVersion: "27", trigger: trigger({ event: "flow.failed" }, code("tell", "export const code = async (inputs) => inputs;", { execution: "{{trigger.output.execution}}", workflow: "{{trigger.output.workflow}}" })) }, null, 2));
  // An error flow that fails itself, and names the handler too: that mustn't start it again.
  createFileAtPath(doc, paths.broken, JSON.stringify({ id: ids.broken, displayName: "Broken handler", schemaVersion: "27", errorFlow: ids.handler, trigger: trigger({ event: "flow.failed" }, code("oops", boom, {})) }, null, 2));
  createFileAtPath(doc, paths.leads, JSON.stringify({ id: ids.leads, displayName: "Leads to the broken one", schemaVersion: "27", errorFlow: ids.broken, trigger: trigger(null, code("fails", boom, {})) }, null, 2));
  // Names an error flow that isn't in the room.
  createFileAtPath(doc, paths.lost, JSON.stringify({ id: ids.lost, displayName: "Its handler is gone", schemaVersion: "27", errorFlow: "flow_not_here", trigger: trigger(null, code("fails", boom, {})) }, null, 2));
  await sleep(1500);

  // ---- A run that fails starts its error flow ----
  const started = await automations({ op: "run", path: paths.failing, payload: { orders: 3 } });
  check("theFlowRuns", started.status === 200 && typeof started.body.id === "string", started);
  const failed = await finished(started.body.id);
  check("andFails", failed?.status === "FAILED", failed?.status);
  check("itsErrorFlowRan", typeof failed?.errorRun === "string" && !failed.errorProblem, { errorRun: failed?.errorRun, problem: failed?.errorProblem });
  const handled = failed?.errorRun ? await finished(failed.errorRun) : null;
  const told = handled?.steps?.tell?.output;
  check("theErrorFlowSucceeds", handled?.status === "SUCCEEDED" && handled.trigger === "error" && handled.path === paths.handler, handled ?? "no run");
  check("itSaysWhichFlowFailed", handled?.by === "Sync the orders failed" && told?.workflow?.id === ids.failing && told.workflow.name === "Sync the orders" && told.workflow.path === paths.failing, { by: handled?.by, workflow: told?.workflow });
  check("andHowAsN8nDoes", told?.execution?.id === started.body.id && /The orders API said 500/.test(told.execution.error?.message ?? "") && told.execution.lastNodeExecuted === "fetch" && told.execution.mode === "manual", told?.execution);
  const listed = (await runsOf(paths.failing)).find((run) => run.id === started.body.id);
  check("theFailedRunSaysSo", listed?.errorRun === failed?.errorRun, listed);

  // ---- A step tried alone doesn't ----
  const handlerRuns = (await runsOf(paths.handler)).length;
  const alone = await automations({ op: "run", path: paths.failing, mode: "step", step: "fetch", sampleData: { trigger: { body: {} }, prepare: { ok: true } } });
  const aloneRun = await finished(alone.body?.id);
  await sleep(3000);
  check("aStepTriedAloneDoesnt", aloneRun?.status === "FAILED" && !aloneRun.errorRun && (await runsOf(paths.handler)).length === handlerRuns, { status: aloneRun?.status, errorRun: aloneRun?.errorRun });

  // ---- An error flow failing doesn't start another ----
  const leads = await automations({ op: "run", path: paths.leads, payload: {} });
  const leadsRun = await finished(leads.body?.id);
  const brokenRun = leadsRun?.errorRun ? await finished(leadsRun.errorRun) : null;
  await sleep(4000);
  check("anErrorFlowThatFailsDoesntStartAnother", brokenRun?.status === "FAILED" && brokenRun.trigger === "error" && !brokenRun.errorRun && (await runsOf(paths.handler)).length === handlerRuns, { broken: brokenRun?.status, errorRun: brokenRun?.errorRun, handler: (await runsOf(paths.handler)).length });

  // ---- One that isn't there says so ----
  const lost = await automations({ op: "run", path: paths.lost, payload: {} });
  const lostRun = await finished(lost.body?.id);
  check("aMissingErrorFlowSaysSo", lostRun?.status === "FAILED" && !lostRun.errorRun && /isn't in the room/.test(lostRun.errorProblem ?? ""), { errorRun: lostRun?.errorRun, problem: lostRun?.errorProblem });

  // ---- And it can't be turned on like a room event ----
  const turnOn = await call(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: paths.handler, flowId: ids.handler, kind: "event", event: { event: "flow.failed" } } });
  check("anErrorFlowIsntTurnedOn", turnOn.status === 400 && /If it fails, run/.test(JSON.stringify(turnOn.body)), turnOn);
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
