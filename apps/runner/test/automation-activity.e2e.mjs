// Automations started by what people do in a room, the whole way, in E2ETST's sandbox by Activepieces' engine: a Run failing (pressed as a person does,
// over Socket.IO), the Tests tab's tests failing, a chat message starting with a command, and commits made with git in the sandbox (seen by its agent in
// the reflog, sent by the runner). Also: a Run that passes, a file not asked for, tests that pass, other messages and a retried send don't run anything.
// It turns off and removes what it made, and the git repository it made.
//   node --env-file=../../.env test/automation-activity.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { createRequire } from "node:module";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

// The browser's Socket.IO client, from the web app's packages.
const { io } = createRequire(new URL("../../web/package.json", import.meta.url))("socket.io-client");

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const ROOM = "E2ETST";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
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
const cookieHeader = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
async function call(path, { method = "GET", json } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(90_000),
    headers: { origin: BASE, ...(json !== undefined && { "content-type": "application/json" }), ...(cookies.size && { cookie: cookieHeader() }) },
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

// The room's files, as the runner's sync has them.
const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

// Socket.IO as a person, as the room's page has it.
const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { origin: BASE, cookie: cookieHeader() } });
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});
await socket.emitWithAck("room:join", ROOM);
const exits = new Map();
socket.on("run:exit", (exit) => exits.set(exit.runId, exit));
/** Presses Run on a file, as a person does, and waits for it to end. */
async function press(path) {
  const started = await socket.timeout(90_000).emitWithAck("run:start", { roomId: ROOM, path, stateVector: stateVector() });
  if (!started.ok) throw new Error(`run:start ${path}: ${started.error}`);
  for (let i = 0; i < 120 && !exits.has(started.data.id); i++) await sleep(500);
  return exits.get(started.data.id);
}
/** A file run by the runner itself (no person, so no room event): for setting up git. */
async function runQuietly(path) {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`, "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(120_000),
  });
  return response.text();
}
const say = (body, clientId = crypto.randomUUID()) => socket.timeout(15_000).emitWithAck("chat:send", { roomId: ROOM, clientId, body });

const stamp = Date.now().toString(36);
const FOLDER = `activity-test-${stamp}`;
const made = [];
let madeGit = false;

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
const seenIn = (run) => run?.steps?.seen?.output;

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
          sourceCode: { code: "export const code = async (inputs) => ({ event: inputs.event, by: inputs.by, data: inputs.data ?? null });", packageJson: "{}" },
          input: { event: "{{trigger.output.event}}", by: "{{trigger.output.by}}", data: "{{trigger.output.data}}" },
          errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
        },
        nextAction: null,
      },
    },
  });
  const flows = {
    run: { path: `${FOLDER}/on-run.flow.json`, id: `flow_run_${stamp}`, room: { event: "run.failed", paths: `${FOLDER}/**/*.py` } },
    tests: { path: `${FOLDER}/on-tests.flow.json`, id: `flow_tests_${stamp}`, room: { event: "tests.failed" } },
    chat: { path: `${FOLDER}/on-chat.flow.json`, id: `flow_chat_${stamp}`, room: { event: "chat.message", startsWith: "/deploy" } },
    git: { path: `${FOLDER}/on-git.flow.json`, id: `flow_git_${stamp}`, room: { event: "git.commit" } },
  };
  for (const [name, flow] of Object.entries(flows)) createFileAtPath(doc, flow.path, JSON.stringify(flowOf(flow.id, flow.room, name), null, 2));
  createFileAtPath(doc, `${FOLDER}/boom.py`, 'print("before the error")\nprint(1 / 0)\n');
  createFileAtPath(doc, `${FOLDER}/fine.py`, 'print("all good")\n');
  createFileAtPath(doc, `${FOLDER}/boom.sh`, "echo not python\nexit 3\n");
  createFileAtPath(doc, `${FOLDER}/add.py`, "a, b = map(int, input().split())\nprint(a + b)\n");
  createFileAtPath(
    doc,
    `${FOLDER}/commit.sh`,
    [
      "set -e",
      "cd /workspace",
      'if [ -e .git ]; then echo "HAD GIT"; exit 0; fi',
      "git init -q -b cc-events-test",
      'echo "MADE GIT"',
      'git -c user.name="Asha Test" -c user.email=asha@example.com commit -q --allow-empty -m "First of the test"',
      'git -c user.name="Asha Test" -c user.email=asha@example.com commit -q --allow-empty -m "Second of the test"',
      "echo COMMITTED",
      "",
    ].join("\n"),
  );
  createFileAtPath(doc, `${FOLDER}/uncommit.sh`, "rm -rf /workspace/.git\necho REMOVED\n");
  await sleep(1500);

  // ---- What can't be used ----
  const twoLines = await call(triggersUrl, { method: "POST", json: { path: flows.chat.path, flowId: flows.chat.id, kind: "event", event: { event: "chat.message", startsWith: "/a\n/b" } } });
  check("aStartOfTwoLinesIsRefused", twoLines.status === 400 && /One line/.test(JSON.stringify(twoLines.body)), twoLines);

  // ---- Turning them on ----
  for (const flow of Object.values(flows)) {
    const on = await call(triggersUrl, { method: "POST", json: { path: flow.path, flowId: flow.id, kind: "event", event: flow.room } });
    if (on.body?.id) made.push(on.body.id);
    flow.trigger = on.body;
  }
  check("theyTurnOn", made.length === 4 && flows.run.trigger.event?.paths === `${FOLDER}/**/*.py` && flows.chat.trigger.event?.startsWith === "/deploy", Object.values(flows).map((flow) => flow.trigger));

  // ---- A Run failing ----
  const boom = await press(`${FOLDER}/boom.py`);
  check("aRunFails", boom?.code === 1 && boom.reason === "exit", boom);
  const runRuns = await waitForRuns(flows.run.path, 1);
  const failedRun = seenIn(runRuns[0]);
  check("itRunsTheFlow", runRuns[0]?.status === "SUCCEEDED" && failedRun?.event === "run.failed", runRuns[0] ?? "no run");
  check("withTheFileAndHowItEnded", failedRun?.data?.path === `${FOLDER}/boom.py` && failedRun.data.code === 1 && failedRun.data.failed === true && failedRun.data.reason === "exit" && failedRun.data.command?.includes("boom.py"), failedRun?.data);
  check("andTheEndOfItsOutput", /before the error/.test(failedRun?.data?.output ?? "") && /ZeroDivisionError/.test(failedRun?.data?.output ?? "") && !/\u001b/.test(failedRun?.data?.output ?? ""), failedRun?.data?.output);
  check("andWhoRanIt", failedRun?.by?.[0]?.id === me.id && failedRun.by[0].name === me.name, failedRun?.by);
  // A Run that passes, and a file it doesn't listen for, don't run it.
  const fine = await press(`${FOLDER}/fine.py`);
  const shell = await press(`${FOLDER}/boom.sh`);
  check("theOtherRunsEnd", fine?.code === 0 && shell?.code === 3, { fine, shell });
  await sleep(5000);
  check("aPassingRunAndAnotherFileDont", (await eventRuns(flows.run.path)).length === 1, (await eventRuns(flows.run.path)).length);

  // ---- The Tests tab's tests failing ----
  const judge = async (cases) => {
    const response = await fetch(`${BASE}/api/rooms/${ROOM}/judge`, { method: "POST", headers: { origin: BASE, cookie: cookieHeader(), "content-type": "application/json" }, body: JSON.stringify({ path: `${FOLDER}/add.py`, stateVector: stateVector(), cases }), signal: AbortSignal.timeout(120_000) });
    return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  };
  const judged = await judge([{ input: "1 2\n", expected: "3\n" }, { input: "2 2\n", expected: "5\n" }]);
  check("theTestsRun", judged.at(-1)?.type === "done" && judged.at(-1).passed === 1 && judged.at(-1).total === 2, judged.at(-1));
  const testRuns = await waitForRuns(flows.tests.path, 1);
  const failedTests = seenIn(testRuns[0]);
  check("failingTestsRunTheFlow", testRuns[0]?.status === "SUCCEEDED" && failedTests?.event === "tests.failed" && failedTests.by?.[0]?.id === me.id, testRuns[0] ?? "no run");
  check("withEachTestsResult", failedTests?.data?.path === `${FOLDER}/add.py` && failedTests.data.passed === 1 && failedTests.data.total === 2 && failedTests.data.failed === true && JSON.stringify(failedTests.data.cases.map((each) => each.verdict)) === JSON.stringify(["passed", "failed"]) && failedTests.data.cases[1].stdout.trim() === "4", failedTests?.data);
  await judge([{ input: "1 2\n", expected: "3\n" }]);
  await sleep(5000);
  check("passingTestsDont", (await eventRuns(flows.tests.path)).length === 1, (await eventRuns(flows.tests.path)).length);

  // ---- A chat message ----
  const clientId = crypto.randomUUID();
  const sent = await say("/deploy staging --fast", clientId);
  check("aMessageIsSent", sent.ok, sent);
  const chatRuns = await waitForRuns(flows.chat.path, 1);
  const message = seenIn(chatRuns[0]);
  check("aCommandRunsTheFlow", chatRuns[0]?.status === "SUCCEEDED" && message?.event === "chat.message" && message.by?.[0]?.id === me.id && message.by[0].name === me.name, chatRuns[0] ?? "no run");
  check("withWhatFollowsIt", message?.data?.text === "/deploy staging --fast" && message.data.args === "staging --fast" && message.data.id === sent.data?.id, message?.data);
  await say("/deployment went fine");
  await say("hello everyone");
  await say("/deploy staging --fast", clientId);
  await sleep(5000);
  check("otherMessagesAndARetriedSendDont", (await eventRuns(flows.chat.path)).length === 1, (await eventRuns(flows.chat.path)).length);

  // ---- Commits made with git in the sandbox ----
  const committed = await runQuietly(`${FOLDER}/commit.sh`);
  // Made here, so it's taken away again even if the commits fail.
  madeGit = committed.includes("MADE GIT");
  const didCommit = committed.includes("COMMITTED");
  check("gitCommitsInTheSandbox", didCommit, committed.slice(-400));
  if (didCommit) {
    let commits = [];
    let gitRuns = [];
    for (const until = Date.now() + 60_000; Date.now() < until && commits.length < 2; await sleep(1500)) {
      gitRuns = await eventRuns(flows.git.path);
      commits = gitRuns.flatMap((run) => seenIn(run)?.data?.commits ?? []);
    }
    const first = seenIn(gitRuns[0]);
    check("aCommitRunsTheFlow", gitRuns[0]?.status === "SUCCEEDED" && first?.event === "git.commit" && first.data?.branch === "cc-events-test", gitRuns[0] ?? "no run");
    check("withEachCommit", JSON.stringify(commits.map((each) => [each.kind, each.message])) === JSON.stringify([["initial", "First of the test"], ["commit", "Second of the test"]]), commits);
    check("andWhoGitSaysMadeThem", first?.by?.[0]?.name === "Asha Test" && first.by[0].id === null && commits[0]?.author?.email === "asha@example.com" && /^[0-9a-f]{40}$/.test(commits[1]?.commit ?? "") && commits[1].parent === commits[0].commit, { by: first?.by, commits });
  }
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  for (const id of made) {
    const removed = await call(`${triggersUrl}/${id}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
  }
  if (madeGit) check("theRepositoryItMadeIsRemoved", (await runQuietly(`${FOLDER}/uncommit.sh`)).includes("REMOVED"));
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  socket.close();
  provider.destroy();
  collab.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
