// Automations started by a webhook, the whole way: turned on through the API, called at its address from outside, and run by Activepieces' engine in E2ETST's
// sandbox. Its test address, answering when the flow finishes, forms and text, turning it off, a new address, a moved file, a wrong address, too many calls, and
// who may turn it on. It turns off and removes what it made.
//   node --env-file=../../.env test/automation-hooks.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, rename, trash } from "@codechatter/workspace-model";
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
/** A call from outside: no cookies, as GitHub or a CI would make it. */
async function hook(url, { method = "POST", body, type = "application/json", headers = {} } = {}) {
  const response = await fetch(url, { method, headers: { ...(body !== undefined && { "content-type": type }), ...headers }, body: body === undefined ? undefined : type === "application/json" ? JSON.stringify(body) : body, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  let json = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: response.status, body: json };
}

const owner = await signIn("test1@codechatter.local");
const editor = await signIn("test2@codechatter.local");
const automations = (call, body) => call(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
async function finished(id) {
  for (let i = 0; i < 120; i++) {
    const details = await automations(owner, { op: "run-details", id });
    if (details.status === 200) return details.body;
    await sleep(500);
  }
  return null;
}

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const FOLDER = `hooks-test-${stamp}`;
const PATH = `${FOLDER}/echo.flow.json`;
const FLOW_ID = `flow_hook_${stamp}`;
let triggerId = null;

try {
  const manifest = await automations(owner, { op: "manifest" });
  const webhookVersion = manifest.body.pieces["@activepieces/piece-webhook"].version;
  // Doubles what it's sent, and says what else came with it.
  const flow = {
    id: FLOW_ID,
    displayName: "Echo",
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: "When called",
      valid: true,
      settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhookVersion, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} },
      nextAction: {
        name: "echo",
        type: "CODE",
        displayName: "Echo",
        valid: true,
        skip: false,
        settings: {
          sourceCode: { code: "export const code = async (inputs) => ({ doubled: Number(inputs.body?.value) * 2, q: inputs.query?.q ?? null, header: inputs.headers?.['x-test'] ?? null, body: inputs.body });", packageJson: "{}" },
          input: { body: "{{trigger.output.body}}", query: "{{trigger.output.queryParams}}", headers: "{{trigger.output.headers}}" },
          errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } },
        },
        nextAction: null,
      },
    },
  };
  createFileAtPath(doc, PATH, JSON.stringify(flow, null, 2));
  await sleep(1500);

  // ---- Turning it on ----
  const made = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "webhook", respond: "finished" } });
  check("itTurnsOn", made.status === 201 || made.status === 200, made.body);
  triggerId = made.body?.id;
  const url = made.body?.url;
  check("itGetsAnAddress", typeof url === "string" && url.includes(`/api/hooks/automations/${ROOM}/`) && made.body.testUrl === `${url}/test`, made.body);
  const twice = await owner(`/api/rooms/${ROOM}/automations/triggers`, { method: "POST", json: { path: PATH, flowId: FLOW_ID, kind: "webhook" } });
  check("aFlowIsntTurnedOnTwice", twice.status === 409, twice.body);
  const listed = await editor(`/api/rooms/${ROOM}/automations/triggers`);
  check("someoneWhoCanRunSeesIt", listed.status === 200 && listed.body.some((each) => each.id === triggerId && each.url === url), listed.body);
  const local = url.replace(/^https?:\/\/[^/]+/, BASE);

  // ---- The test address shows what was sent, and runs nothing ----
  const runsBefore = (await automations(owner, { op: "runs", path: PATH })).body.runs.length;
  const tested = await hook(`${local}/test`, { body: { hello: "test" }, headers: { "x-test": "yes" } });
  check("theTestAddressAnswers", tested.status === 200 && tested.body.test === true, tested.body);
  const event = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}/test-event`);
  check("whatTheTestAddressWasSentCanBeSeen", event.status === 200 && event.body?.body?.hello === "test" && event.body.method === "POST" && event.body.headers["x-test"] === "yes", event.body);
  check("itsCookiesArentKept", !Object.keys(event.body?.headers ?? {}).includes("cookie"));
  await sleep(1000);
  check("theTestAddressRunsNothing", (await automations(owner, { op: "runs", path: PATH })).body.runs.length === runsBefore);

  // ---- The live address runs it, and answers when it finishes ----
  const live = await hook(`${local}?q=found`, { body: { value: 21 }, headers: { "x-test": "on" } });
  check("calledFromOutsideItRuns", live.status === 200 && live.body?.doubled === 42, live);
  check("itGetsTheQueryAndHeaders", live.body?.q === "found" && live.body?.header === "on", live.body);
  const runs = (await automations(owner, { op: "runs", path: PATH })).body.runs;
  check("theRunSaysAWebhookStartedIt", runs[0]?.trigger === "webhook" && runs[0]?.by === "Webhook", runs[0]);
  const listedAfter = await owner(`/api/rooms/${ROOM}/automations/triggers`);
  check("itSaysWhenItWasLastCalled", listedAfter.body.find((each) => each.id === triggerId)?.lastRunId === runs[0]?.id, listedAfter.body);

  // ---- Answering at once, and forms and text ----
  await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { respond: "now" } });
  const quick = await hook(local, { body: { value: 1 } });
  check("itCanAnswerAtOnce", quick.status === 202 && typeof quick.body?.id === "string", quick);
  const quickRun = await finished(quick.body?.id);
  check("andStillRuns", quickRun?.status === "SUCCEEDED" && quickRun.steps.echo?.output?.doubled === 2, quickRun?.status);
  const form = await hook(local, { body: "value=5", type: "application/x-www-form-urlencoded" });
  const formRun = await finished(form.body?.id);
  check("aFormIsRead", formRun?.steps.echo?.output?.doubled === 10, formRun?.steps.echo?.output);
  const plain = await hook(local, { body: "just words", type: "text/plain" });
  const plainRun = await finished(plain.body?.id);
  check("plainTextIsKept", plainRun?.steps.echo?.output?.body === "just words", plainRun?.steps.echo?.output);
  const got = await hook(`${local}?value=3`, { method: "GET" });
  check("anyMethodIsTaken", got.status === 202, got);

  // ---- Off, a new address, a moved file, and addresses that aren't ----
  await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { enabled: false } });
  const off = await hook(local, { body: { value: 1 } });
  check("turnedOffItDoesntRun", off.status === 409, off);
  await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { enabled: true } });
  const rotated = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}/rotate`, { method: "POST" });
  const fresh = rotated.body?.url?.replace(/^https?:\/\/[^/]+/, BASE);
  check("aNewAddressIsMade", rotated.status === 200 || rotated.status === 201, rotated.body);
  const old = await hook(local, { body: { value: 1 } });
  check("theOldAddressStopsWorking", old.status === 404, old);
  rename(doc, findByPath(doc, PATH).id, "moved.flow.json");
  await sleep(1500);
  const moved = await hook(fresh, { body: { value: 4 } });
  const movedRun = await finished(moved.body?.id);
  check("aMovedFlowIsStillFound", movedRun?.status === "SUCCEEDED" && movedRun.path === `${FOLDER}/moved.flow.json` && movedRun.steps.echo?.output?.doubled === 8, movedRun ?? moved);
  const wrong = await hook(`${BASE}/api/hooks/automations/${ROOM}/${"x".repeat(32)}`, { body: {} });
  check("aWrongAddressFindsNothing", wrong.status === 404, wrong);
  const otherRoom = await hook(fresh.replace(`/${ROOM}/`, "/TEAM22/"), { body: {} });
  check("anotherRoomsAddressFindsNothing", otherRoom.status === 404, otherRoom);
  const outsider = await fetch(`${BASE}/api/rooms/${ROOM}/automations/triggers`).then((response) => response.status);
  check("someoneSignedOutCantSeeThem", outsider === 401, outsider);

  // ---- Who may call it: a signature of the body, a header, basic auth ----
  const { createHmac } = await import("node:crypto");
  const setAuth = (auth) => owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "PATCH", json: { auth } });
  const signed = await setAuth({ kind: "signature", secret: "shared webhook secret" });
  check("aSignatureCanBeAskedFor", signed.status === 200 && signed.body.auth?.kind === "signature" && signed.body.auth.header === "x-hub-signature-256" && !JSON.stringify(signed.body).includes("shared webhook secret"), signed.body);
  const bodyText = JSON.stringify({ value: 6 });
  const signature = `sha256=${createHmac("sha256", "shared webhook secret").update(bodyText).digest("hex")}`;
  const unsigned = await hook(fresh, { body: { value: 6 } });
  check("anUnsignedCallIsRefused", unsigned.status === 401 && /x-hub-signature-256 header is missing/.test(JSON.stringify(unsigned.body)), unsigned);
  const forged = await hook(fresh, { body: { value: 7 }, headers: { "x-hub-signature-256": signature } });
  check("aSignatureForAnotherBodyIsRefused", forged.status === 401 && /doesn't match the body/.test(JSON.stringify(forged.body)), forged);
  const good = await fetch(fresh, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: bodyText, signal: AbortSignal.timeout(60_000) });
  const goodRun = await finished((await good.json()).id);
  check("aSignedCallRuns", good.status === 202 && goodRun?.steps.echo?.output?.doubled === 12, { status: good.status, run: goodRun?.status });
  const testedUnsigned = await hook(`${fresh}/test`, { body: { value: 1 } });
  const testEvent = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}/test-event`);
  check("theTestAddressSaysItWouldBeRefused", testedUnsigned.status === 200 && testedUnsigned.body.authorized === false && testEvent.body?.authorized === false && /missing/.test(testEvent.body?.why ?? ""), testEvent.body);
  await setAuth({ kind: "header", header: "X-Api-Key", value: "key-1234567890" });
  check("aHeaderCanBeAskedFor", (await hook(fresh, { body: { value: 1 }, headers: { "x-api-key": "wrong-key-value" } })).status === 401 && (await hook(fresh, { body: { value: 1 }, headers: { "x-api-key": "key-1234567890" } })).status === 202);
  await setAuth({ kind: "basic", user: "ci", password: "a long password" });
  const basic = (password) => ({ authorization: `Basic ${Buffer.from(`ci:${password}`).toString("base64")}` });
  check("basicAuthCanBeAskedFor", (await hook(fresh, { body: { value: 1 }, headers: basic("guess") })).status === 401 && (await hook(fresh, { body: { value: 1 }, headers: basic("a long password") })).status === 202);
  const tooShort = await setAuth({ kind: "header", header: "X-Api-Key", value: "short" });
  check("aShortSecretIsRefused", tooShort.status === 400, tooShort);
  await setAuth({ kind: "none" });
  check("andItCanGoBackToTheAddressAlone", (await hook(fresh, { body: { value: 1 } })).status === 202);

  // ---- Too many calls ----
  let limited = 0;
  for (let i = 0; i < 70 && !limited; i++) if ((await hook(`${fresh}/test`, { body: { i } })).status === 429) limited = i + 1;
  check("tooManyCallsAreRefused", limited > 0 && limited <= 62, limited);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  if (triggerId) {
    const removed = await owner(`/api/rooms/${ROOM}/automations/triggers/${triggerId}`, { method: "DELETE" });
    check("itsTurnedOffAndForgotten", removed.status === 204, removed.body);
    const gone = await owner(`/api/rooms/${ROOM}/automations/triggers`);
    check("itsNoLongerListed", !gone.body.some((each) => each.id === triggerId));
  }
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(600);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
