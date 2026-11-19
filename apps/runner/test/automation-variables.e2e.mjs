// A room's variables for its automations ({{variables.NAME}}, n8n's $vars), the whole way, in E2ETST's sandbox by Activepieces' real engine: an owner sets
// them, an editor sees them and can't change them, a step reads them both ways the engine has ({{variables.X}} and {{variables['X']}}), a changed value
// reaches the next run, one the room hasn't fails its step saying so, a browser can't hand a run variables of its own, and an error flow (queued by the
// worker, apart from the run that failed) gets them too. It removes what it made.
//   node --env-file=../../.env test/automation-variables.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
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

/** Someone signed in, with their own cookies. */
async function person(email) {
  const cookies = new Map();
  const call = async (path, { method = "GET", json } = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
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
  };
  const signedIn = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (signedIn.status !== 200) throw new Error(`sign-in ${email}: ${signedIn.status}`);
  return call;
}
const owner = await person("test1@codechatter.local");
const editor = await person("test2@codechatter.local");
const VARIABLES = `/api/rooms/${ROOM}/automations/variables`;
const automations = (body) => owner(`/api/rooms/${ROOM}/automations`, { method: "POST", json: body });

const doc = new Y.Doc();
const collab = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: collab, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const stamp = Date.now().toString(36);
const FOLDER = `variables-${stamp}`;
const NAME = `BASE_${stamp.toUpperCase()}`;
const OTHER = `ENV_${stamp.toUpperCase()}`;

async function finished(id, seconds = 120) {
  for (let i = 0; i < seconds * 2; i++) {
    const details = await automations({ op: "run-details", id });
    if (details.status === 200 && details.body.finishedAt) return details.body;
    await sleep(500);
  }
  return null;
}
async function runByHand(path, extra = {}) {
  const started = await automations({ op: "run", path, payload: {}, ...extra });
  return started.body?.id ? finished(started.body.id) : { status: "NOT STARTED", error: started.body };
}

try {
  // ---- Setting them: the owner, not an editor; names and sizes checked ----
  const set = await owner(`${VARIABLES}/${NAME}`, { method: "PUT", json: { value: "https://first.example" } });
  check("an owner sets one", set.status === 200 && set.body.name === NAME && set.body.value === "https://first.example" && Boolean(set.body.by), set);
  await owner(`${VARIABLES}/${OTHER}`, { method: "PUT", json: { value: "staging" } });
  const listed = await editor(VARIABLES);
  check("an editor sees them, values too: they aren't secrets", listed.status === 200 && listed.body.some((each) => each.name === NAME && each.value === "https://first.example"), listed);
  const editorSets = await editor(`${VARIABLES}/${NAME}`, { method: "PUT", json: { value: "https://evil.example" } });
  check("an editor can't change one", editorSets.status === 403 && /owners/.test(JSON.stringify(editorSets.body)), editorSets);
  const badName = await owner(`${VARIABLES}/has-dash`, { method: "PUT", json: { value: "x" } });
  check("a name a flow can't read is refused", badName.status === 400 && /letters, numbers and _/.test(JSON.stringify(badName.body)), badName);
  const tooLong = await owner(`${VARIABLES}/${NAME}`, { method: "PUT", json: { value: "x".repeat(4001) } });
  check("a value too long is refused", tooLong.status === 400, tooLong);

  // ---- Read by a step, both ways; a changed value; one the room hasn't ----
  const manifest = await automations({ op: "manifest" });
  const webhook = manifest.body.pieces["@activepieces/piece-webhook"];
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source, input, next = null) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const echo = "export const code = async (inputs) => inputs;\n";
  const trigger = (room, next) => ({ name: "trigger", type: "PIECE_TRIGGER", displayName: "When", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: webhook.version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {}, ...(room && { room }) }, nextAction: next });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };
  const READS = write("reads", { id: `flow_reads_${stamp}`, displayName: "Reads", schemaVersion: "27", trigger: trigger(null, code("read", echo, { base: `{{variables.${NAME}}}`, env: `{{variables['${OTHER}']}}`, both: `{{variables.${OTHER}}} at {{variables.${NAME}}}` })) });
  const MISSING = write("missing", { id: `flow_missing_${stamp}`, displayName: "Missing", schemaVersion: "27", trigger: trigger(null, code("read", echo, { nope: `{{variables.NOPE_${stamp.toUpperCase()}}}` })) });
  const HANDLER_ID = `flow_handler_${stamp}`;
  write("handler", { id: HANDLER_ID, displayName: "Handler", schemaVersion: "27", trigger: trigger({ event: "flow.failed" }, code("tell", echo, { base: `{{variables.${NAME}}}` })) });
  const FAILS = write("fails", { id: `flow_fails_${stamp}`, displayName: "Fails", schemaVersion: "27", errorFlow: HANDLER_ID, trigger: trigger(null, code("boom", 'export const code = async () => { throw new Error("on purpose"); };\n', {})) });
  await sleep(2000);

  const first = await runByHand(READS);
  const read = first?.steps?.read?.output ?? {};
  check("a step reads one as {{variables.NAME}}", first?.status === "SUCCEEDED" && read.base === "https://first.example", first?.failedStep ?? read);
  check("and as {{variables['NAME']}}, and inside text", read.env === "staging" && read.both === "staging at https://first.example", read);
  await owner(`${VARIABLES}/${NAME}`, { method: "PUT", json: { value: "https://second.example" } });
  const second = await runByHand(READS);
  check("a changed value reaches the next run", second?.steps?.read?.output?.base === "https://second.example", second?.steps?.read?.output);
  const smuggled = await runByHand(READS, { variables: { [NAME]: "https://evil.example" } });
  check("a browser can't hand a run variables of its own", smuggled?.steps?.read?.output?.base === "https://second.example", smuggled?.steps?.read?.output ?? smuggled);
  const missing = await runByHand(MISSING);
  check("one the room hasn't fails its step, saying so", missing?.status === "FAILED" && /not found/i.test(JSON.stringify(missing?.failedStep ?? missing?.message)), missing?.failedStep ?? missing);

  // ---- An error flow, queued by the worker, gets them too ----
  const failed = await runByHand(FAILS);
  const handled = failed?.errorRun ? await finished(failed.errorRun) : null;
  check("an error flow gets the room's variables", handled?.status === "SUCCEEDED" && handled?.steps?.tell?.output?.base === "https://second.example", { errorRun: failed?.errorRun, problem: failed?.errorProblem, handled: handled?.failedStep ?? handled?.steps?.tell });

  // ---- Removing one ----
  const removedByEditor = await editor(`${VARIABLES}/${OTHER}`, { method: "DELETE" });
  check("an editor can't remove one", removedByEditor.status === 403, removedByEditor);
  const removed = await owner(`${VARIABLES}/${OTHER}`, { method: "DELETE" });
  const after = await owner(VARIABLES);
  check("an owner removes one", removed.status === 200 && !after.body.some((each) => each.name === OTHER), { removed, after: after.body });
  const without = await runByHand(READS);
  check("and a run that reads it then fails, saying which", without?.status === "FAILED" && new RegExp(OTHER).test(JSON.stringify(without?.failedStep ?? without?.message)), without?.failedStep ?? without);
} catch (error) {
  check("no crash", false, error.stack ?? error.message);
} finally {
  for (const name of [NAME, OTHER]) await owner(`${VARIABLES}/${name}`, { method: "DELETE" }).catch(() => {});
  const folder = findByPath(doc, FOLDER);
  if (folder) trash(doc, folder.id);
  await sleep(1000);
  provider.destroy();
  collab.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
