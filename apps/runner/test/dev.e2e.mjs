// The dev server from .codechatter/room.json (roadmap §14 C): it installs only when what it installs is
// missing, starts the room's databases, runs in the shared "dev" terminal, answers through the preview, restarts,
// explains a broken room.json, and stops. No downloads: the app is a dependency-free Node server.
//   node --env-file=../../.env test/dev.e2e.mjs      (from apps/runner, with `pnpm dev` running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, setText, textOf, trash } from "@codechatter/workspace-model";
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
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const call = async (method, path) => {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, { method, headers: { authorization: token(), "content-type": "application/json" }, ...(method === "POST" && { body: "{}" }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);
const dir = `dev-${stamp}`;
const PORT = 3456;

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

/** What the shared dev terminal shows: connect, wait, read the screen. */
async function devScreen(ms = 2500) {
  const ws = new WebSocket(`${RUNNER.replace("http", "ws")}/rooms/${ROOM}/terminal?session=dev&cols=160&rows=40`, { headers: { authorization: token() } });
  let screen = "";
  ws.on("message", (data, isBinary) => isBinary && (screen += data.toString()));
  await new Promise((resolve) => ws.once("open", resolve));
  await sleep(ms);
  ws.close();
  return screen.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}
async function waitListening(ms = 60_000) {
  const until = Date.now() + ms;
  let body = null;
  while (Date.now() < until) {
    body = (await call("GET", "dev")).body;
    if (body?.listening) break;
    await sleep(1500);
  }
  return body;
}

const CONFIG = JSON.stringify({ install: `touch ${dir}/installed && echo installing-${stamp}`, installed: `${dir}/installed`, dev: `node ${dir}/server.js`, port: PORT, databases: ["redis"] }, null, 2);
const SERVER = `require("node:http").createServer((req, res) => res.end("dev server ${stamp} says hi")).listen(${PORT}, "0.0.0.0", () => console.log("listening-${stamp}"));\n`;
let configId = null;

try {
  createFileAtPath(doc, `${dir}/server.js`, SERVER, null);
  const existing = findByPath(doc, ".codechatter/room.json");
  if (existing) trash(doc, existing.id);
  configId = createFileAtPath(doc, ".codechatter/room.json", CONFIG, null);
  await sleep(1200); // the runner's copy of the room catches up

  const before = (await call("GET", "dev")).body;
  record("readsRoomJson", before?.config?.dev === `node ${dir}/server.js` && before.running === false, JSON.stringify(before));

  const started = await call("POST", "dev");
  const up = await waitListening();
  record("startsAndListens", started.status === 200 && up?.running && up?.listening, `${started.status} ${JSON.stringify(up)}`);

  const page = await fetch(`${RUNNER}/rooms/${ROOM}/preview/${PORT}/`, { headers: { authorization: token() } });
  const text = await page.text();
  record("answersThroughThePreview", page.ok && text === `dev server ${stamp} says hi`, `${page.status} ${text.slice(0, 80)}`);

  const first = await devScreen();
  record("installsFirstThenRuns", first.includes(`installing-${stamp}`) && first.includes(`listening-${stamp}`), first.slice(-200));

  const redis = ((await call("GET", "databases")).body ?? []).find((d) => d.kind === "redis");
  record("startsItsDatabases", redis && ["starting", "running"].includes(redis.state), redis?.state);

  // Restart: a new session, and the install is skipped now that it's done.
  await call("POST", "dev");
  const again = await waitListening();
  const second = await devScreen();
  record("restartSkipsTheInstall", again?.listening && second.includes(`listening-${stamp}`) && !second.includes(`installing-${stamp}`), second.slice(-200));

  // A broken room.json is explained, not run.
  setText(textOf(doc, configId), "{ not json");
  await sleep(1200);
  const broken = await call("POST", "dev");
  record("explainsABrokenRoomJson", broken.status === 409 && /room\.json isn't valid JSON/.test(broken.body?.error ?? ""), JSON.stringify(broken.body));

  const stopped = await call("DELETE", "dev");
  await sleep(1500);
  const after = (await call("GET", "dev")).body;
  record("stops", stopped.status === 200 && after?.running === false && after?.listening === false, JSON.stringify(after));
} finally {
  await call("DELETE", "dev").catch(() => {});
  await call("DELETE", "databases/redis").catch(() => {});
  for (const path of [dir, ".codechatter"]) {
    const node = findByPath(doc, path);
    if (node) trash(doc, node.id);
  }
  await sleep(800);
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
