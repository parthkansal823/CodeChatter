// Evals for real, in E2ETST: promptfoo in the sandbox calls whatever AI .env has, through the gateway. Checks pass and fail as they
// should, awkward values reach the model unharmed, the AI can judge an answer, a second run waits its turn, and Stop stops it and
// leaves nothing behind. Needs the current sandbox images (pnpm sandbox:build, sandbox:build:full) and the AI set up.
//   node --env-file=../../.env test/evals.e2e.mjs        (from apps/runner, with the dev stack running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

/** Sends one set of evals, and reads its lines. */
async function evals(input, { signal, onEvent } = {}) {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/evals`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(input), signal });
  if (!response.ok) return { status: response.status, body: await response.text(), events: [] };
  const events = [];
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      events.push(event);
      onEvent?.(event);
    }
  }
  return { status: response.status, events, done: events.find((event) => event.type === "done")?.report, error: events.find((event) => event.type === "error")?.message };
}

const MODEL = process.env.AI_MODEL;
if (!MODEL) throw new Error("AI_MODEL missing: this test needs the AI set up.");

const AWKWARD = `It's "quoted", with a back\\slash,\na second line, {braces} and <tags>`;
const column = { id: "c1", model: MODEL, temperature: 0, maxTokens: 40, json: false };
const INPUT = {
  system: "You follow instructions exactly, and reply as briefly as you can.",
  messages: [{ role: "user", content: "{{task}}" }],
  columns: [column],
  oneAtATime: true,
  grader: MODEL,
  cases: [
    { id: "passes", name: "Says the word", values: { task: "Reply with only the word: hello" }, checks: [{ type: "icontains", value: "hello" }, { type: "not-contains", value: "goodbye" }, { type: "regex", value: "^\\s*[Hh]ello" }] },
    { id: "fails", name: "Looks for what isn't there", values: { task: "Reply with only the word: hello" }, checks: [{ type: "contains", value: "zebra" }] },
    { id: "awkward", name: "An awkward value", values: { task: `Repeat this back exactly, and nothing else: ${AWKWARD}` }, checks: [{ type: "contains", value: "second line" }] },
    { id: "code", name: "A check in JavaScript", values: { task: "Reply with only the word: hello" }, checks: [{ type: "javascript", value: "output.length < 200" }] },
    { id: "late", name: "A time limit nothing can meet", values: { task: "Reply with only the word: hello" }, checks: [{ type: "latency", value: "1" }] },
    { id: "judged", name: "Judged by the AI", values: { task: "What is the capital of France? One word." }, checks: [{ type: "llm-rubric", value: "The answer says the capital of France is Paris." }] },
  ],
};

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

async function runScript(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }), signal: AbortSignal.timeout(120_000) });
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data;
    }
  }
  return output;
}

const probe = `ev-${Date.now().toString(36)}.sh`;
try {
  // Refused before anything runs.
  const empty = await evals({ ...INPUT, cases: [] });
  check("noCasesIsRefused", empty.status === 400, empty.status);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/evals`, { method: "POST", headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: "TEAM22", uid: "x", name: "X" })}`, "content-type": "application/json" }, body: JSON.stringify(INPUT) });
  check("anotherRoomsTokenIsRefused", forged.status === 401, forged.status);

  // The real thing, while a second one tries to start.
  const progress = [];
  const started = Date.now();
  const first = evals(INPUT, { onEvent: (event) => event.type === "progress" && progress.push(event.calls) });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const second = await evals(INPUT);
  check("aSecondRunWaitsItsTurn", /already running/.test(second.error ?? ""), JSON.stringify(second).slice(0, 200));
  const { done, error } = await first;
  console.log(`      took ${Math.round((Date.now() - started) / 1000)} s`);
  check("itFinishes", Boolean(done), error);
  const cell = (id) => done?.cells.find((item) => item.caseId === id);
  for (const item of done?.cells ?? []) console.log(`      ${item.caseId}: ${item.pass ? "pass" : "FAIL"} ${item.latencyMs} ms, ${item.inputTokens}/${item.outputTokens} tokens: ${JSON.stringify(item.output.slice(0, 70))}${item.error ? ` error ${item.error.slice(0, 120)}` : ""}`);
  check("everyCaseHasAResult", done?.cells.length === INPUT.cases.length, done?.cells.length);
  check("itShowedItsProgress", progress.length > 0 && Math.max(...progress) >= 1, progress.join());
  check("whatsThereIsFound", cell("passes")?.pass === true, JSON.stringify(cell("passes")));
  check("whatsNotThereFails", cell("fails")?.pass === false && cell("fails").error === null, JSON.stringify(cell("fails")));
  check("itSaysWhichCheckFailedAndWhy", cell("fails")?.failed[0]?.type === "contains" && cell("fails").failed[0].value === "zebra" && /zebra/.test(cell("fails").failed[0].reason), JSON.stringify(cell("fails")?.failed));
  check("withTheAnswerThatFailedIt", /hello/i.test(cell("fails")?.output ?? ""), cell("fails")?.output);
  check("anAwkwardValueArrivesWhole", /second line/.test(cell("awkward")?.output ?? "") && /"quoted"/.test(cell("awkward").output), cell("awkward")?.output);
  check("aCheckInJavaScriptRuns", cell("code")?.pass === true, JSON.stringify(cell("code")));
  check("aTimeLimitCounts", cell("late")?.pass === false && cell("late").failed[0]?.type === "latency", JSON.stringify(cell("late")));
  check("theAiCanJudge", cell("judged")?.pass === true, JSON.stringify(cell("judged")));
  check("tokensAreCounted", done?.outputTokens > 0, JSON.stringify(done));
  check("theCountsAddUp", done?.passed + done?.failed + done?.errors === done?.cells.length);

  // Stop: it ends quickly, and nothing's left.
  const stopping = new AbortController();
  const many = { ...INPUT, grader: null, cases: Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, name: `Case ${index}`, values: { task: "Count slowly from 1 to 30." }, checks: [] })), columns: [{ ...column, maxTokens: 200 }] };
  const stopped = evals(many, { signal: stopping.signal }).catch(() => "aborted");
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const stopAt = Date.now();
  stopping.abort();
  await stopped;
  // The room's free again once it's really gone.
  let again = null;
  for (let tries = 0; tries < 30; tries += 1) {
    again = await evals({ ...INPUT, grader: null, cases: [INPUT.cases[3]] });
    if (!/already running/.test(again.error ?? "")) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check("stopFreesTheRoom", Boolean(again?.done), JSON.stringify(again).slice(0, 200));
  console.log(`      free again ${Math.round((Date.now() - stopAt) / 1000)} s after stopping`);
  createFileAtPath(doc, probe, 'ls -d /tmp/cc-eval-* 2>/dev/null | wc -l | sed "s/^/LEFT /"; pgrep -fc "promptfoo eval" | sed "s/^/PROCESSES /"\n', null);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const left = await runScript(probe);
  check("nothingIsLeftBehind", /LEFT 0/.test(left), left);
  check("noProcessIsLeftRunning", /PROCESSES 0/.test(left), left);
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  const node = findByPath(doc, probe);
  if (node) trash(doc, node.id);
  await new Promise((resolve) => setTimeout(resolve, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
