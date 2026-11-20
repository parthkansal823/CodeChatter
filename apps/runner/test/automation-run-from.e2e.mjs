// Running a flow from a chosen step on (n8n's partial run), and pins, the whole way, in E2ETST's sandbox by Activepieces' real engine: from a step on the main
// line, inside a router's branch and from the router itself, the steps before it giving what they gave on the earlier run and not running again; from inside
// a loop, starting from the loop; what's refused; pins used on a run by hand and not on a live one (a webhook's); and the trigger's pinned data standing in
// for what's sent. Every step stamps the time it ran, so a step run again is told from one kept. It removes what it made.
//   node --env-file=../../.env test/automation-run-from.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const FOLDER = `run-from-${stamp}`;

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function start(path, extra = {}) {
  const started = await automations({ op: "run", path, payload: { go: "one" }, ...extra });
  return started.body?.id ? finished(started.body.id) : { status: "NOT STARTED", error: started.body };
}
/** When each step ran, by name: a step kept from an earlier run keeps its time. */
const timesOf = (run) => Object.fromEntries(Object.entries(run?.steps ?? {}).map(([name, step]) => [name, step.output?.at ?? null]));
const sameAs = (run, earlier, names) => names.every((name) => timesOf(run)[name] !== null && timesOf(run)[name] === timesOf(earlier)[name]);
const newerThan = (run, earlier, names) => names.every((name) => timesOf(run)[name] !== null && timesOf(run)[name] !== timesOf(earlier)[name]);

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, next = null, input = {}) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: "export const code = async (inputs) => ({ at: `${Date.now()}-${Math.random()}`, ...inputs });\n", packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const router = (next) => ({
    name: "route",
    type: "ROUTER",
    displayName: "Router",
    valid: true,
    skip: false,
    settings: { executionType: "EXECUTE_FIRST_MATCH", branches: [{ branchName: "One", branchType: "CONDITION", conditions: [[{ operator: "TEXT_EXACTLY_MATCHES", firstValue: "{{trigger.output.body.go}}", secondValue: "one", caseSensitive: false }]] }, { branchName: "Otherwise", branchType: "FALLBACK" }] },
    children: [code("b1"), code("b2")],
    nextAction: next,
  });
  const flowOf = (name, first, extra = {}) => ({
    id: `flow_${name}_${stamp}`,
    displayName: name,
    schemaVersion: "27",
    trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: name, valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first },
    ...extra,
  });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };
  const MAIN = write("main", flowOf("main", code("a", router(code("c", null, { b1: "{{b1.output.at}}" })))));
  const LOOPED = write(
    "looped",
    flowOf("looped", code("items", { name: "each", type: "LOOP_ON_ITEMS", displayName: "Each", valid: true, skip: false, settings: { items: "{{items.output.list}}" }, firstLoopAction: code("inner"), nextAction: code("after") }, { list: [1, 2] })),
  );
  const OTHER = write("other", flowOf("other", code("a")));
  const PINNED = write("pinned", flowOf("pinned", code("a", router(code("c"))), { pinned: { a: { at: "pinned-a" }, trigger: { body: { go: "two" }, headers: {}, queryParams: {} } } }));
  await sleep(2000);

  // ---- From a chosen step on ----
  const first = await start(MAIN);
  check("a run of the whole flow, to start from", first?.status === "SUCCEEDED" && Boolean(timesOf(first).c), first);
  const fromC = await start(MAIN, { mode: "from", step: "c", retryOf: first?.id });
  check("from the last step: it runs again, and the steps before give what they gave", fromC?.status === "SUCCEEDED" && sameAs(fromC, first, ["a", "b1"]) && newerThan(fromC, first, ["c"]), timesOf(fromC));
  check("the run says it ran from that step, of which run", fromC?.mode === "from" && fromC?.step === "c" && fromC?.retryOf === first?.id, { mode: fromC?.mode, step: fromC?.step, retryOf: fromC?.retryOf });
  const listedRuns = (await automations({ op: "runs", path: MAIN })).body?.runs ?? [];
  check("and its flow's runs list it so, newest first", listedRuns[0]?.id === fromC?.id && listedRuns[0]?.mode === "from" && listedRuns[0]?.step === "c" && listedRuns.some((run) => run.id === first?.id), listedRuns.slice(0, 3).map((run) => ({ id: run.id, mode: run.mode, step: run.step })));
  check("what the step after it was given came from the kept step", fromC?.steps?.c?.output?.b1 === timesOf(first).b1, fromC?.steps?.c?.output);
  const fromB1 = await start(MAIN, { mode: "from", step: "b1", retryOf: first?.id });
  check("from a step inside a branch: it and what's after run again, and not what's before", fromB1?.status === "SUCCEEDED" && sameAs(fromB1, first, ["a"]) && newerThan(fromB1, first, ["b1", "c"]), timesOf(fromB1));
  const fromRoute = await start(MAIN, { mode: "from", step: "route", retryOf: first?.id });
  check("from the router: it chooses again, with what was sent", fromRoute?.status === "SUCCEEDED" && sameAs(fromRoute, first, ["a"]) && newerThan(fromRoute, first, ["b1", "c"]) && !fromRoute?.steps?.b2, timesOf(fromRoute));
  const fromLater = await start(MAIN, { mode: "from", step: "c", retryOf: fromB1?.id });
  check("from a run that was itself run from a step", fromLater?.status === "SUCCEEDED" && sameAs(fromLater, fromB1, ["a", "b1"]) && newerThan(fromLater, fromB1, ["c"]), timesOf(fromLater));

  const looped = await start(LOOPED);
  check("a run with a loop, to start from", looped?.status === "SUCCEEDED" && Boolean(timesOf(looped).after), looped);
  const fromInner = await start(LOOPED, { mode: "from", step: "inner", retryOf: looped?.id });
  check("from a step inside a loop: it starts from the loop, with the step before it kept", fromInner?.status === "SUCCEEDED" && sameAs(fromInner, looped, ["items"]) && newerThan(fromInner, looped, ["after"]) && fromInner?.step === "inner", timesOf(fromInner));

  // ---- What's refused ----
  const refused = async (extra, words) => {
    const answer = await automations({ op: "run", path: MAIN, payload: {}, ...extra });
    return answer.status >= 400 && words.test(JSON.stringify(answer.body)) ? true : answer;
  };
  const triggerRefused = await refused({ mode: "from", step: "trigger", retryOf: first?.id }, /isn't a step of this flow to run from/);
  check("not from the trigger", triggerRefused === true, triggerRefused);
  const unknownRefused = await refused({ mode: "from", step: "nothere", retryOf: first?.id }, /isn't a step of this flow to run from/);
  check("not from a step the flow hasn't", unknownRefused === true, unknownRefused);
  const tried = await automations({ op: "run", path: MAIN, payload: {}, mode: "step", step: "a", sampleData: {} });
  const triedRun = tried.body?.id ? await finished(tried.body.id) : null;
  const stepRefused = await refused({ mode: "from", step: "c", retryOf: triedRun?.id ?? "x" }, /finished run of the whole flow/);
  check("not from one step tried on its own", stepRefused === true, stepRefused);
  const other = await start(OTHER);
  const otherRefused = await refused({ mode: "from", step: "c", retryOf: other?.id }, /another flow/);
  check("not from a run of another flow", otherRefused === true, otherRefused);

  // ---- Pins: by hand only, and the trigger's ----
  const byHand = await start(PINNED);
  check("by hand, a pinned step gives what was pinned", byHand?.status === "SUCCEEDED" && byHand?.steps?.a?.output?.at === "pinned-a", byHand?.steps?.a);
  check("and the trigger's pinned data stands in for what's sent", byHand?.steps?.trigger?.output?.body?.go === "two" && Boolean(byHand?.steps?.b2) && !byHand?.steps?.b1, { trigger: byHand?.steps?.trigger?.output, ran: Object.keys(byHand?.steps ?? {}) });
  check("the run lists what was pinned", JSON.stringify(byHand?.pinned) === JSON.stringify(["trigger", "a"]), byHand?.pinned);
  const live = await start(PINNED, { trigger: "webhook" });
  check("started by its trigger, every step runs for real", live?.status === "SUCCEEDED" && live?.steps?.a?.output?.at !== "pinned-a" && Boolean(live?.steps?.b1) && !live?.steps?.b2 && (live?.pinned ?? []).length === 0, { a: live?.steps?.a?.output, ran: Object.keys(live?.steps ?? {}), pinned: live?.pinned });
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
