// Checkpoints over the files document's connection (extensions/checkpoints.ts), as the History view asks for them:
// a saved one comes back with its name, and the other person in the room hears the list changed; a checkpoint
// before an AI edit with nothing changed since is the newest one, not a new copy, while after an edit it's new
// (and only once); a request that isn't one is refused. The API lists them and serves a checkpoint's state, which
// holds the files as they were. The test's edit is undone and its checkpoints deleted.
//   node --env-file=../../.env test/checkpoints.e2e.mjs        (from apps/collab, with the dev stack running)
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { flatten, listTree, textOf } from "@codechatter/workspace-model";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = "http://localhost:8080";
const WS = "ws://localhost:8080/collab";
const ROOM = "E2ETST";
const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).slice(0, 240)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email) {
  const res = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "codechatter123" }),
  });
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

function connect(cookie) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:files`, document: doc, token: "cookie" });
  provider.attach();
  const messages = [];
  provider.on("stateless", ({ payload }) => messages.push(JSON.parse(payload)));
  const synced = new Promise((resolve) => {
    provider.on("synced", () => resolve(true));
    setTimeout(() => resolve(false), 8000);
  });
  return { doc, provider, messages, synced, close: () => (provider.destroy(), socket.destroy()) };
}

let n = 0;
/** Ask for a checkpoint as the browser does, and wait for the answer to this request. */
async function ask(conn, body) {
  const request = `t${Date.now()}-${n++}`;
  conn.provider.sendStateless(JSON.stringify({ type: "checkpoint", request, ...body }));
  for (let i = 0; i < 100; i++) {
    const reply = conn.messages.find((m) => m.type === "checkpoint" && m.request === request);
    if (reply) return reply;
    await sleep(100);
  }
  return null;
}

const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const A = connect(c1);
const B = connect(c2);
const made = [];
let undo = null;
try {
  record("connected", (await A.synced) && (await B.synced));
  const name = `collab e2e ${Date.now().toString(36)}`;

  const saved = await ask(A, { kind: "manual", label: name });
  made.push(saved?.checkpoint?.id);
  record("savedWithName", saved?.ok && saved.checkpoint.kind === "manual" && saved.checkpoint.label === name && saved.checkpoint.by?.name, JSON.stringify(saved));
  await sleep(500);
  record("othersHearIt", B.messages.some((m) => m.type === "checkpoints-changed"));

  const unchanged = await ask(A, { kind: "pre_ai", label: "Before the AI changed nothing" });
  record("nothingChangedIsTheNewest", unchanged?.ok && unchanged.checkpoint.id === saved?.checkpoint?.id, JSON.stringify(unchanged));

  // An edit, then a checkpoint before an AI edit: a new one, with the edit in it.
  const readme = flatten(listTree(A.doc)).find((node) => node.path === "README.md");
  const text = textOf(A.doc, readme.id);
  const marker = `checkpoint e2e ${Date.now()}\n`;
  text.insert(0, marker);
  undo = () => text.delete(0, marker.length);
  const before = await ask(A, { kind: "pre_ai", label: "Before the AI changed README.md" });
  made.push(before?.checkpoint?.id);
  record("afterAnEditItsNew", before?.ok && before.checkpoint.kind === "pre_ai" && before.checkpoint.id !== saved?.checkpoint?.id, JSON.stringify(before));
  const again = await ask(A, { kind: "pre_ai", label: "Before the AI changed it again" });
  record("onlyOnce", again?.ok && again.checkpoint.id === before?.checkpoint?.id, JSON.stringify(again));

  const bad = await ask(A, { kind: "auto", label: null });
  record("onlyAskableKinds", bad && bad.ok === false, JSON.stringify(bad));

  // The API: listed, and the state has the edit (the browser reads it the same way).
  const listed = await fetch(`${ORIGIN}/api/rooms/${ROOM}/checkpoints`, { headers: { origin: ORIGIN, cookie: c2 } }).then((r) => r.json());
  record("listed", [saved?.checkpoint?.id, before?.checkpoint?.id].every((id) => listed.checkpoints?.some((c) => c.id === id)));
  const state = await fetch(`${ORIGIN}/api/rooms/${ROOM}/checkpoints/${before?.checkpoint?.id}/state`, { headers: { origin: ORIGIN, cookie: c2 } });
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(await state.arrayBuffer()));
  const readmeThen = flatten(listTree(doc)).find((node) => node.path === "README.md");
  record("stateHasTheFiles", state.status === 200 && textOf(doc, readmeThen.id).toString().startsWith(marker), state.status);
  const missing = await fetch(`${ORIGIN}/api/rooms/${ROOM}/checkpoints/00000000-0000-7000-8000-000000000000/state`, { headers: { origin: ORIGIN, cookie: c2 } });
  record("unknownIs404", missing.status === 404, missing.status);
} catch (error) {
  record("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  undo?.();
  await sleep(500);
  for (const id of made.filter(Boolean)) {
    await fetch(`${ORIGIN}/api/rooms/${ROOM}/checkpoints/${id}`, { method: "DELETE", headers: { origin: ORIGIN, cookie: c1 } });
  }
  A.close();
  B.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
