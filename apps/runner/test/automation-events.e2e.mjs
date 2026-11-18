// Automations started by what happens in their room, the whole way: a person's edits through collab (as a browser makes them) seen by collab, queued in
// Valkey, run by the API in E2ETST's sandbox by Activepieces' engine; and the room's settings changing, from the audit log. Also: only the files it listens
// for, the sandbox's own changes not counting, a flow listening for another event now turning itself off, and settings that can't be used. It turns off and
// removes what it made.
//   node --env-file=../../.env test/automation-events.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, setFileText, trash } from "@codechatter/workspace-model";
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
const me = (await call("/api/auth/get-session")).body.user;
const automations = (body) => call(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
const triggersUrl = `/api/rooms/${ROOM}/automations/triggers`;

/** Two connections to the room's files: the sandbox's (a service token, as the runner's sync has), and a person's, as their browser makes it. */
async function connect(token, polyfill) {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: polyfill ? `${BASE.replace(/^http/, "ws")}/collab` : COLLAB, WebSocketPolyfill: polyfill ?? WebSocket, maxAttempts: 3 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token });
  provider.attach();
  await new Promise((resolve, reject) => {
    provider.on("synced", resolve);
    provider.on("authenticationFailed", ({ reason }) => reject(new Error(`collab refused: ${reason}`)));
    setTimeout(() => reject(new Error("collab sync timed out")), 15000);
  });
  return { doc, close: () => (provider.destroy(), socket.destroy()) };
}
const sandbox = await connect(() => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }));
const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
class Browser extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, { headers: { cookie, origin: BASE } });
  }
}
const person = await connect("cookie", Browser);

const stamp = Date.now().toString(36);
const FOLDER = `events-test-${stamp}`;
const made = [];

