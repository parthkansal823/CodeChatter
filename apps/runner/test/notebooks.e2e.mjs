// Notebooks (roadmap §2): a kernel in the room's sandbox runs a notebook's cells, and their outputs
// (printed text, a pandas table, a matplotlib plot, errors) arrive in the room's files document for
// everyone. Variables carry from cell to cell, an error stops the cells after it, interrupt stops a
// cell, restart clears the kernel, and the notebook's .ipynb file follows its cells, on disk too.
//   node --env-file=../../.env test/notebooks.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Against either driver: RUNNER_URL picks the runner.
import { signServiceToken } from "@codechatter/auth/service-token";
import {
  cellCount,
  cellId,
  cellOutputs,
  cellsOf,
  cellSource,
  createFileAtPath,
  ensureNotebook,
  filesDocName,
  findByPath,
  insertCell,
  kernelOf,
  textOf,
  trash,
} from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

const dir = `nb-${Date.now().toString(36)}`;
const fileId = createFileAtPath(doc, `${dir}/analysis.ipynb`, "", null);
const nb = ensureNotebook(doc, fileId);
// The empty notebook's first cell, then one per check.
const cell = (source) => insertCell(nb, cellsOf(nb).length, "code", source);
cellSource(cellsOf(nb).get(0)).insert(0, 'print("hello")\n40 + 2');
const hello = cellId(cellsOf(nb).get(0));
const table = cell('import pandas as pd\npd.DataFrame({"city": ["Pune", "Delhi"], "rooms": [3, 5]})');
const plot = cell("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.title('squares')\nplt.show()");
const setX = cell("x = 5");
const useX = cell("x * 2");
const fails = cell("1 / 0");
const after = cell('print("never")');

const byId = (id) => cellsOf(nb).toArray().find((c) => cellId(c) === id);
const outputs = (id) => cellOutputs(byId(id)).toArray();
const call = (action, body) =>
  fetch(`${RUNNER}/rooms/${ROOM}/notebooks/${fileId}/${action}`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(240_000),
  });
/**
 * Until `done()` (say, the last cell has run) and the kernel has nothing running or waiting.
 * The run call answers before its status reaches this copy of the document, so the
 * kernel looking idle alone could be the status from before the run.
 */
async function settled(done, ms = 180_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const k = kernelOf(nb);
    if (done() && (k.state === "idle" || k.state === "dead" || k.state === "off") && !k.running && k.queued.length === 0) return k;
    await sleep(300);
  }
  return kernelOf(nb);
}
const hasRun = (id) => () => cellCount(byId(id)) !== null;

try {
  await sleep(500); // the cells reach the collab server
  const t0 = Date.now();
  const started = await call("run", { cellIds: cellsOf(nb).toArray().map(cellId), stateVector: stateVector() });
  const startBody = await started.json();
  record("runAccepted", started.status === 202, `${started.status} ${JSON.stringify(startBody)}`);
  const k = await settled(hasRun(fails));
  record("kernelSettles", k.state === "idle", `${JSON.stringify(k)} after ${Date.now() - t0}ms`);

  const first = outputs(hello);
  record(
    "printsAndReturns",
    first.some((o) => o.output_type === "stream" && o.text === "hello\n") && first.some((o) => o.output_type === "execute_result" && o.data["text/plain"] === "42") && cellCount(byId(hello)) === 1,
    JSON.stringify(first),
  );
  const frame = outputs(table).find((o) => o.output_type === "execute_result");
  record("pandasTableAsHtml", String(frame?.data?.["text/html"] ?? "").includes("<table") && String(frame?.data?.["text/plain"]).includes("Pune"), JSON.stringify(frame?.data?.["text/plain"]));
  const figure = outputs(plot).find((o) => o.output_type === "display_data");
  record("plotAsPng", String(figure?.data?.["image/png"] ?? "").startsWith("iVBOR"), `${String(figure?.data?.["image/png"] ?? "").length} base64 chars`);
  record("variablesCarryOver", outputs(useX).some((o) => o.output_type === "execute_result" && o.data["text/plain"] === "10"), JSON.stringify(outputs(useX)));
  const error = outputs(fails).find((o) => o.output_type === "error");
  record("errorShown", error?.ename === "ZeroDivisionError", error ? `${error.ename}: ${error.evalue}` : "no error output");
  record("errorStopsTheCellsAfter", outputs(after).length === 0 && cellCount(byId(after)) === null, JSON.stringify(outputs(after)));

  // The notebook's file follows its cells: in the room, and on disk in the sandbox.
  await sleep(1500);
  const text = textOf(doc, fileId)?.toString() ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  record("fileIsTheNotebook", parsed?.nbformat === 4 && parsed.cells.length === 7 && JSON.stringify(parsed.cells[0].outputs).includes("hello"), `${text.length} chars`);
  const check = createFileAtPath(doc, `${dir}/check.py`, `import json\nnb = json.load(open("${dir}/analysis.ipynb"))\nprint("cells", len(nb["cells"]), "outputs", sum(len(c.get("outputs", [])) for c in nb["cells"]))\n`, null);
  void check;
  await sleep(500);
  const runRes = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path: `${dir}/check.py`, stateVector: stateVector() }),
    signal: AbortSignal.timeout(120_000),
  });
  let runOut = "";
  for await (const chunk of runRes.body) runOut += Buffer.from(chunk).toString();
  record("fileOnDiskToo", /cells 7 outputs \d+/.test(runOut), /cells \d+ outputs \d+/.exec(runOut)?.[0] ?? runOut.slice(-160));

  // Interrupt stops a cell that would take a long time.
  const slow = cell("import time\nfor i in range(60):\n    time.sleep(0.5)");
  await sleep(500);
  await call("run", { cellIds: [slow], stateVector: stateVector() });
  await sleep(2500);
  const t1 = Date.now();
  await call("interrupt");
  await settled(() => outputs(slow).some((o) => o.output_type === "error"), 30_000);
  const stopped = outputs(slow).find((o) => o.output_type === "error");
  record("interruptStopsTheCell", stopped?.ename === "KeyboardInterrupt" && Date.now() - t1 < 15_000, `${stopped?.ename ?? "no error"} after ${Date.now() - t1}ms`);

  // Restart clears what the kernel knew.
  const restarted = await call("restart");
  record("restartAnswers", restarted.status === 200, String(restarted.status));
  const again = cell("x");
  await sleep(500);
  await call("run", { cellIds: [again], stateVector: stateVector() });
  await settled(hasRun(again), 60_000);
  record("restartClearsVariables", outputs(again).some((o) => o.output_type === "error" && o.ename === "NameError"), JSON.stringify(outputs(again).map((o) => o.ename ?? o.output_type)));

  const down = await call("shutdown");
  await settled(() => kernelOf(nb).state === "off", 10_000);
  record("shutsDown", down.status === 200 && kernelOf(nb).state === "off", `${down.status} ${kernelOf(nb).state}`);
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(800);
  provider.destroy();
  socket.destroy();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
