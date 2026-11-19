// A run's notes (n8n's annotations), the whole way, in E2ETST's sandbox by Activepieces' real engine: good or bad, tags (once, whatever their case) and a
// note kept with a run and listed with it, what isn't allowed, a run that's still going refused until it ends, and taking them off. It removes what it made.
//   node --env-file=../../.env test/automation-notes.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const FOLDER = `notes-${stamp}`;

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
const annotate = (id, notes) => automations({ op: "annotate", id, ...notes });

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input: {}, errorHandlingOptions: handling }, nextAction: null });
  const write = (key, first) => {
    const path = `${FOLDER}/${key}.flow.json`;
    const trigger = { name: "trigger", type: "PIECE_TRIGGER", displayName: "When", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first };
    createFileAtPath(doc, path, JSON.stringify({ id: `flow_${key}_${stamp}`, displayName: `${key} ${stamp}`, schemaVersion: "27", trigger }, null, 2));
    return path;
  };
  const QUICK = write("quick", code("ok", "export const code = async () => ({ ok: true });\n"));
  const SLOW = write("slow", code("wait", "export const code = async () => { await new Promise((resolve) => setTimeout(resolve, 6000)); return { done: true }; };\n"));
  await sleep(2000);

  const started = await automations({ op: "run", path: QUICK, payload: {} });
  const run = await finished(started.body?.id);
  check("a run to put notes on", run?.status === "SUCCEEDED", run?.status);

  // ---- Good or bad, tags and a note ----
  const saved = await annotate(run.id, { vote: "good", tags: ["release", "Release", " flaky ", "v2.1/rc"], note: "  Looked fine on staging.  " });
  check("a run's notes are kept: tags once whatever their case, and trimmed", saved.status === 200 && saved.body?.annotation?.vote === "good" && JSON.stringify(saved.body.annotation.tags) === JSON.stringify(["release", "flaky", "v2.1/rc"]) && saved.body.annotation.note === "Looked fine on staging.", saved.body);
  const details = await automations({ op: "run-details", id: run.id });
  check("they're with the run", details.body?.annotation?.vote === "good" && details.body.annotation.tags?.length === 3, details.body?.annotation);
  const listed = ((await automations({ op: "runs", path: QUICK })).body?.runs ?? []).find((each) => each.id === run.id);
  check("and in its flow's runs", listed?.annotation?.note === "Looked fine on staging.", listed?.annotation);
  const everywhere = ((await automations({ op: "runs" })).body?.runs ?? []).find((each) => each.id === run.id);
  check("and among every run", everywhere?.annotation?.tags?.includes("flaky"), everywhere?.annotation);

  // ---- What isn't allowed ----
  const tooMany = await annotate(run.id, { tags: Array.from({ length: 11 }, (_, at) => `tag${at}`) });
  check("at most 10 tags", tooMany.status === 400 && /up to 10 tags/.test(JSON.stringify(tooMany.body)), tooMany);
  const odd = await annotate(run.id, { tags: ["<b>bold</b>"] });
  check("a tag is words, not markup", odd.status === 400, odd);
  const long = await annotate(run.id, { note: "x".repeat(501) });
  check("a note is up to 500 characters", long.status === 400, long);
  const meh = await annotate(run.id, { vote: "meh" });
  check("a run is good or bad, or neither", meh.status === 400, meh);
  const none = await annotate("20990101-000000-nothing", { vote: "bad" });
  check("a run that isn't there says so", none.status !== 200 && /isn't kept/.test(JSON.stringify(none.body)), none);
  const unchanged = await automations({ op: "run-details", id: run.id });
  check("and nothing refused changed the notes", unchanged.body?.annotation?.vote === "good" && unchanged.body.annotation.tags?.length === 3, unchanged.body?.annotation);

  // ---- While it runs, and taking them off ----
  const going = await automations({ op: "run", path: SLOW, payload: {} });
  await sleep(1500);
  const early = await annotate(going.body?.id, { vote: "bad" });
  check("a run has notes once it has ended", early.status !== 200 && /once it has ended/.test(JSON.stringify(early.body)), early);
  const slow = await finished(going.body?.id);
  const later = await annotate(slow?.id, { vote: "bad", tags: ["slow"] });
  check("and then it can", later.status === 200 && later.body?.annotation?.vote === "bad", later.body);
  const cleared = await annotate(run.id, { vote: null, tags: [], note: "" });
  const after = await automations({ op: "run-details", id: run.id });
  check("taking everything off leaves no notes", cleared.status === 200 && cleared.body?.annotation === null && after.body?.annotation == null, { cleared: cleared.body, after: after.body?.annotation });
} catch (error) {
  check("no crash", false, error.stack ?? error.message);
} finally {
  const folder = findByPath(doc, FOLDER);
  if (folder) trash(doc, folder.id);
  for (let i = 0; i < 60 && (provider.hasUnsyncedChanges || !provider.isSynced); i++) await sleep(250);
  await sleep(500);
  check("what it made is gone", !provider.hasUnsyncedChanges && !findByPath(doc, FOLDER));
  provider.destroy();
  collab.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
