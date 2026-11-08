// The gallery of example automations, against the real thing, in E2ETST. Every step of every example is checked against what its piece really has. Those marked "runs here" are
// each run on Activepieces' real engine in the sandbox, with their sample, and their answer checked.
//   pnpm exec tsx --env-file=../../.env test/automation-examples.e2e.ts        (from apps/runner, with the dev stack running and the current sandbox images)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, flatten, listTree, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

import { EXAMPLE_CATEGORIES, EXAMPLES, flowOfExample, matchesExample, servicesOf } from "../../web/components/room/tools/automations/examples.ts";
import { allSteps, chartOfFlow, type FlowStep } from "../../web/components/room/tools/automations/model.ts";

const ROOM = process.env.E2E_ROOM ?? "E2ETST";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET!;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results: boolean[] = [];
const check = (name: string, ok: unknown, detail: unknown = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).replace(/\s+/g, " ").slice(0, 700)}` : ""}`);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const ask = async (body: unknown) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/automations`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  return { status: response.status, body: (await response.json()) as any };
};

/** Whether what came out has at least what was expected. */
function has(actual: unknown, wanted: unknown): boolean {
  if (wanted === null || typeof wanted !== "object") return actual === wanted;
  if (Array.isArray(wanted)) return Array.isArray(actual) && wanted.length === actual.length && wanted.every((item, index) => has(actual[index], item));
  return actual !== null && typeof actual === "object" && Object.entries(wanted).every(([key, value]) => has((actual as Record<string, unknown>)[key], value));
}

const manifest = await ask({ op: "manifest" });
const pieces = manifest.body.pieces as Record<string, any>;
check("thePiecesAreAvailable", manifest.status === 200 && Object.keys(pieces).length >= 40);

// ---- The gallery as a whole ----
check("thereAreAtLeastOneHundred", EXAMPLES.length >= 100, EXAMPLES.length);
console.log(`      ${EXAMPLES.length} examples, ${EXAMPLES.filter((item) => item.runsHere).length} that run here, in ${EXAMPLE_CATEGORIES.length} kinds`);
check("eachHasItsOwnId", new Set(EXAMPLES.map((item) => item.id)).size === EXAMPLES.length, EXAMPLES.map((item) => item.id).filter((id, index, all) => all.indexOf(id) !== index));
check("eachHasItsOwnTitle", new Set(EXAMPLES.map((item) => item.title)).size === EXAMPLES.length, EXAMPLES.map((item) => item.title).filter((title, index, all) => all.indexOf(title) !== index));
check("eachSaysWhatItDoes", EXAMPLES.every((item) => item.title && item.about && item.category));
check("searchFindsThem", EXAMPLES.some((item) => matchesExample(item, "release notes")) && !EXAMPLES.some((item) => matchesExample(item, "zzzz")));

// ---- Every step of every example, against what its piece really has ----
const problems: string[] = [];
const onChart: string[] = [];
for (const example of EXAMPLES) {
  const flow = flowOfExample(example, pieces);
  const steps = allSteps(flow.trigger);
  const names = steps.map((step: FlowStep) => step.name);
  if (new Set(names).size !== names.length) problems.push(`${example.id}: two steps have one name`);
  if (flow.trigger.name !== "trigger") problems.push(`${example.id}: its first step isn't the trigger`);
  for (const step of steps) {
    if (!/^[A-Za-z0-9_]+$/.test(step.name)) problems.push(`${example.id}: ${step.name} can't be a step's name`);
    const settings = step.settings as { pieceName?: string; pieceVersion?: string; actionName?: string; triggerName?: string; input?: Record<string, unknown> };
    if (step.type === "PIECE" || step.type === "PIECE_TRIGGER") {
      const piece = pieces[settings.pieceName!];
      if (!piece) {
        problems.push(`${example.id}: no piece ${settings.pieceName}`);
        continue;
      }
      if (settings.pieceVersion !== piece.version) problems.push(`${example.id}: ${settings.pieceName} isn't at the image's version`);
      const what = step.type === "PIECE" ? piece.actions[settings.actionName!] : piece.triggers[settings.triggerName!];
      if (!what) {
        problems.push(`${example.id}: ${settings.pieceName} has no ${settings.actionName ?? settings.triggerName}`);
        continue;
      }
      for (const key of Object.keys(settings.input ?? {})) if (key !== "auth" && !what.fields[key]) problems.push(`${example.id}: ${settings.actionName ?? settings.triggerName} has no field ${key}`);
      for (const [key, field] of Object.entries<any>(what.fields)) if (field.required && !(key in (settings.input ?? {}))) problems.push(`${example.id}: ${settings.actionName ?? settings.triggerName} needs ${key}`);
      if (what.needsAuth && piece.auth && !settings.input?.auth) problems.push(`${example.id}: ${settings.pieceName} needs a connection`);
      if (example.runsHere && settings.input?.auth) problems.push(`${example.id}: says it runs here, and needs a connection`);
    }
    // What a step refers to has to run before it.
    for (const match of JSON.stringify(step.settings).matchAll(/\{\{\s*([A-Za-z0-9_]+)\./g)) if (!names.includes(match[1]!)) problems.push(`${example.id}: ${step.name} refers to ${match[1]}, which isn't a step`);
  }
  if (!example.runsHere && !servicesOf(example, pieces).length && !allSteps(flow.trigger).some((step) => (step.settings as { pieceName?: string }).pieceName?.includes("http"))) problems.push(`${example.id}: needs nothing, so it should be marked as running here`);
  const chart = chartOfFlow(flow, undefined, pieces);
  if (chart.items.length !== steps.length) onChart.push(`${example.id}: ${chart.items.length} boxes for ${steps.length} steps`);
}
check("everyStepIsSomethingItsPieceHas", problems.length === 0, problems.slice(0, 12));
check("everyStepIsOnTheChart", onChart.length === 0, onChart.slice(0, 6));

// ---- Those that run here, on the real engine ----
const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket as never, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stamp = Date.now().toString(36);
const FOLDER = `auto-examples-${stamp}`;
const vector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");
try {
  const runnable = EXAMPLES.filter((item) => item.runsHere);
  const wrong: string[] = [];
  const started = Date.now();
  for (const example of runnable) {
    const path = `${FOLDER}/${example.id}.flow.json`;
    createFileAtPath(doc, path, JSON.stringify(flowOfExample(example, pieces), null, 2));
    const run = await ask({ op: "run", path, payload: example.sample ?? {}, stateVector: vector() });
    if (run.status !== 200) {
      wrong.push(`${example.id}: didn't start: ${JSON.stringify(run.body).slice(0, 200)}`);
      continue;
    }
    let details: any = null;
    for (let i = 0; i < 120 && !details; i++) {
      const found = await ask({ op: "run-details", id: run.body.id });
      if (found.status === 200) details = found.body;
      else await sleep(250);
    }
    if (!details) wrong.push(`${example.id}: never finished`);
    else if (details.status !== "SUCCEEDED") wrong.push(`${example.id}: ${details.status}: ${String(details.message ?? "").slice(0, 200)}`);
    else if (example.expect) {
      const step = details.steps[example.expect.step];
      if (!step) wrong.push(`${example.id}: ${example.expect.step} didn't run: ${Object.keys(details.steps).join()}`);
      else if (!has(step.output, example.expect.output)) wrong.push(`${example.id}: answered ${JSON.stringify(step.output).slice(0, 200)}, wanted ${JSON.stringify(example.expect.output).slice(0, 120)}`);
    }
  }
  console.log(`      ran ${runnable.length} on the real engine in ${Math.round((Date.now() - started) / 1000)} s`);
  check(`all ${runnable.length} that say they run here do, and give the right answer`, wrong.length === 0, wrong.slice(0, 10));
} catch (error) {
  check("noUnexpectedError", false, (error as Error).stack ?? String(error));
} finally {
  const node = findByPath(doc, FOLDER);
  if (node) trash(doc, node.id);
  await sleep(600);
  check("theTestsFilesAreGone", !flatten(listTree(doc)).some((item) => item.path.startsWith(FOLDER)));
  provider.destroy();
  socket.destroy();
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
