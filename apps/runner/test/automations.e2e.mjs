// Automations for real, in E2ETST: flows in the room's files, run by Activepieces' real engine and pieces inside the jail with no network, and no Activepieces server. Code
// steps, a router, a loop, the real HTTP, text and store pieces, a step that fails, retries, TypeScript, what's kept, a queue, stopping, a timeout, and what a flow or a request
// can't do. The test's files and everything the runs kept are removed.
//   node --env-file=../../.env test/automations.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, setFileText, trash } from "@codechatter/workspace-model";
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 800)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const token = (room = ROOM) => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: room, uid: "e2e-user", name: "E2E Tester" })}`;
const ask = async (body) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/automations`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  return { status: response.status, body: await response.json() };
};

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const vector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function shell(text, wait = true) {
  const path = `auto-${stamp}-${(scripts += 1)}.sh`;
  createFileAtPath(doc, path, text);
  await sleep(1000);
  const request = fetch(`${RUNNER}/rooms/${ROOM}/runs`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ path, stateVector: vector() }), signal: AbortSignal.timeout(90_000) });
  if (!wait) return path;
  const response = await request;
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data;
    }
  }
  const node = findByPath(doc, path);
  if (node) trash(doc, node.id);
  return output;
}

const stamp = Date.now().toString(36);
let scripts = 0;
const FOLDER = `auto-test-${stamp}`;
const inFolder = (name) => `${FOLDER}/${name}.flow.json`;
const write = (path, flow) => {
  const text = typeof flow === "string" ? flow : JSON.stringify(flow, null, 2);
  const node = findByPath(doc, path);
  if (node) setFileText(doc, node.id, text);
  else createFileAtPath(doc, path, text);
};

// Steps, in Activepieces' own format.
const webhook = (next, version) => ({ name: "trigger", type: "PIECE_TRIGGER", displayName: "Catch webhook", valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: version, triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: next });
const code = (name, source, input = {}, next = null, handling = {}) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false }, ...handling } }, nextAction: next });
const piece = (name, pieceName, version, actionName, input, next = null) => ({ name, type: "PIECE", displayName: name, valid: true, skip: false, settings: { pieceName, pieceVersion: version, actionName, input, propertySettings: {}, errorHandlingOptions: { continueOnFailure: { value: false }, retryOnFailure: { value: false } } }, nextAction: next });
const router = (name, condition, big, small, next = null) => ({ name, type: "ROUTER", displayName: name, valid: true, skip: false, settings: { executionType: "EXECUTE_FIRST_MATCH", branches: [{ branchName: "Big", branchType: "CONDITION", conditions: [[condition]] }, { branchName: "Otherwise", branchType: "FALLBACK" }] }, children: [big, small], nextAction: next });
const loop = (name, items, inside, next = null) => ({ name, type: "LOOP_ON_ITEMS", displayName: name, valid: true, skip: false, settings: { items }, firstLoopAction: inside, nextAction: next });
const flow = (displayName, trigger) => ({ displayName, schemaVersion: "27", trigger });

async function runToEnd(path, payload, extra = {}) {
  const started = await ask({ op: "run", path, payload, stateVector: vector(), ...extra });
  if (started.status !== 200) return { started };
  const id = started.body.id;
  for (let i = 0; i < 120; i++) {
    const details = await ask({ op: "run-details", id });
    if (details.status === 200) return { started, run: details.body };
    await sleep(500);
  }
  return { started, run: null };
}

