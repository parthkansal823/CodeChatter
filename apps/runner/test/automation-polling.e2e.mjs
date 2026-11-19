// Automations started by a service's new items (pieces' polling triggers, as Activepieces' server runs them), the whole way: Postgres's "New Row" on the
// room's own database, through a connection, turned on (the rows already there don't count), then each row added after it starting a run of its own with
// that row, on the API's timer; turning it off stops it. Also: a trigger that isn't a polling one refused, and a flow whose file no longer starts on new
// items turning itself off. About two minutes, as polling counts in whole minutes. It removes what it made, and stops the database if it started it.
//   node --env-file=../../.env test/automation-polling.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, setFileText, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
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
async function call(path, { method = "GET", json } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(150_000),
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
const triggersUrl = `/api/rooms/${ROOM}/automations/triggers`;
const connectionsUrl = `/api/rooms/${ROOM}/automations/connections`;
const runnerCall = async (method, path, json) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`, "content-type": "application/json" }, ...(json && { body: JSON.stringify(json) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const sql = (query) => runnerCall("POST", "databases/postgres/query", { query });

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const stamp = Date.now().toString(36);
const FOLDER = `polling-test-${stamp}`;
const TABLE = `poll_${stamp}`;
const CONNECTION = `poll-db-${stamp}`;
const made = { triggers: [], connection: false };
let startedPostgres = false;

/** This flow's runs that its polling trigger started, oldest first, finished, with what its step gave. */
async function polledRuns(path) {
  const runs = (await automations({ op: "runs", path })).body.runs?.filter((run) => run.trigger === "poll") ?? [];
  const out = [];
  for (const run of runs.reverse()) {
    for (let i = 0; i < 60; i++) {
      const found = await automations({ op: "run-details", id: run.id });
      if (found.status === 200 && found.body.finishedAt) {
        out.push(found.body);
        break;
      }
      await sleep(500);
    }
  }
  return out;
}
async function waitForRuns(path, count, seconds = 150) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(3000)) {
    const runs = await polledRuns(path);
    if (runs.length >= count) return runs;
  }
  return polledRuns(path);
}

try {
  // ---- The room's Postgres, a table with a row already in it, and a connection to it. Rows are ordered by when they were made: the piece reads its
  // order column as a date when it can, so an integer id would be taken for one (a time in 1970). ----
  let list = (await runnerCall("GET", "databases")).body ?? [];
  if (list.find((each) => each.kind === "postgres")?.state !== "running") {
    startedPostgres = true;
    await runnerCall("POST", "databases/postgres");
    for (let i = 0; i < 120 && list.find((each) => each.kind === "postgres")?.state !== "running"; i++) {
      await sleep(2000);
      list = (await runnerCall("GET", "databases")).body ?? [];
    }
  }
  const { host, port, user, password, database } = list.find((each) => each.kind === "postgres").connection;
  const created = await sql(`create table ${TABLE} (id serial primary key, title text not null, created_at timestamptz not null default clock_timestamp()); insert into ${TABLE} (title) values ('there before');`);
  check("aTableWithARowAlready", created.status === 200, created.body);
  const saved = await call(`${connectionsUrl}?test=1`, { method: "PUT", json: { name: CONNECTION, piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: { host, port, user, password, database, enable_ssl: false, reject_unauthorized: false } } } });
  made.connection = saved.status === 200;
  check("aConnectionToIt", saved.body?.lastTest?.valid === true, saved.body);

  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const postgres = manifest.body.pieces["@activepieces/piece-postgres"];
  const flowOf = (id, trigger) => ({
    id,
    displayName: "New rows",
    schemaVersion: "27",
    trigger: {
      ...trigger,
      nextAction: {
        name: "seen",
        type: "CODE",
        displayName: "Seen",
        valid: true,
        skip: false,
        settings: { sourceCode: { code: "export const code = async (inputs) => ({ row: inputs.row });", packageJson: "{}" }, input: { row: "{{trigger.output}}" }, errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } } },
        nextAction: null,
      },
    },
  });
  const newRow = { name: "trigger", type: "PIECE_TRIGGER", displayName: "New Row", valid: true, settings: { pieceName: "@activepieces/piece-postgres", pieceVersion: postgres.version, triggerName: "new-row", input: { auth: `{{connections['${CONNECTION}']}}`, table: { table_schema: "public", table_name: TABLE }, order_by: "created_at", order_direction: "DESC" }, propertySettings: {} } };
  const FLOW = `${FOLDER}/new-rows.flow.json`;
  const FLOW_ID = `flow_rows_${stamp}`;
  createFileAtPath(doc, FLOW, JSON.stringify(flowOf(FLOW_ID, newRow), null, 2));
  await sleep(1500);

  // ---- What can't be turned on ----
  const tooOften = await call(triggersUrl, { method: "POST", json: { path: FLOW, flowId: FLOW_ID, kind: "poll", poll: { everyMinutes: 0 } } });
  check("lessThanAMinuteIsRefused", tooOften.status === 400, tooOften.body);

  // ---- Turned on: what's there already doesn't count ----
  const on = await call(triggersUrl, { method: "POST", json: { path: FLOW, flowId: FLOW_ID, kind: "poll", poll: { everyMinutes: 1 } } });
  if (on.body?.id) made.triggers.push(on.body.id);
  check("itTurnsOn", (on.status === 201 || on.status === 200) && on.body.kind === "poll" && on.body.poll?.everyMinutes === 1 && on.body.enabled, on.body);
  check("andSaysWhenItNextLooks", typeof on.body?.nextRunAt === "number" && on.body.nextRunAt > Date.now(), on.body?.nextRunAt);

  // ---- Rows added after it: each a run of its own, with its row ----
  await sql(`insert into ${TABLE} (title) values ('first new'), ('second new');`);
  const runs = await waitForRuns(FLOW, 2);
  const titles = runs.map((run) => run.steps?.seen?.output?.row?.title).sort();
  check("eachNewRowStartsARun", runs.length === 2 && runs.every((run) => run.status === "SUCCEEDED"), runs.map((run) => [run.status, run.message]));
  check("withItsRow", JSON.stringify(titles) === JSON.stringify(["first new", "second new"]), titles);
  check("andNotTheOneFromBefore", !titles.includes("there before"), titles);
  check("byItsTrigger", runs.every((run) => run.trigger === "poll"), runs.map((run) => run.trigger));
  const listed = (await call(triggersUrl)).body.find((each) => each.id === on.body?.id);
  check("itSaysWhenItLastLooked", listed?.lastRunAt && listed.lastRunAt > Date.now() - 5 * 60_000, listed);

  // ---- Turned off: rows added after don't run ----
  const off = await call(`${triggersUrl}/${on.body.id}`, { method: "PATCH", json: { enabled: false } });
  check("itTurnsOff", off.status === 200 && off.body.enabled === false, off.body);
  await sql(`insert into ${TABLE} (title) values ('while off');`);
  await sleep(80_000);
  check("andRowsAddedThenDontRun", (await polledRuns(FLOW)).length === 2, (await polledRuns(FLOW)).length);

  // ---- The file no longer starting on new rows: it turns itself off ----
  const on2 = await call(`${triggersUrl}/${on.body.id}`, { method: "PATCH", json: { enabled: true } });
  check("itTurnsOnAgain", on2.body?.enabled === true, on2.body);
  setFileText(doc, findByPath(doc, FLOW).id, JSON.stringify(flowOf(FLOW_ID, { name: "trigger", type: "PIECE_TRIGGER", displayName: "When called", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: manifest.body.pieces["@activepieces/piece-webhook"].version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} } }), null, 2));
  let stopped = null;
  for (const until = Date.now() + 100_000; Date.now() < until && !stopped; await sleep(3000)) {
    const now = (await call(triggersUrl)).body.find((each) => each.id === on.body.id);
    if (now && !now.enabled) stopped = now;
  }
  check("aFlowNoLongerOnNewItemsTurnsItselfOff", stopped && /new items any more/.test(stopped.problem ?? ""), stopped);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  for (const id of made.triggers) {
    const removed = await call(`${triggersUrl}/${id}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
  }
  if (made.connection) await call(`${connectionsUrl}/${CONNECTION}`, { method: "DELETE" }).catch(() => {});
  await sql(`drop table if exists ${TABLE};`).catch(() => {});
  if (startedPostgres) await runnerCall("POST", "databases/postgres/stop").catch(() => {});
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  collab.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
