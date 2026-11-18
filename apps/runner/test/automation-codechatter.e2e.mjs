// CodeChatter's own steps for automations, the whole way, in E2ETST's sandbox by Activepieces' engine: a chat command (/deploy staging) runs a command in the
// room's files and posts what it printed back to the chat, as the automations, seen over Socket.IO as a person sees it. Also: a command that fails, one
// told not to fail the step, one that runs out of time, a folder outside the room, the engine's own token kept from commands, the room's AI asked (with
// whatever AI .env has; a plain refusal counts when it has none), and the chat's address refusing what isn't the runner's. It removes what it made.
//   node --env-file=../../.env test/automation-codechatter.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { createRequire } from "node:module";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const { io } = createRequire(new URL("../../web/package.json", import.meta.url))("socket.io-client");

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
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
const automations = (body) => call(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
const triggersUrl = `/api/rooms/${ROOM}/automations/triggers`;

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], extraHeaders: { origin: BASE, cookie: cookieHeader() } });
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});
await socket.emitWithAck("room:join", ROOM);
const heard = [];
socket.on("chat:message", (message) => heard.push(message));

const stamp = Date.now().toString(36);
const FOLDER = `codechatter-steps-${stamp}`;
const made = [];

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function runByHand(path, payload = {}, seconds = 120) {
  const started = await automations({ op: "run", path, payload });
  return started.body?.id ? finished(started.body.id, seconds) : { status: "NOT STARTED", error: started.body };
}

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const builtin = (name, kind, input, next = null) => ({ name, type: "CODE", builtin: kind, displayName: name, valid: true, skip: false, settings: { sourceCode: { code: "// built in\n", packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const flowOf = (id, name, room, first) => ({
    id,
    displayName: name,
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: name,
      valid: true,
      settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, ...(room && { room }) },
      nextAction: first,
    },
  });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };
  createFileAtPath(doc, `${FOLDER}/target.txt`, `target-ok-${stamp}\n`);
  const DEPLOY = write(
    "deploy",
    flowOf(
      `flow_deploy_${stamp}`,
      "Deploy from chat",
      { event: "chat.message", startsWith: "/deploy" },
      builtin("deploy", "run_command", { command: 'echo "deploying {{trigger.output.data.args}}" && cat target.txt', folder: FOLDER, seconds: 30, fail_on_error: true }, builtin("tell", "post_to_chat", { text: "Deployed {{trigger.output.data.args}}: {{deploy.output.stdout}}" })),
    ),
  );
  const FAILS = write("fails", flowOf(`flow_fails_${stamp}`, "Fails", null, builtin("fail", "run_command", { command: "echo nope >&2; exit 7" })));
  const KEEPS = write("keeps", flowOf(`flow_keeps_${stamp}`, "Keeps going", null, builtin("keep", "run_command", { command: "echo nope >&2; exit 7", fail_on_error: false })));
  const SLOW = write("slow", flowOf(`flow_slow_${stamp}`, "Slow", null, builtin("slow", "run_command", { command: "sleep 30", seconds: 2 })));
  const OUTSIDE = write("outside", flowOf(`flow_outside_${stamp}`, "Outside", null, builtin("outside", "run_command", { command: "ls", folder: "../etc" })));
  const ENVIRONMENT = write("env", flowOf(`flow_env_${stamp}`, "Environment", null, builtin("env", "run_command", { command: 'pwd; echo "token=${AP_SANDBOX_WS_TOKEN:-none} gateway=${OPENAI_BASE_URL:-none}"', folder: FOLDER })));
  const ASK = write("ask", flowOf(`flow_ask_${stamp}`, "Ask", null, builtin("ask", "ask_ai", { prompt: "Reply with the single word: ready", instructions: "Answer in one word." })));
  await sleep(1500);

  // ---- A chat command runs a command and answers in the chat ----
  const on = await call(triggersUrl, { method: "POST", json: { path: DEPLOY, flowId: `flow_deploy_${stamp}`, kind: "event", event: { event: "chat.message", startsWith: "/deploy" } } });
  if (on.body?.id) made.push(on.body.id);
  check("theChatCommandTurnsOn", on.body?.event?.startsWith === "/deploy", on.body);
  const asked = await socket.timeout(15_000).emitWithAck("chat:send", { roomId: ROOM, clientId: crypto.randomUUID(), body: `/deploy staging-${stamp}` });
  check("theCommandIsSent", asked.ok, asked);
  let answer = null;
  for (let i = 0; i < 120 && !answer; i++) {
    answer = heard.find((message) => message.kind === "automation" && message.body.includes(`staging-${stamp}`)) ?? null;
    if (!answer) await sleep(500);
  }
  check("itAnswersInTheChat", answer, heard.slice(-3));
  check("withWhatTheCommandPrinted", answer?.body.includes(`Deployed staging-${stamp}: deploying staging-${stamp}`) && answer.body.includes(`target-ok-${stamp}`), answer?.body);
  check("asTheAutomationsNotAPerson", answer?.author === null && answer.kind === "automation", answer);
  const history = await call(`/api/rooms/${ROOM}/messages?limit=20`);
  const kept = (Array.isArray(history.body) ? history.body : (history.body?.messages ?? history.body?.items ?? [])).find((message) => message.id === answer?.id);
  check("andItsKeptInTheChat", kept?.kind === "automation", { status: history.status, kept });

  // ---- Commands that fail, and how they say so ----
  const failed = await runByHand(FAILS);
  check("aFailingCommandFailsTheStep", failed?.status === "FAILED" && /The command ended with 7: nope/.test(JSON.stringify(failed)), failed?.error ?? failed);
  const keptGoing = await runByHand(KEEPS);
  const keepOutput = keptGoing?.steps?.keep?.output;
  check("orGivesItsExitCodeWhenToldNotTo", keptGoing?.status === "SUCCEEDED" && keepOutput?.exitCode === 7 && keepOutput.stderr.trim() === "nope", keptGoing?.steps?.keep ?? keptGoing);
  const slow = await runByHand(SLOW);
  check("aSlowCommandIsStopped", slow?.status === "FAILED" && /longer than 2 seconds/.test(JSON.stringify(slow)), slow?.error ?? slow);
  const outside = await runByHand(OUTSIDE);
  check("aFolderOutsideTheRoomIsRefused", outside?.status === "FAILED" && /should be a folder in the room/.test(JSON.stringify(outside)), outside?.error ?? outside);
  const environment = await runByHand(ENVIRONMENT);
  const printed = environment?.steps?.env?.output?.stdout ?? "";
  check("itRunsInTheRoomsFiles", printed.split("\n")[0] === `/workspace/${FOLDER}`, printed);
  check("withoutTheEnginesToken", /token=none/.test(printed) && /gateway=http:\/\/127\.0\.0\.1:3129\/v1/.test(printed), printed);

  // ---- The room's AI ----
  const asking = await runByHand(ASK, {}, 300);
  const said = asking?.steps?.ask?.output;
  // Why it stopped, as the run says it (the engine's envelope taken off), not its stack.
  const refusal = String(asking?.message ?? "");
  check(
    "theRoomsAIAnswers",
    (asking?.status === "SUCCEEDED" && typeof said?.text === "string" && said.text.length > 0) || (asking?.status === "FAILED" && /AI isn't set up|isn't available|AI request failed|off|limit/i.test(refusal) && !/TypeError|undefined/.test(refusal)),
    asking?.steps?.ask ?? asking,
  );
  console.log(asking?.status === "SUCCEEDED" ? `      (the AI said: ${said.text.slice(0, 60)})` : "      (the room's AI couldn't be reached, and the step said so plainly)");

  // ---- The chat's address is only the runner's ----
  const stranger = await fetch(`${API}/api/internal/automations/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) });
  check("aStrangerCantPost", stranger.status === 401, stranger.status);
  const empty = await fetch(`${API}/api/internal/automations/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${signServiceToken(SECRET, { aud: "api", sub: ROOM }, 60)}` }, body: JSON.stringify({ text: "   " }) });
  check("anEmptyMessageIsRefused", empty.status === 400, empty.status);
  const fromBrowsers = await fetch(`${BASE}/api/internal/automations/chat`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ text: "hello" }) });
  check("andBrowsersCantReachIt", fromBrowsers.status === 404, fromBrowsers.status);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  for (const id of made) {
    const removed = await call(`${triggersUrl}/${id}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
  }
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
