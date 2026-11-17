// Automations on a schedule, the whole way: a flow on Activepieces' schedule piece, turned on through the API, run by the API's timer in E2ETST's sandbox by
// Activepieces' engine. A second API of its own (on :4021, from the dev watcher's dist) runs its timer every second beside the dev API's, so each time on the
// schedule is wanted by two servers and must run once. Also: what the flow is given, the file's schedule changed by hand being followed, a flow that no longer
// starts on a schedule turning itself off, and schedules that can't be used. It takes about three minutes, as cron counts in whole minutes. It turns off and
// removes what it made.
//   node --env-file=../../.env test/automation-schedules.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { spawn } from "node:child_process";

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
const SECOND_API = "http://127.0.0.1:4021";

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 400)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function person() {
  const cookies = new Map();
  return async (path, { method = "GET", json } = {}) => {
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
  };
}
async function signIn(email) {
  const call = person();
  const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`);
  return call;
}

// The second server: the dev API's build, with its timer every second.
const second = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  cwd: new URL("../../api/", import.meta.url),
  env: { ...process.env, API_PORT: "4021", LOG_LEVEL: "warn", AUTOMATION_SCHEDULE_TICK_MS: "1000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let secondErrors = "";
second.stderr.on("data", (chunk) => (secondErrors += chunk));
second.stdout.resume();

const owner = await signIn("test1@codechatter.local");
const automations = (body) => owner(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
const triggers = () => owner(`/api/rooms/${ROOM}/automations/triggers`);

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const FOLDER = `schedules-test-${stamp}`;
const PATH = `${FOLDER}/tick.flow.json`;
const FLOW_ID = `flow_schedule_${stamp}`;
let triggerId = null;

/** The schedule's runs of this flow, oldest first, each with what its step gave. */
async function scheduledRuns() {
  const runs = (await automations({ op: "runs", path: PATH })).body.runs?.filter((run) => run.trigger === "schedule") ?? [];
  const details = [];
  for (const run of runs.reverse()) {
    for (let i = 0; i < 60; i++) {
      const found = await automations({ op: "run-details", id: run.id });
      if (found.status === 200 && found.body.status !== "RUNNING" && found.body.finishedAt) {
        details.push(found.body);
        break;
      }
      await sleep(500);
    }
  }
  return details;
}
async function waitForRuns(count, seconds) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(3000)) {
    const runs = await scheduledRuns();
    if (runs.length >= count) return runs;
  }
  return scheduledRuns();
}
const mine = async () => (await triggers()).body.find((each) => each.id === triggerId);

try {
  for (let i = 0; i < 60 && !(await fetch(`${SECOND_API}/api/healthz`).then((r) => r.ok, () => false)); i++) await sleep(500);
  check("aSecondServerIsRunning", await fetch(`${SECOND_API}/api/healthz`).then((r) => r.ok, () => false), secondErrors.slice(-400));

  const manifest = await automations({ op: "manifest" });
  const schedulePiece = manifest.body.pieces["@activepieces/piece-schedule"];
  check("theSchedulePieceIsInTheImage", Boolean(schedulePiece?.triggers?.cron_expression), Object.keys(manifest.body.pieces ?? {}).length);
  const flowWith = (trigger) => ({
    id: FLOW_ID,
    displayName: "Tick",
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: "On a schedule",
      valid: true,
      settings: trigger,
      nextAction: {
        name: "tick",
        type: "CODE",
        displayName: "Tick",
        valid: true,
        skip: false,
        settings: {
          sourceCode: { code: "export const code = async (inputs) => ({ at: inputs.at, cron: inputs.cron, zone: inputs.zone });", packageJson: "{}" },
          input: { at: "{{trigger.scheduled_at}}", cron: "{{trigger.cron_expression}}", zone: "{{trigger.timezone}}" },
          errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
        },
        nextAction: null,
      },
    },
  });
  const onSchedule = (cronExpression) => ({ pieceName: "@activepieces/piece-schedule", pieceVersion: schedulePiece.version, triggerName: "cron_expression", input: { cronExpression, timezone: "UTC" }, propertySettings: {} });
  createFileAtPath(doc, PATH, JSON.stringify(flowWith(onSchedule("* * * * *")), null, 2));
  await sleep(1500);
  const write = (flow) => setFileText(doc, findByPath(doc, PATH).id, JSON.stringify(flow, null, 2));

  // ---- Schedules that can't be used ----
  const nonsense = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "schedule", schedule: { cron: "61 * * * *", timezone: "UTC" } } });
  check("aWrongCronIsRefused", nonsense.status === 400 && /minute/i.test(JSON.stringify(nonsense.body)), nonsense);
  const nowhere = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "schedule", schedule: { cron: "* * * * *", timezone: "Mars/Olympus" } } });
  check("aWrongTimezoneIsRefused", nowhere.status === 400, nowhere);
  const never = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "schedule", schedule: { cron: "0 0 30 2 *", timezone: "UTC" } } });
  check("aScheduleThatNeverComesIsRefused", never.status === 400 && /never/.test(JSON.stringify(never.body)), never);
  const timeless = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "schedule" } });
  check("aScheduleNeedsATime", timeless.status === 400, timeless);

  // ---- Turning it on ----
  const before = Date.now();
  const made = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "schedule", schedule: { cron: "* * * * *", timezone: "UTC" } } });
  check("itTurnsOn", made.status === 201 || made.status === 200, made.body);
  triggerId = made.body?.id;
  check("itSaysWhenItNextRuns", made.body?.nextRunAt > before && made.body.nextRunAt <= before + 61_000 && made.body.nextRunAt % 60_000 === 0, made.body);
  check("aScheduleHasNoAddress", made.body?.url === null && made.body?.schedule?.cron === "* * * * *", made.body);
  const rotated = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}/rotate`, { method: "POST" });
  check("aScheduleCantGetANewAddress", rotated.status === 400, rotated);

  // ---- It runs at each time, once, with two servers wanting to ----
  const first = await waitForRuns(1, 100);
  check("itRunsByItself", first[0]?.status === "SUCCEEDED" && first[0].by === "Schedule", first[0] ?? first);
  const given = first[0]?.steps?.tick?.output;
  check("itGetsWhatTheSchedulePieceGives", given?.cron === "* * * * *" && given?.zone === "UTC" && Date.parse(given?.at) % 60_000 === 0, given);
  check("itsTimeIsTheOneItWasFor", Date.parse(given?.at) <= first[0]?.startedAt && first[0].startedAt - Date.parse(given?.at) < 30_000, { at: given?.at, startedAt: first[0]?.startedAt });
  // The file changed by hand: the next run goes by the old times, and afterwards it's the file's.
  write(flowWith(onSchedule("0 0 1 1 *")));
  await sleep(1500);
  const two = await waitForRuns(2, 100);
  const slots = two.map((run) => run.steps?.tick?.output?.at);
  check("eachTimeRunsOnce", two.length === 2 && new Set(slots).size === 2 && Date.parse(slots[1]) - Date.parse(slots[0]) === 60_000, slots);
  const followed = await mine();
  check("theFilesNewScheduleIsFollowed", followed?.schedule?.cron === "0 0 1 1 *" && new Date(followed.nextRunAt).toISOString().endsWith("-01-01T00:00:00.000Z"), followed);
  check("itSaysWhenItLastRan", followed?.lastRunId === two[1]?.id, { followed, last: two[1]?.id });

  // ---- A flow that no longer starts on a schedule turns itself off ----
  const patched = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { schedule: { cron: "* * * * *", timezone: "UTC" } } });
  check("itsTimesCanBeChanged", patched.status === 200 && patched.body.schedule.cron === "* * * * *", patched.body);
  write(flowWith({ pieceName: "@activepieces/piece-webhook", pieceVersion: manifest.body.pieces["@activepieces/piece-webhook"].version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }));
  let stopped = null;
  for (const until = Date.now() + 100_000; Date.now() < until && !stopped; await sleep(3000)) {
    const now = await mine();
    if (now && !now.enabled) stopped = now;
  }
  check("itTurnsItselfOff", stopped && /doesn't start on a schedule any more/.test(stopped.problem ?? ""), stopped);
  check("andDidntRunAgain", (await scheduledRuns()).length === 2);
  const again = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { enabled: true } });
  check("turnedOnAgainItsProblemIsForgotten", again.status === 200 && again.body.enabled && again.body.problem === null, again.body);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  if (triggerId) {
    const removed = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
  }
  second.kill();
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(600);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
