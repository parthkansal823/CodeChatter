// Files in automations, the whole way, in E2ETST's sandbox by Activepieces' real engine: a step's output over the engine's 32 KB reaching the next step and
// the run's details whole; File Helper's file read by the CSV piece; the room's files read (Read files), zipped and unzipped by File Helper and written back
// (Write a file), as the room's live document then has them; a run tried again reading a file made before it failed; and a step's file downloaded as the
// tool does (run-file). It removes what it made.
//   node --env-file=../../.env test/automation-files.e2e.mjs        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, textOf, trash } from "@codechatter/workspace-model";
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
const FOLDER = `files-steps-${stamp}`;

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
/** The room's file as the live document has it, once the sandbox's change reaches it. */
async function roomText(path, seconds = 20) {
  for (let i = 0; i < seconds * 4; i++) {
    const node = findByPath(doc, path);
    const text = node ? textOf(doc, node.id)?.toString() : undefined;
    if (text !== undefined) return text;
    await sleep(250);
  }
  return undefined;
}
const STEP_FILE = /^http:\/\/127\.0\.0\.1:\d+\/v1\/step-files\/([\w-]+)\/([\w-]+)\/([^/]+)$/;

try {
  let manifest = await automations({ op: "manifest" });
  for (let i = 0; i < 60 && manifest.status !== 200; i++) {
    await sleep(2000);
    manifest = await automations({ op: "manifest" });
  }
  const version = (name) => manifest.body.pieces[`@activepieces/piece-${name}`].version;
  const handling = { continueOnFailure: { value: false }, retryOnFailure: { value: false } };
  const code = (name, source, input, next = null) => ({ name, type: "CODE", displayName: name, valid: true, skip: false, settings: { sourceCode: { code: source, packageJson: "{}" }, input, errorHandlingOptions: handling }, nextAction: next });
  const builtin = (name, kind, input, next = null) => ({ ...code(name, "// built in\n", input, next), builtin: kind });
  const piece = (name, pieceName, actionName, input, next = null) => ({ name, type: "PIECE", displayName: name, valid: true, skip: false, settings: { pieceName: `@activepieces/piece-${pieceName}`, pieceVersion: version(pieceName), actionName, input, propertySettings: {}, errorHandlingOptions: handling }, nextAction: next });
  const flowOf = (name, first) => ({
    id: `flow_${name}_${stamp}`,
    displayName: name,
    schemaVersion: "27",
    trigger: { name: "trigger", type: "PIECE_TRIGGER", displayName: name, valid: true, settings: { pieceName: "@activepieces/piece-webhook", pieceVersion: version("webhook"), triggerName: "catch_webhook", input: { authType: "none", authFields: {} }, propertySettings: {} }, nextAction: first },
  });
  const write = (name, flow) => {
    const path = `${FOLDER}/${name}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flow, null, 2));
    return path;
  };

  const BIG = write("big", flowOf("big", code("big", 'export const code = async () => ({ text: "x".repeat(50000) });\n', {}, code("after", "export const code = async (inputs) => ({ got: String(inputs.text ?? '').length });\n", { text: "{{big.output.text}}" }))));
  const CSV = write(
    "csv",
    flowOf("csv", piece("create", "file-helper", "createFile", { content: "name,n\na,1\nb,2\n", fileName: "made.csv", encoding: "utf8" }, piece("rows", "csv", "read_csv_file", { file: "{{create.output.url}}", has_header_row: true, delimiter: "," }))),
  );
  createFileAtPath(doc, `${FOLDER}/in/notes.md`, `# Notes ${stamp}\n`);
  createFileAtPath(doc, `${FOLDER}/in/more.md`, `more ${stamp}\n`);
  const ROUND = write(
    "round",
    flowOf(
      "round",
      builtin(
        "read",
        "read_files",
        { paths: `${FOLDER}/in/*.md`, as_text: true },
        piece(
          "zip",
          "file-helper",
          "zipFiles",
          { files: [{ file: "{{read.output[0].file}}", filePath: "docs/more.md" }, { file: "{{read.output[1].file}}" }], outputFileName: "notes.zip" },
          piece("unzip", "file-helper", "unzipFile", { file: "{{zip.output}}" }, builtin("save", "write_file", { path: `${FOLDER}/out/unzipped.md`, content: "{{unzip.output[1].file}}", content_is: "file" })),
        ),
      ),
    ),
  );
  const RETRY = write(
    "retry",
    flowOf("retry", piece("create", "file-helper", "createFile", { content: `made before ${stamp}`, fileName: "before.txt", encoding: "utf8" }, builtin("needs", "read_files", { paths: `${FOLDER}/later.txt` }, piece("back", "file-helper", "read_file", { file: "{{create.output.url}}", readOptions: "text" })))),
  );
  await sleep(2000);

  // ---- An output over 32 KB reaches the next step, and the run's details have it whole ----
  const big = await runByHand(BIG);
  check("a big output: the run succeeds", big?.status === "SUCCEEDED", big);
  check("a big output reaches the next step", big?.steps?.after?.output?.got === 50000, big?.steps?.after);
  check("the run's details have it whole", big?.steps?.big?.outputType === undefined && big?.steps?.big?.output?.text?.length === 50000, { outputType: big?.steps?.big?.outputType, output: JSON.stringify(big?.steps?.big?.output).slice(0, 200) });

  // ---- File Helper's file, read by the CSV piece ----
  const csv = await runByHand(CSV);
  check("File Helper's file: the run succeeds", csv?.status === "SUCCEEDED", csv?.failedStep ?? csv);
  const made = csv?.steps?.create?.output?.url;
  check("its file is a step's file, named", typeof made === "string" && STEP_FILE.test(made) && made.endsWith("/made.csv"), csv?.steps?.create?.output);
  const rows = JSON.stringify(csv?.steps?.rows?.output ?? null);
  check("the CSV piece reads it", rows.includes('"name":"a"') && rows.includes('"name":"b"'), rows);

  // ---- The tool's Download: the file, by its run and id ----
  const [, runId, fileId] = STEP_FILE.exec(String(made)) ?? [];
  const download = await automations({ op: "run-file", id: runId ?? "x", file: fileId ?? "x" });
  check("Download gives the file and its name", download.status === 200 && download.body.name === "made.csv" && Buffer.from(download.body.data ?? "", "base64").toString() === "name,n\na,1\nb,2\n", download.body);
  const missing = await automations({ op: "run-file", id: runId ?? "x", file: "nothere" });
  check("a file that isn't kept says so", missing.status >= 400 && /isn't kept/.test(JSON.stringify(missing.body)), missing);
  const bad = await automations({ op: "run-file", id: "../etc", file: "passwd" });
  check("a run that isn't one is refused", bad.status === 400, bad);

  // ---- The room's files: read, zipped, unzipped, written back ----
  const round = await runByHand(ROUND);
  check("the room's files: the run succeeds", round?.status === "SUCCEEDED", round?.failedStep ?? round);
  const read = round?.steps?.read?.output;
  check("Read files gives each, in order, with its text", Array.isArray(read) && read.map((item) => item.path).join() === `${FOLDER}/in/more.md,${FOLDER}/in/notes.md` && read[1].text === `# Notes ${stamp}\n`, read);
  check("Zip Files takes Read files' files", String(round?.steps?.zip?.output ?? "").endsWith("/notes.zip"), round?.steps?.zip?.output);
  check("Unzip File gives them back, where they were in the zip", (round?.steps?.unzip?.output ?? []).map((item) => item.filePath).join() === "docs/more.md,notes.md", round?.steps?.unzip?.output);
  check("Write a file puts one in the room", round?.steps?.save?.output?.action === "created", round?.steps?.save?.output);
  check("the room's live document has it", (await roomText(`${FOLDER}/out/unzipped.md`)) === `# Notes ${stamp}\n`, await roomText(`${FOLDER}/out/unzipped.md`, 1));

  // ---- Tried again: a file made before the step that failed is still read ----
  const failed = await runByHand(RETRY);
  check("a run that needs a file not there yet fails at that step", failed?.status === "FAILED" && /no file .*later\.txt/.test(JSON.stringify(failed?.failedStep ?? failed?.message)), failed?.failedStep ?? failed);
  createFileAtPath(doc, `${FOLDER}/later.txt`, "here now\n");
  await sleep(2000);
  const retried = await runByHand(RETRY, { mode: "retry", retryOf: failed?.id });
  check("tried again, it carries on", retried?.status === "SUCCEEDED", retried?.failedStep ?? retried);
  check("and reads the file made before it failed", JSON.stringify(retried?.steps?.back?.output ?? "").includes(`made before ${stamp}`), retried?.steps?.back?.output);
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
