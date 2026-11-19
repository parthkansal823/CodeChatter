// The internet for a room's automations, the whole way, on the real internet: the owner turns GitHub on, and a flow's HTTP step reaches api.github.com
// through the room's own proxy (and only through it: the sandbox has no other way out), while another site is refused with a reason; turned off, GitHub
// is refused too. Also: an editor can see what's on but not turn it on, and addresses, ports and private names can't be named. It turns it off again and
// removes what it made. A call to GitHub without a token counts against its limit of 60 an hour from this address; this makes one.
//   node --env-file=../../.env test/automation-internet.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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
const automations = (body) => owner(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });
const internetUrl = `/api/rooms/${ROOM}/automations/internet`;

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const stamp = Date.now().toString(36);
const FOLDER = `internet-test-${stamp}`;
let before = null;

async function finished(id) {
  for (let i = 0; i < 240; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function runByHand(path) {
  const started = await automations({ op: "run", path, payload: {} });
  return started.body?.id ? finished(started.body.id) : { status: "NOT STARTED", error: started.body };
}
const said = (run) => JSON.stringify(run?.steps?.fetch?.output ?? run?.steps?.fetch?.errorMessage ?? run?.message ?? run);

try {
  before = (await owner(internetUrl)).body;
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const http = manifest.body.pieces["@activepieces/piece-http"];
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const flowOf = (id, url) => ({
    id,
    displayName: "Ask the internet",
    schemaVersion: "27",
    trigger: {
      name: "trigger",
      type: "PIECE_TRIGGER",
      displayName: "When called",
      valid: true,
      settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} },
      nextAction: {
        name: "fetch",
        type: "PIECE",
        displayName: "Fetch",
        valid: true,
        skip: false,
        settings: { pieceName: "@activepieces/piece-http", pieceVersion: http.version, actionName: "send_request", input: { method: "GET", url, headers: { "user-agent": "codechatter-e2e" }, queryParams: {}, authType: "NONE", body_type: "none", failureMode: "all" }, propertySettings: {}, errorHandlingOptions: { continueOnFailure: { value: true }, retryOnFailure: { value: false } } },
        nextAction: null,
      },
    },
  });
  const GITHUB = `${FOLDER}/github.flow.json`;
  const OTHER = `${FOLDER}/other.flow.json`;
  createFileAtPath(doc, GITHUB, JSON.stringify(flowOf(`flow_github_${stamp}`, "https://api.github.com/zen"), null, 2));
  createFileAtPath(doc, OTHER, JSON.stringify(flowOf(`flow_other_${stamp}`, "https://example.com/"), null, 2));
  await sleep(1500);

  // ---- What can't be named, and who can turn it on ----
  const address = await owner(internetUrl, { method: "PUT", json: { services: [], hosts: ["10.0.0.1"] } });
  check("anAddressIsRefused", address.status === 400 && /name, not an address/.test(address.text), address.body);
  const local = await owner(internetUrl, { method: "PUT", json: { services: [], hosts: ["printer.local"] } });
  check("aPrivateNameIsRefused", local.status === 400 && /private name/.test(local.text), local.body);
  const editorOn = await editor(internetUrl, { method: "PUT", json: { services: ["@activepieces/piece-github"], hosts: [] } });
  check("anEditorCantTurnItOn", editorOn.status === 403 && /owners/.test(editorOn.text), editorOn.body);

  // ---- Off: nothing outside ----
  await owner(internetUrl, { method: "PUT", json: { services: [], hosts: [] } });
  const offRun = await runByHand(GITHUB);
  check("offTheRoomReachesNothing", !/"status":200/.test(said(offRun)) && /no internet|isn't one of the hosts|EAI_AGAIN|fetch failed|403/i.test(said(offRun)), said(offRun));

  // ---- GitHub on ----
  const on = await owner(internetUrl, { method: "PUT", json: { services: ["@activepieces/piece-github"], hosts: [] } });
  check("anOwnerTurnsGitHubOn", on.status === 200 && on.body.on.includes("api.github.com") && on.body.by, on.body);
  const editorSees = await editor(internetUrl);
  check("anEditorSeesWhatsOn", editorSees.status === 200 && editorSees.body.on.includes("api.github.com"), editorSees.body);
  const ran = await runByHand(GITHUB);
  const output = ran?.steps?.fetch?.output;
  check("aStepReachesGitHub", ran?.status === "SUCCEEDED" && output?.status === 200 && typeof output.body === "string" && output.body.length > 3, said(ran));
  const other = await runByHand(OTHER);
  check("butNotAnotherSite", !/"status":200/.test(said(other)) && /isn't one of the hosts this room may reach|403|fetch failed/i.test(said(other)), said(other));

  // ---- Off again ----
  const off = await owner(internetUrl, { method: "PUT", json: { services: [], hosts: [] } });
  check("itTurnsOff", off.status === 200 && off.body.on.length === 0, off.body);
  const afterRun = await runByHand(GITHUB);
  check("andGitHubIsRefusedAgain", !/"status":200/.test(said(afterRun)), said(afterRun));
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  // As it was before.
  await owner(internetUrl, { method: "PUT", json: { services: before?.services ?? [], hosts: before?.hosts ?? [] } }).catch(() => {});
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(800);
  check("itsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  collab.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
