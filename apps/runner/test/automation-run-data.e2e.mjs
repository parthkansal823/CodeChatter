// Save run data (n8n's Execution Data), the whole way, in E2ETST's sandbox by Activepieces' real engine: what a run keeps to be found by, from what it was
// sent, kept with the run and listed with it among every flow's runs; a later step adding to it; a value too long or more than ten failing the step. It
// removes what it made.
//   node --env-file=../../.env test/automation-run-data.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const FOLDER = `run-data-${stamp}`;

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function runByHand(path, payload) {
  const started = await automations({ op: "run", path, payload });
  return started.body?.id ? finished(started.body.id) : { status: "NOT STARTED", error: started.body };
}

try {
  const manifest = await automations({ op: "manifest" });
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const builtin = (name, kind, input, next = null) => ({ name, type: "CODE", builtin: kind, displayName: name, valid: true, skip: false, settings: { sourceCode: { code: "// built in\n", packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const flowOf = (name, first) => ({
    id: `flow_${name}_${stamp}`,
    displayName: `Orders ${name} ${stamp}`,
    schemaVersion: "27",
    trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: "An order", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first },
  });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };
  const KEEPS = write("keeps", flowOf("keeps", builtin("keep", "run_data", { data: { order: "{{trigger.output.body.order}}", customer: "{{trigger.output.body.customer}}" } }, builtin("later", "run_data", { data: { status: "paid" } }))));
  const TOO_MANY = write("many", flowOf("many", builtin("keep", "run_data", { data: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`k${index}`, "v"])) })));
  const TOO_LONG = write("long", flowOf("long", builtin("keep", "run_data", { data: { note: "x".repeat(600) } })));
  await sleep(2000);

  const kept = await runByHand(KEEPS, { order: `A-${stamp}`, customer: { id: 7 } });
  check("a run keeps what it's told to, from what it was sent", kept?.status === "SUCCEEDED" && kept?.data?.order === `A-${stamp}` && kept?.data?.customer === '{"id":7}', kept?.data ?? kept);
  check("and a later step adds to it", kept?.data?.status === "paid" && kept?.steps?.later?.output?.saved?.order === `A-${stamp}`, { data: kept?.data, later: kept?.steps?.later?.output });
  const all = await automations({ op: "runs" });
  const listed = (all.body?.runs ?? []).find((run) => run.id === kept?.id);
  check("it's listed with the run, among every flow's runs", listed?.data?.order === `A-${stamp}` && listed?.name === `Orders keeps ${stamp}`, listed);
  const many = await runByHand(TOO_MANY, {});
  check("more than ten fails the step, saying so", many?.status === "FAILED" && /up to 10/.test(JSON.stringify(many?.failedStep ?? many?.message)), many?.failedStep ?? many);
  const long = await runByHand(TOO_LONG, {});
  check("a value too long fails the step, saying so", long?.status === "FAILED" && /over 512 characters/.test(JSON.stringify(long?.failedStep ?? long?.message)), long?.failedStep ?? long);
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