/** This flow's runs that a room event started, oldest first, each finished, with what its step gave. */
async function eventRuns(path) {
  const runs = (await automations({ op: "runs", path })).body.runs?.filter((run) => run.trigger === "event") ?? [];
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
async function waitForRuns(path, count, seconds = 60) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(1500)) {
    const runs = await eventRuns(path);
    if (runs.length >= count) return runs;
  }
  return eventRuns(path);
}

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const flowOf = (id, room, name) => ({
    id,
    displayName: name,
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: name,
      valid: true,
      settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, room },
      nextAction: {
        name: "seen",
        type: "CODE",
        displayName: "Seen",
        valid: true,
        skip: false,
        settings: {
          sourceCode: { code: "export const code = async (inputs) => ({ event: inputs.event, files: inputs.files ?? null, by: inputs.by, data: inputs.data ?? null });", packageJson: "{}" },
          input: { event: "{{trigger.output.event}}", files: "{{trigger.output.files}}", by: "{{trigger.output.by}}", data: "{{trigger.output.data}}" },
          errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
        },
        nextAction: null,
      },
    },
  });
  const FILES_FLOW = `${FOLDER}/on-files.flow.json`;
  const FILES_ID = `flow_files_${stamp}`;
  const PATHS = `${FOLDER}/src/**/*.py`;
  const SETTINGS_FLOW = `${FOLDER}/on-settings.flow.json`;
  const SETTINGS_ID = `flow_settings_${stamp}`;
  // Written as the sandbox: that doesn't set anything off.
  createFileAtPath(sandbox.doc, FILES_FLOW, JSON.stringify(flowOf(FILES_ID, { event: "files.changed", paths: PATHS }, "Python changed"), null, 2));
  createFileAtPath(sandbox.doc, SETTINGS_FLOW, JSON.stringify(flowOf(SETTINGS_ID, { event: "room.update" }, "Settings changed"), null, 2));
  await sleep(1500);

  // ---- What can't be used ----
  const outside = await call(triggersUrl, { method: "POST", json: { path: FILES_FLOW, flowId: FILES_ID, kind: "event", event: { event: "files.changed", paths: "/etc/*" } } });
  check("aPatternOutsideTheRoomIsRefused", outside.status === 400 && /inside the room/.test(JSON.stringify(outside.body)), outside);
  const madeUp = await call(triggersUrl, { method: "POST", json: { path: FILES_FLOW, flowId: FILES_ID, kind: "event", event: { event: "room.exploded" } } });
  check("anEventThatIsntIsRefused", madeUp.status === 400, madeUp);
  const nothing = await call(triggersUrl, { method: "POST", json: { path: FILES_FLOW, flowId: FILES_ID, kind: "event" } });
  check("aRoomEventNeedsWhatToListenFor", nothing.status === 400, nothing);

  // ---- Turning them on ----
  const onFiles = await call(triggersUrl, { method: "POST", json: { path: FILES_FLOW, flowId: FILES_ID, kind: "event", event: { event: "files.changed", paths: PATHS } } });
  check("itTurnsOn", (onFiles.status === 201 || onFiles.status === 200) && onFiles.body.event?.paths === PATHS && onFiles.body.url === null, onFiles.body);
  if (onFiles.body?.id) made.push(onFiles.body.id);
  const onSettings = await call(triggersUrl, { method: "POST", json: { path: SETTINGS_FLOW, flowId: SETTINGS_ID, kind: "event", event: { event: "room.update" } } });
  if (onSettings.body?.id) made.push(onSettings.body.id);

  // ---- A person's edits run it, with the files it listens for ----
  createFileAtPath(person.doc, `${FOLDER}/src/app.py`, "print('hi')\n");
  createFileAtPath(person.doc, `${FOLDER}/README.md`, "# not Python\n");
  const first = await waitForRuns(FILES_FLOW, 1);
  const seen = first[0]?.steps?.seen?.output;
  check("aPersonsEditRunsIt", first[0]?.status === "SUCCEEDED" && first[0].by === "Room event", first[0] ?? "no run");
  check("itGetsTheFilesItListensFor", seen?.event === "files.changed" && JSON.stringify(seen.files) === JSON.stringify([{ path: `${FOLDER}/src/app.py`, kind: "file", change: "added" }]), seen);
  check("andWhoChangedThem", Array.isArray(seen?.by) && seen.by.some((each) => each.id === me.id && each.name === me.name), seen?.by);

  // ---- What doesn't run it ----
  setFileText(person.doc, findByPath(person.doc, `${FOLDER}/README.md`).id, "# still not Python\n");
  setFileText(sandbox.doc, findByPath(sandbox.doc, `${FOLDER}/src/app.py`).id, "print('written by a run')\n");
  await sleep(9000);
  check("otherFilesAndTheSandboxsChangesDont", (await eventRuns(FILES_FLOW)).length === 1, (await eventRuns(FILES_FLOW)).length);
  // Several edits, one run once they stop.
  for (let i = 0; i < 5; i++) {
    setFileText(person.doc, findByPath(person.doc, `${FOLDER}/src/app.py`).id, `print(${i})\n`);
    await sleep(300);
  }
  const second = await waitForRuns(FILES_FLOW, 2);
  await sleep(4000);
  const afterEdits = await eventRuns(FILES_FLOW);
  check("manyEditsAreOneRun", afterEdits.length === 2 && afterEdits[1].steps?.seen?.output?.files?.[0]?.change === "changed", afterEdits.map((run) => run.steps?.seen?.output?.files));
  const listed = (await call(triggersUrl)).body.find((each) => each.id === onFiles.body.id);
  check("itSaysWhenItLastRan", listed?.lastRunId === second[1]?.id, { listed, last: second[1]?.id });

  // ---- The room's settings changing, from the audit log ----
  const room = (await call(`/api/rooms/${ROOM}`)).body;
  const updated = await call(`/api/rooms/${ROOM}`, { method: "PATCH", json: { name: room.name } });
  check("theRoomsSettingsChange", updated.status === 200, updated);
  const settingsRuns = await waitForRuns(SETTINGS_FLOW, 1);
  const fromAudit = settingsRuns[0]?.steps?.seen?.output;
  check("theAuditLogRunsIt", settingsRuns[0]?.status === "SUCCEEDED" && fromAudit?.event === "room.update" && fromAudit.data?.name === room.name && fromAudit.by?.[0]?.name === me.name, settingsRuns[0] ?? "no run");

  // ---- Listening for another event now, in the file: it turns itself off rather than run for the wrong one ----
  setFileText(sandbox.doc, findByPath(sandbox.doc, FILES_FLOW).id, JSON.stringify(flowOf(FILES_ID, { event: "repo.commit" }, "Committed"), null, 2));
  await sleep(1500);
  setFileText(person.doc, findByPath(person.doc, `${FOLDER}/src/app.py`).id, "print('again')\n");
  let off = null;
  for (const until = Date.now() + 40_000; Date.now() < until && !off; await sleep(1500)) {
    const now = (await call(triggersUrl)).body.find((each) => each.id === onFiles.body.id);
    if (now && !now.enabled) off = now;
  }
  check("aFlowListeningForAnotherEventTurnsItselfOff", off && /listens for another room event now/.test(off.problem ?? ""), off);
  check("andDidntRun", (await eventRuns(FILES_FLOW)).length === 2);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  for (const id of made) {
    const removed = await call(`${triggersUrl}/${id}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
  }
  const node = findByPath(sandbox.doc, FOLDER);
  if (node) trash(sandbox.doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(sandbox.doc)).some((item) => item.path.startsWith(FOLDER)));
  person.close();
  sandbox.close();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
