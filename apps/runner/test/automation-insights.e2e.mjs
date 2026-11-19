// A flow's settings and Insights, the whole way, in E2ETST's sandbox by Activepieces' real engine: a flow's own time limit stopping a run that takes too
// long, and the daily tally behind Insights counting runs, failures, runs by hand, and the time saved only for a run started by its trigger. It removes
// what it made (the tally itself stays, as it does for every run).
//   node --env-file=../../.env test/automation-insights.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const FOLDER = `insights-${stamp}`;

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

try {
  const manifest = await automations({ op: "manifest" });
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input: {}, errorHandlingOptions: handling }, nextAction: null });
  const flowOf = (name, first, settings) => ({
    id: `flow_${name}_${stamp}`,
    displayName: `${name} ${stamp}`,
    schemaVersion: "27",
    settings,
    trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: name, valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first },
  });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };
  const SLOW = write("slow", flowOf("Slow", code("wait", "export const code = async () => { await new Promise((resolve) => setTimeout(resolve, 20000)); return { done: true }; };\n"), { timeoutSeconds: 5 }));
  const QUICK = write("quick", flowOf("Quick", code("ok", "export const code = async () => ({ ok: true });\n"), { timeSavedMinutes: 10 }));
  await sleep(2000);

  // ---- A flow's own time limit ----
  const slow = await start(SLOW);
  check("a flow's own time limit stops a run that takes too long", slow?.status === "TIMEOUT" && slow.durationMs < 15_000 && /5 seconds/.test(slow.message ?? ""), { status: slow?.status, ms: slow?.durationMs, message: slow?.message });

  // ---- Insights: by hand, and started by the trigger ----
  const byHand = await start(QUICK);
  const byTrigger = await start(QUICK, { trigger: "webhook" });
  check("two runs of the quick flow, by hand and by its trigger", byHand?.status === "SUCCEEDED" && byTrigger?.status === "SUCCEEDED", { byHand: byHand?.status, byTrigger: byTrigger?.status });
  const insights = await automations({ op: "insights", days: 7 });
  const flows = insights.body?.flows ?? [];
  const slowOne = flows.find((flow) => flow.name === `Slow ${stamp}`);
  const quickOne = flows.find((flow) => flow.name === `Quick ${stamp}`);
  check("Insights count each flow's runs and failures", slowOne?.runs === 1 && slowOne?.failed === 1 && slowOne?.failureRate === 1 && quickOne?.runs === 2 && quickOne?.failed === 0, { slowOne, quickOne });
  check("runs by hand are counted as such", quickOne?.byHand === 1, quickOne);
  check("time is saved only by a run its trigger started that succeeded", quickOne?.savedMinutes === 10 && slowOne?.savedMinutes === 0, quickOne);
  check("and a run's average length", quickOne?.averageMs > 0 && slowOne?.averageMs >= 4000, { quick: quickOne?.averageMs, slow: slowOne?.averageMs });
  const today = new Date().toISOString().slice(0, 10);
  const day = (insights.body?.perDay ?? []).find((each) => each.day === today);
  check("today is among the days, with these runs in it", insights.body?.perDay?.length === 7 && day?.runs >= 3 && day?.failed >= 1, { days: insights.body?.perDay?.length, day });
  const odd = await automations({ op: "insights", days: 5 });
  check("only 7, 30 or 90 days", odd.status === 400 || odd.body?.days === 7, odd);
} catch (error) {
  check("no crash", false, error.stack ?? error.message);
} finally {
  const folder = findByPath(doc, FOLDER);
  if (folder) trash(doc, folder.id);
  await sleep(1000);
  provider.destroy();
  collab.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