try {
  await shell(`rm -rf "$HOME/automations"; echo CLEAN\n`);

  // ---- What's available ----
  const manifest = await ask({ op: "manifest" });
  const pieces = manifest.body.pieces ?? {};
  const names = Object.keys(pieces);
  check("theImageHasThePieces", manifest.status === 200 && names.length >= 40, names.length);
  const versionOf = (name) => pieces[`@activepieces/piece-${name}`]?.version;
  check("includingWhatCodingNeeds", ["github", "gitlab", "slack", "discord", "http", "webhook", "schedule", "openai", "jira-cloud", "linear"].every((name) => versionOf(name)), names);
  const send = pieces["@activepieces/piece-http"]?.actions?.send_request;
  check("eachStepSaysWhatItNeeds", send?.fields?.url?.required === true && send?.fields?.method?.type && send?.label, send);
  check("includingChoices", Array.isArray(send?.fields?.method?.options) && send.fields.method.options.some((option) => option.value === "POST"), send?.fields?.method);
  const github = pieces["@activepieces/piece-github"];
  check("realActionsForGithub", Object.keys(github?.actions ?? {}).length >= 5 && Object.keys(github?.triggers ?? {}).length >= 1 && github?.auth !== null, Object.keys(github?.actions ?? {}));
  const webhookVersion = versionOf("webhook");
  const httpVersion = versionOf("http");
  const textVersion = versionOf("text-helper");
  const storeVersion = versionOf("store");

  // ---- A server in the room, for the HTTP piece to reach ----
  const port = 4100 + Math.floor(Math.random() * 800);
  await shell(`node -e "require('http').createServer((q,s)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({got:JSON.parse(b||'{}'),from:q.headers['x-from'],url:q.url}))})}).listen(${port});setTimeout(()=>process.exit(),150000)"\n`, false);
  await sleep(1500);

  // ---- A whole flow ----
  const MAIN = inFolder("main");
  write(
    MAIN,
    flow(
      "Main",
      webhook(
        code(
          "double",
          "export const code = async (inputs) => ({ doubled: inputs.n * 2, items: [1, 2, 3] });",
          { n: "{{trigger.output.body.n}}" },
          router(
            "size",
            { operator: "NUMBER_IS_GREATER_THAN", firstValue: "{{double.output.doubled}}", secondValue: "10", caseSensitive: false },
            code("big", "export const code = async (inputs) => ({ branch: 'big', value: inputs.value });", { value: "{{double.output.doubled}}" }),
            code("small", "export const code = async () => ({ branch: 'small' });"),
            loop(
              "each",
              "{{double.output.items}}",
              code("one", "export const code = async (inputs) => ({ seen: inputs.item * 10 });", { item: "{{each.output.item}}" }),
              piece(
                "call",
                "@activepieces/piece-http",
                httpVersion,
                "send_request",
                { method: "POST", url: `http://127.0.0.1:${port}/echo`, headers: { "x-from": "flow" }, queryParams: { a: "1" }, authType: "NONE", authFields: {}, body_type: "json", body: { data: { doubled: "{{double.output.doubled}}" } }, use_proxy: false, proxy_settings: {}, response_is_binary: false, timeout: 10, failureMode: "continue_none" },
                piece(
                  "upper",
                  "@activepieces/piece-text-helper",
                  textVersion,
                  "replace",
                  { text: "hello world", searchValue: "world", replaceValue: "{{big.output.branch}}", replaceOnlyFirst: false },
                  code("fails", "export const code = async () => { throw new Error('broken on purpose'); };", {}, code("after", "export const code = async () => ({ ran: true });"), { continueOnFailure: { value: true } }),
                ),
              ),
            ),
          ),
        ),
        webhookVersion,
      ),
    ),
  );

  const started = Date.now();
  const main = await runToEnd(MAIN, { n: 21 });
  console.log(`      a whole flow took ${Math.round((Date.now() - started) / 100) / 10} s, ${main.run?.durationMs} ms in the engine`);
  const steps = main.run?.steps ?? {};
  check("aRunStarts", main.started.status === 200 && Boolean(main.started.body.id), main.started.body);
  check("andFinishes", main.run?.status === "SUCCEEDED", main.run);
  check("itSaysWhoAndHow", main.run?.by === "E2E Tester" && main.run?.trigger === "manual" && main.run?.name === "Main" && main.run?.path === MAIN, main.run);
  check("theTriggerHasWhatWasSent", steps.trigger?.output?.body?.n === 21, steps.trigger);
  check("aCodeStepWorksItOut", steps.double?.status === "SUCCEEDED" && steps.double?.output?.doubled === 42 && steps.double?.input?.n === 21, steps.double);
  check("theRouterTakesTheRightBranch", steps.big?.output?.branch === "big" && steps.big?.output?.value === 42 && !steps.small, { big: steps.big, small: steps.small });
  check("itSaysWhichItChose", steps.size?.output?.branches?.[0]?.evaluation === true && steps.size?.output?.branches?.[1]?.evaluation === false, steps.size);
  const iterations = steps.each?.output?.iterations ?? [];
  check("theLoopGoesRound", iterations.length === 3 && iterations.map((item) => item.one?.output?.seen).join() === "10,20,30", iterations);
  check("theRealHttpPieceSends", steps.call?.status === "SUCCEEDED" && steps.call?.output?.status === 200 && steps.call?.output?.body?.got?.doubled === 42, steps.call);
  check("withItsHeadersAndQuery", steps.call?.output?.body?.from === "flow" && /a=1/.test(steps.call?.output?.body?.url ?? ""), steps.call?.output?.body);
  check("anotherRealPieceWorks", steps.upper?.status === "SUCCEEDED" && JSON.stringify(steps.upper?.output).includes("hello big"), steps.upper);
  check("aStepAllowedToFailSaysSo", steps.fails?.status === "FAILED" && /broken on purpose/.test(steps.fails?.errorMessage ?? ""), steps.fails);
  check("andTheFlowGoesOn", steps.after?.output?.ran === true, steps.after);

  // ---- The other branch ----
  const small = await runToEnd(MAIN, { n: 1 });
  check("theOtherBranchRunsForOtherData", small.run?.steps?.small?.output?.branch === "small" && !small.run?.steps?.big, small.run?.steps?.size);

  // ---- A step that fails ----
  const BROKEN = inFolder("broken");
  write(BROKEN, flow("Broken", webhook(code("first", "export const code = async () => { throw new Error('this one stops it'); };", {}, code("never", "export const code = async () => ({ ran: true });")), webhookVersion)));
  const broken = await runToEnd(BROKEN, {});
  check("aFailingStepFailsTheRun", broken.run?.status === "FAILED", broken.run);
  check("sayingWhichAndWhy", broken.run?.failedStep?.name === "first" && /this one stops it/.test(broken.run?.steps?.first?.errorMessage ?? ""), broken.run?.failedStep);
  check("andWhatsAfterItDoesntRun", !broken.run?.steps?.never);

  // ---- Retries, from the engine ----
  const RETRY = inFolder("retry");
  const counter = `/tmp/auto-retry-${stamp}`;
  write(RETRY, flow("Retry", webhook(code("flaky", `import { existsSync, writeFileSync } from "node:fs";\nexport const code = async () => {\n  if (!existsSync("${counter}")) { writeFileSync("${counter}", "1"); throw new Error("first time"); }\n  return { recovered: true };\n};`, {}, null, { retryOnFailure: { value: true } }), webhookVersion)));
  const retried = await runToEnd(RETRY, {});
  check("aStepCanRetry", retried.run?.status === "SUCCEEDED" && retried.run?.steps?.flaky?.output?.recovered === true, retried.run?.steps?.flaky ?? retried.run);

  // ---- TypeScript, and what's kept ----
  const TYPED = inFolder("typed");
  write(TYPED, flow("Typed", webhook(code("typed", "export const code = async (inputs: { n: number }): Promise<{ n: number }> => { const x: number = inputs.n + 1; return { n: x }; };", { n: "{{trigger.output.body.n}}" }), webhookVersion)));
  const typed = await runToEnd(TYPED, { n: 1 });
  check("codeStepsCanBeTypeScript", typed.run?.steps?.typed?.output?.n === 2, typed.run?.steps?.typed ?? typed.run);

  const STORE = inFolder("store");
  write(STORE, flow("Store", webhook(piece("save", "@activepieces/piece-store", storeVersion, "put", { key: "visits", value: "{{trigger.output.body.value}}", store_scope: "COLLECTION" }, piece("load", "@activepieces/piece-store", storeVersion, "get", { key: "visits", store_scope: "COLLECTION" })), webhookVersion)));
  const stored = await runToEnd(STORE, { value: `kept-${stamp}` });
  check("aPieceCanKeepValues", JSON.stringify(stored.run?.steps?.load?.output ?? "").includes(`kept-${stamp}`), stored.run?.steps ?? stored.run);

  // ---- The queue ----
  const QUEUED = inFolder("queued");
  write(QUEUED, flow("Queued", webhook(code("wait", "export const code = async (inputs) => { await new Promise((r) => setTimeout(r, 400)); return { n: inputs.n, at: Date.now() }; };", { n: "{{trigger.output.body.n}}" }), webhookVersion)));
  const three = await Promise.all([1, 2, 3].map((n) => runToEnd(QUEUED, { n })));
  check("runsAskedForTogetherAllFinish", three.every((item) => item.run?.status === "SUCCEEDED"), three.map((item) => item.run?.status));
  const windows = three.map((item) => [item.run.startedAt, item.run.finishedAt]).sort((a, b) => a[0] - b[0]);
  check("oneAtATime", windows.every((window, i) => !i || window[0] >= windows[i - 1][1] - 50), windows);

  // ---- Stopping, and too long ----
  const SLOW = inFolder("slow");
  write(SLOW, flow("Slow", webhook(code("sleep", "export const code = async () => { await new Promise((r) => setTimeout(r, 600000)); return {}; };"), webhookVersion)));
  const slow = await ask({ op: "run", path: SLOW, payload: {}, stateVector: vector() });
  let live = {};
  for (let i = 0; i < 40; i++) {
    live = (await ask({ op: "status" })).body;
    if (live.state === "running" && live.id === slow.body.id) break;
    await sleep(250);
  }
  check("whatsRunningCanBeSeen", live.state === "running" && live.path === SLOW, live);
  const stopAsked = await ask({ op: "stop" });
  check("itCanBeStopped", stopAsked.status === 200, stopAsked.body);
  let stoppedRun = null;
  for (let i = 0; i < 30 && !stoppedRun; i++) {
    const details = await ask({ op: "run-details", id: slow.body.id });
    if (details.status === 200) stoppedRun = details.body;
    else await sleep(500);
  }
  check("andItStops", stoppedRun?.status === "STOPPED", stoppedRun);
  const noStop = await ask({ op: "stop" });
  check("stoppingNothingSaysSo", noStop.status === 422, noStop.body);

  const timedOut = await runToEnd(SLOW, {}, { seconds: 5 });
  check("aRunThatTakesTooLongIsStopped", timedOut.run?.status === "TIMEOUT" && /still running after 5 seconds/.test(timedOut.run?.message ?? ""), timedOut.run);
  await sleep(1500);
  const leftovers = await shell(`pgrep -fc "engine/main.js" || true; pgrep -fc "automation/host.mjs" || true; ls "$HOME/automations/queue" | wc -l; ls "$HOME/automations/codes" 2>/dev/null | wc -l; ls "$HOME/automations/worker" >/dev/null 2>&1 && echo LOCKED || echo FREE\n`);
  check("nothingIsLeftRunning", /^0\n0\n0\n0\nFREE/.test(leftovers.replace(/\r/g, "")), leftovers);

  // ---- What's kept ----
  const history = await ask({ op: "runs" });
  check("runsAreKeptNewestFirst", history.body.runs.length >= 9 && history.body.runs.every((item, i, all) => !i || all[i - 1].id >= item.id), history.body.runs?.map((item) => item.id));
  const ofOne = await ask({ op: "runs", path: BROKEN });
  check("orJustOneFlows", ofOne.body.runs.length === 1 && ofOne.body.runs[0].status === "FAILED", ofOne.body);
  check("withoutTheirDataInTheList", !JSON.stringify(ofOne.body).includes("this one stops it") || ofOne.body.runs[0].message !== undefined);
  const inFiles = await shell(`cd "/workspace/${FOLDER}" && find . -type f | grep -v flow.json | wc -l\n`);
  check("nothingARunKeepsIsInTheRoomsFiles", /^0/.test(inFiles.trim()), inFiles);
  check("norInTheTree", !flatten(listTree(doc)).some((node) => node.path.startsWith(`${FOLDER}/`) && !node.path.endsWith(".flow.json") && node.kind === "file"));

  // ---- What a flow can't do ----
  const OUTSIDE = inFolder("outside");
  write(OUTSIDE, flow("Outside", webhook(code("look", `import { readFileSync, readdirSync } from "node:fs";\nexport const code = async () => {\n  const tries = {};\n  for (const path of ["/opt/ccagent/agent.mjs", "/root", "/var/lib"]) { try { tries[path] = readdirSync(path).length; } catch (e) { tries[path] = e.code; } }\n  let network = "none";\n  try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(2000) }); network = "reached"; } catch { network = "blocked"; }\n  return { tries, network, secret: Object.keys(process.env).filter((key) => /SERVICE_SECRET|AUTH_SECRET|S3_|AWS|SMTP|GITHUB/.test(key)), database: process.env.DATABASE_URL ?? null };\n};`), webhookVersion)));
  const outside = await runToEnd(OUTSIDE, {});
  const look = outside.run?.steps?.look?.output;
  check("aFlowIsInTheJail", look?.tries?.["/root"] === "EACCES" && look?.tries?.["/opt/ccagent/agent.mjs"] !== 1, look);
  check("withNoNetwork", look?.network === "blocked", look);
  check("andNoneOfTheServersSecrets", look?.secret?.length === 0, look?.secret);
  // A room with its own database has DATABASE_URL for it. It mustn't be the server's. Not printed, either way.
  check("norTheServersDatabase", look !== undefined && look.database !== process.env.DATABASE_URL, "it matched");

  const BAD_NAME = inFolder("badname");
  write(BAD_NAME, flow("Bad", webhook(code("../../escape", "export const code = async () => ({});"), webhookVersion)));
  const badName = await runToEnd(BAD_NAME, {});
  check("aStepsNameCantLeaveItsFolder", badName.run?.status === "FAILED" && /can't be a step's name/.test(badName.run?.message ?? ""), badName.run);
  const NOT_FLOW = inFolder("notflow");
  write(NOT_FLOW, "this isn't json");
  const notFlow = await ask({ op: "run", path: NOT_FLOW, stateVector: vector() });
  check("aFileThatIsntAFlowSaysSo", notFlow.status === 422 && /isn't a flow/.test(notFlow.body.error), notFlow.body);
  const gone = await ask({ op: "run", path: inFolder("no-such") });
  check("aFileThatIsntThereSaysSo", gone.status === 422 && /no file called/.test(gone.body.error), gone.body);
  const UNKNOWN = inFolder("unknown");
  write(UNKNOWN, flow("Unknown", webhook(piece("nope", "@activepieces/piece-not-a-piece", "1.0.0", "x", {}), webhookVersion)));
  const unknownPiece = await runToEnd(UNKNOWN, {});
  check("aPieceTheImageDoesntHaveFailsTheRun", unknownPiece.run && unknownPiece.run.status !== "SUCCEEDED", unknownPiece.run);

  // ---- What a request can't do ----
  for (const path of ["../etc/x.flow.json", "/etc/x.flow.json", "a.json", `${FOLDER}/../../x.flow.json`]) {
    const refused = await ask({ op: "run", path });
    check(`refused ${path}`, refused.status === 400, refused.body);
  }
  const oddRun = await ask({ op: "run-details", id: "../live" });
  check("aRunCantBeSomeOtherFile", oddRun.status === 400, oddRun.body);
  const unknownOp = await ask({ op: "drop" });
  check("anUnknownRequestIsRefused", unknownOp.status === 400, unknownOp.body);
  const forged = await fetch(`${RUNNER}/rooms/${ROOM}/automations`, { method: "POST", headers: { authorization: token("TEAM22"), "content-type": "application/json" }, body: JSON.stringify({ op: "status" }) });
  check("anotherRoomsTokenIsRefused", forged.status === 401);

  const memory = await shell(`awk '/^anon /{print int($2/1048576)}' /sys/fs/cgroup/memory.stat; echo PEAK $(($(cat /sys/fs/cgroup/memory.peak) / 1048576))\n`);
  console.log(`      memory now, then the sandbox's peak, in MB: ${memory.replace(/\s+/g, " ").trim()}`);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  for (const item of flatten(listTree(doc))) if (item.name.startsWith(`auto-${stamp}`)) trash(doc, item.id);
  await sleep(800);
  await shell(`rm -rf "$HOME/automations"; echo CLEAN\n`).catch(() => {});
  await sleep(800);
  check("theTestsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER) || item.path.startsWith(`auto-${stamp}`)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
