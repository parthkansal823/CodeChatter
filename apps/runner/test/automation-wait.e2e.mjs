// Waiting, as n8n's Wait node, the whole way in E2ETST's sandbox with Activepieces' engine: a Delay pauses a run, the API's timer carries it on when its
// time comes (as the same run, from where it stopped), and a person can carry it on early; the webhook piece's "Respond and Wait for Next Webhook" pauses a
// run until its own address is called, as an approval's link is, and the caller waiting at /sync gets the run's answer; a wrong token and a second call find
// nothing; and a waitpoint's token never shows. It removes what it made.
//   node --env-file=../../.env test/automation-wait.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
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
const automations = (body) => call(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const FOLDER = `wait-test-${stamp}`;

/** A run once it's done what it's going to for now: finished, or waiting. */
async function settled(id, since = 0, seconds = 90) {
  for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(500)) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt && details.body.finishedAt >= since) return details.body;
  }
  return (await automations({ op: "run-details", id })).body;
}
const start = async (path) => (await automations({ op: "run", path, payload: { order: 7 } })).body?.id;

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const { pieces } = manifest.body;
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const piece = (name, pieceName, actionName, input, next = null) => ({ name, type: "PIECE", displayName: name, valid: true, skip: false, settings: { pieceName, pieceVersion: pieces[pieceName].version, actionName, input, propertySettings: {}, errorHandlingOptions: handling }, nextAction: next });
  const code = (name, source, input = {}) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: null });
  const flow = (id, name, first) => ({ id, displayName: name, schemaVersion: "27", trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: "When called", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: pieces["@activepieces/piece-webhook"].version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first } });
  const paths = { delay: `${FOLDER}/delay.flow.json`, long: `${FOLDER}/long.flow.json`, approval: `${FOLDER}/approval.flow.json`, links: `${FOLDER}/links.flow.json` };
  // Waits 25 seconds (over the 10 a Delay keeps to itself), then says it's done, with what started it.
  createFileAtPath(doc, paths.delay, JSON.stringify(flow(`flow_delay_${stamp}`, "Waits a little", piece("pause", "@activepieces/piece-delay", "delayFor", { delayFor: 25, unit: "seconds" }, code("after", "export const code = async (inputs) => ({ done: true, order: inputs.order });", { order: "{{trigger.output.body.order}}" }))), null, 2));
  createFileAtPath(doc, paths.long, JSON.stringify(flow(`flow_long_${stamp}`, "Waits an hour", piece("pause", "@activepieces/piece-delay", "delayFor", { delayFor: 1, unit: "hours" }, code("after", "export const code = async () => ({ done: true });"))), null, 2));
  // Answers its caller, then waits for its next call (an approval's link), and says what was decided.
  createFileAtPath(doc, paths.approval, JSON.stringify(flow(`flow_approval_${stamp}`, "Asks for approval", piece("ask", "@activepieces/piece-webhook", "return_response_and_wait_for_next_webhook", { responseType: "json", fields: { status: 200, body: { asked: true } } }, code("decide", "export const code = async (inputs) => ({ decision: inputs.decision, by: inputs.by });", { decision: "{{ask.output.queryParams.action}}", by: "{{ask.output.queryParams.by}}" }))), null, 2));
  // Approval links, sent (here, kept) before the run waits for one to be clicked.
  const linksStep = { name: "links", type: "CODE", displayName: "Approval links", valid: true, skip: false, builtin: "approval_links", settings: { sourceCode: { code: "export const code = async () => null;", packageJson: "{}" }, input: { choices: "approve, reject" }, errorHandlingOptions: handling }, nextAction: null };
  createFileAtPath(doc, paths.links, JSON.stringify(flow(`flow_links_${stamp}`, "Approval by link", { ...linksStep, nextAction: piece("ask", "@activepieces/piece-webhook", "return_response_and_wait_for_next_webhook", { responseType: "json", fields: { status: 200, body: { asked: true } } }, code("decide", "export const code = async (inputs) => ({ decision: inputs.decision });", { decision: "{{ask.output.queryParams.action}}" })) }), null, 2));
  await sleep(1500);

  // ---- A Delay pauses the run; the API's timer carries it on when its time comes ----
  const delayId = await start(paths.delay);
  const paused = await settled(delayId);
  check("aDelayPausesTheRun", paused?.status === "PAUSED" && paused.waitpoint?.type === "DELAY" && paused.waitpoint.step === "pause", paused);
  check("itSaysUntilWhen", Math.abs((paused?.waitpoint?.resumeAt ?? 0) - (paused?.startedAt ?? 0) - 25_000) < 10_000, { resumeAt: paused?.waitpoint?.resumeAt, startedAt: paused?.startedAt });
  check("itsTokenNeverShows", paused?.waitpoint && !("token" in paused.waitpoint) && !JSON.stringify((await automations({ op: "runs", path: paths.delay })).body).includes('"token"'), paused?.waitpoint);
  const waits = (await automations({ op: "waits" })).body.waits ?? [];
  check("theRoomSaysWhatsWaiting", waits.some((wait) => wait.id === delayId && wait.type === "DELAY"), waits);
  const carried = await settled(delayId, (paused?.waitpoint?.resumeAt ?? Date.now()) - 1000, 120);
  check("itCarriesOnByItselfWhenItsTimeComes", carried?.status === "SUCCEEDED" && carried.mode === "resume" && carried.id === delayId, { status: carried?.status, mode: carried?.mode });
  check("fromWhereItStopped", carried?.steps?.after?.output?.done === true && carried.steps.after.output.order === 7 && carried.steps.pause?.output?.success === true, carried?.steps);
  check("notTooLate", (carried?.finishedAt ?? 0) - (paused?.waitpoint?.resumeAt ?? 0) < 60_000, { finishedAt: carried?.finishedAt, resumeAt: paused?.waitpoint?.resumeAt });

  // ---- A person can carry one on early ----
  const longId = await start(paths.long);
  const longPaused = await settled(longId);
  check("anHoursWaitPauses", longPaused?.status === "PAUSED", longPaused?.status);
  const early = Date.now();
  const resumed = await automations({ op: "resume", id: longId });
  const longDone = await settled(longId, early);
  check("aPersonCanCarryItOnNow", resumed.status === 200 && longDone?.status === "SUCCEEDED" && longDone.steps?.after?.output?.done === true, { resumed, status: longDone?.status });
  const again = await automations({ op: "resume", id: longId });
  check("butOnlyOnce", again.status === 409 && /isn't waiting/.test(JSON.stringify(again.body)), again);

  // ---- Waiting for a call: an approval's link ----
  const approvalId = await start(paths.approval);
  const asking = await settled(approvalId);
  const link = asking?.steps?.ask?.output?.nextWebhookUrl;
  check("itWaitsForACall", asking?.status === "PAUSED" && asking.waitpoint?.type === "WEBHOOK" && typeof link === "string" && link.includes(`/api/hooks/automations/resume/${ROOM}/${approvalId}/`) && link.includes("/sync"), { status: asking?.status, link });
  const local = (link ?? "").replace(/^https?:\/\/[^/]+/, BASE);
  const forged = await fetch(local.replace(/\/[A-Za-z0-9_-]{20,64}\/sync/, `/${"x".repeat(32)}/sync`), { signal: AbortSignal.timeout(30_000) });
  check("aWrongTokenFindsNothing", forged.status === 404, forged.status);
  const approved = await fetch(`${local}&action=approve&by=Ana`, { signal: AbortSignal.timeout(60_000) });
  const answer = await approved.json().catch(() => null);
  check("callingItCarriesItOnWithWhatWasSent", approved.status === 200 && answer?.decision === "approve" && answer?.by === "Ana", { status: approved.status, answer });
  const approvalDone = await settled(approvalId);
  check("andTheRunFinishes", approvalDone?.status === "SUCCEEDED" && approvalDone.steps?.decide?.output?.decision === "approve", approvalDone?.status);
  const second = await fetch(`${local}&action=reject`, { signal: AbortSignal.timeout(30_000) });
  check("aSecondCallFindsNothing", second.status === 404, second.status);
  // ---- Approval links: made before the wait, so they can be sent; clicking one in a browser carries the run on ----
  const linksId = await start(paths.links);
  const waiting = await settled(linksId);
  const links = waiting?.steps?.links?.output;
  check("approvalLinksAreMadeBeforeTheWait", waiting?.status === "PAUSED" && waiting.waitpoint?.type === "WEBHOOK" && typeof links?.approve === "string" && links.approve.includes(`/api/hooks/automations/resume/${ROOM}/${linksId}/`) && links.approve.endsWith("?action=approve") && links.reject.endsWith("?action=reject"), { status: waiting?.status, links });
  const clickedAt = Date.now();
  const clicked = await fetch(links.approve.replace(/^https?:\/\/[^/]+/, BASE), { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  const thanks = await clicked.text();
  check("clickingOneInABrowserSaysThanks", clicked.status === 200 && /text\/html/.test(clicked.headers.get("content-type") ?? "") && /Thanks/.test(thanks) && /\(approve\)/.test(thanks), { status: clicked.status, thanks: thanks.slice(0, 200) });
  const linksDone = await settled(linksId, clickedAt);
  check("andTheRunCarriesOnWithTheChoice", linksDone?.status === "SUCCEEDED" && linksDone.steps?.decide?.output?.decision === "approve", linksDone?.status);
  const late = await fetch(links.reject.replace(/^https?:\/\/[^/]+/, BASE), { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  check("theOtherLinkThenSaysNothingsWaiting", late.status === 404 && /Nothing is waiting here/.test(await late.text()), late.status);

  // What the step answers its caller with is kept with it.
  const hookAnswer = await automations({ op: "run-details", id: approvalId });
  check("theStepKeptWhatToAnswer", JSON.stringify(hookAnswer.body?.steps?.ask?.input?.fields?.body ?? null) === JSON.stringify({ asked: true }), hookAnswer.body?.steps?.ask?.input);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
