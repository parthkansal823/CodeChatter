// A room's connections for automations, the whole way: the room's own Postgres started, a connection to it saved by the owner (sealed by the API) and tried
// in the sandbox by the piece's own check, a flow's Postgres step using it on Activepieces' real engine; and its secret never coming back, not in the list,
// not in a run's details. Also: wrong details saying why, an editor able to use and test but not to change or see, a browser unable to hand a run
// connections of its own, and a removed connection saying so. It removes what it made, and stops the database if it started it.
//   node --env-file=../../.env test/automation-connections.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
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

/** A person signed in, with their own cookies. */
async function person(email) {
  const cookies = new Map();
  const call = async (path, { method = "GET", json } = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(120_000),
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
    return { status: response.status, body, text };
  };
  const signedIn = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (signedIn.status !== 200) throw new Error(`sign-in ${email}: ${signedIn.status}`);
  return call;
}
const owner = await person("test1@codechatter.local");
const editor = await person("test2@codechatter.local");
const automations = (who, body) => who(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
const connectionsUrl = `/api/rooms/${ROOM}/automations/connections`;

const runnerCall = async (method, path) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`, "content-type": "application/json" } });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const stamp = Date.now().toString(36);
const FOLDER = `connections-test-${stamp}`;
const GOOD = `room-db-${stamp}`;
const BAD = `bad-db-${stamp}`;
const made = [];
let startedPostgres = false;

async function finished(who, id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations(who, { op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details;
    await sleep(500);
  }
  return null;
}
async function runByHand(who, path, extra = {}) {
  const started = await automations(who, { op: "run", path, payload: {}, ...extra });
  return started.body?.id ? finished(who, started.body.id) : { body: { status: "NOT STARTED", error: started.body } };
}

try {
  // ---- The room's own Postgres ----
  let list = (await runnerCall("GET", "databases")).body ?? [];
  if (list.find((each) => each.kind === "postgres")?.state !== "running") {
    startedPostgres = true;
    await runnerCall("POST", "databases/postgres");
    for (let i = 0; i < 120 && list.find((each) => each.kind === "postgres")?.state !== "running"; i++) {
      await sleep(2000);
      list = (await runnerCall("GET", "databases")).body ?? [];
    }
  }
  const database = list.find((each) => each.kind === "postgres");
  check("theRoomsPostgresRuns", database?.state === "running" && database.connection?.password, database?.state);
  const { host, port, user, password, database: name } = database.connection;

  let manifest = await automations(owner, { op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations(owner, { op: "manifest" });
  }
  const postgres = manifest.body.pieces["@activepieces/piece-postgres"];
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  check("thePostgresPieceIsThere", postgres?.auth?.type === "CUSTOM_AUTH", postgres?.auth);

  // ---- Saving one, and trying it ----
  const props = (secret) => ({ host, port, user, password: secret, database: name, enable_ssl: false, reject_unauthorized: false });
  const shown = ["host", "port", "user", "password", "database", "enable_ssl", "reject_unauthorized"];
  const saved = await owner(`${connectionsUrl}?test=1`, { method: "PUT", json: { name: GOOD, piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: props(password) }, shown } });
  if (saved.status === 200) made.push(GOOD);
  check("anOwnerSavesAConnection", saved.status === 200 && saved.body.name === GOOD && saved.body.type === "CUSTOM_AUTH", saved.body);
  check("itsTriedAndWorks", saved.body?.lastTest?.valid === true, saved.body?.lastTest);
  check("itShowsWhatIsntSecret", saved.body?.shown?.host === host && saved.body.shown.user === user && saved.body.shown.password === undefined, saved.body?.shown);
  const bad = await owner(`${connectionsUrl}?test=1`, { method: "PUT", json: { name: BAD, piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: props("not-the-password") }, shown } });
  if (bad.status === 200) made.push(BAD);
  check("wrongDetailsSayWhy", bad.body?.lastTest?.valid === false && /password|authentication|refused/i.test(bad.body.lastTest.error ?? ""), bad.body?.lastTest);

  const listed = await owner(connectionsUrl);
  check("theyreListed", Array.isArray(listed.body) && listed.body.some((each) => each.name === GOOD) && listed.body.some((each) => each.name === BAD), listed.body);
  check("neverWithTheirSecrets", !listed.text.includes(password) && !listed.text.includes("not-the-password") && !saved.text.includes(password), "a secret came back");

  // ---- A flow's Postgres step, with it ----
  const flowOf = (id, connection) => ({
    id,
    displayName: "Ask the room's database",
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: "When called",
      valid: true,
      settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} },
      nextAction: {
        name: "ask",
        type: "PIECE",
        displayName: "Run a query",
        valid: true,
        skip: false,
        settings: { pieceName: "@activepieces/piece-postgres", pieceVersion: postgres.version, actionName: "run-query", input: { auth: `{{connections['${connection}']}}`, query: "select 40 + 2 as answer", args: [] }, propertySettings: {}, errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } } },
        nextAction: null,
      },
    },
  });
  const FLOW = `${FOLDER}/ask.flow.json`;
  const FAKE = `${FOLDER}/fake.flow.json`;
  createFileAtPath(doc, FLOW, JSON.stringify(flowOf(`flow_ask_${stamp}`, GOOD), null, 2));
  createFileAtPath(doc, FAKE, JSON.stringify(flowOf(`flow_fake_${stamp}`, "made-up"), null, 2));
  await sleep(1500);
  const ran = await runByHand(owner, FLOW);
  check("aStepUsesTheConnection", ran?.body?.status === "SUCCEEDED" && JSON.stringify(ran.body.steps?.ask?.output ?? "").includes("42"), ran?.body?.steps?.ask ?? ran?.body);
  check("andTheRunNeverShowsTheSecret", ran?.text && !ran.text.includes(password), "the password is in the run's details");

  // ---- An editor: uses and tries them, doesn't change them ----
  const editorList = await editor(connectionsUrl);
  check("anEditorSeesThem", editorList.status === 200 && editorList.body.some((each) => each.name === GOOD), editorList.status);
  const editorSave = await editor(connectionsUrl, { method: "PUT", json: { name: `editors-${stamp}`, piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: props(password) } } });
  check("butCantAddOne", editorSave.status === 403 && /owners/.test(editorSave.text), editorSave.body);
  const editorRemove = await editor(`${connectionsUrl}/${GOOD}`, { method: "DELETE" });
  check("orRemoveOne", editorRemove.status === 403, editorRemove.status);
  const editorTest = await editor(`${connectionsUrl}/${GOOD}/test`, { method: "POST" });
  check("andCanTryOne", editorTest.status === 200 && editorTest.body.lastTest?.valid === true, editorTest.body);
  const editorRun = await runByHand(editor, FLOW);
  check("andUseItInARun", editorRun?.body?.status === "SUCCEEDED", editorRun?.body?.status);

  // ---- A browser can't hand a run connections of its own ----
  const smuggled = await runByHand(editor, FAKE, { connections: { "made-up": { piece: "@activepieces/piece-postgres", value: { type: "CUSTOM_AUTH", props: props(password) } } } });
  check("aBrowsersConnectionsAreIgnored", smuggled?.body?.status === "FAILED" && /made-up/.test(JSON.stringify(smuggled.body)), smuggled?.body?.status);

  // ---- Removed, it says so ----
  const removed = await owner(`${connectionsUrl}/${GOOD}`, { method: "DELETE" });
  if (removed.status === 204) made.splice(made.indexOf(GOOD), 1);
  check("anOwnerRemovesOne", removed.status === 204, removed.status);
  const after = await runByHand(owner, FLOW);
  check("andAStepUsingItSaysItsGone", after?.body?.status === "FAILED" && JSON.stringify(after.body).includes(GOOD), after?.body?.status);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  for (const name of made) await owner(`${connectionsUrl}/${name}`, { method: "DELETE" }).catch(() => {});
  const left = await owner(connectionsUrl).catch(() => ({ body: [] }));
  check("itsConnectionsAreGone", Array.isArray(left.body) && !left.body.some((each) => each.name.endsWith(stamp)), left.body);
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
