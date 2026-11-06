// The live document from end to end, in disposable rooms: real sessions, through Caddy (/collab), to Hocuspocus and
// Postgres. A room seeds once from its template, edits travel both ways, a viewer can't write, edits survive everyone
// leaving, and foreign sites, signed-out visitors and outsiders are refused.
//   node test/collab.e2e.mjs        (from apps/collab, with the dev stack running)
import { createDb, schema } from "@codechatter/db";
import { findByPath, flatten, listTree, textOf } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { like } from "drizzle-orm";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const WS = `${ORIGIN.replace(/^http/, "ws")}/collab`;
const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if (probe()) return true;
    if (Date.now() > end) return false;
    await sleep(50);
  }
}

async function signIn(email) {
  const res = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "codechatter123" }),
  });
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status}`);
  return res.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function api(cookie, path, init = {}) {
  const res = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { origin: ORIGIN, cookie, "content-type": "application/json", ...init.headers },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A browser-like connection: the cookie and Origin ride on the upgrade. */
function connect(docName, { cookie, origin = ORIGIN, attempts = 1 }) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { ...(cookie && { cookie }), origin } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: attempts });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: "cookie" });
  // A shared (external) socket is not attached automatically in Hocuspocus 4.
  provider.attach();
  const outcome = new Promise((resolve) => {
    provider.on("synced", () => resolve("synced"));
    provider.on("authenticationFailed", ({ reason }) => resolve(`denied: ${reason}`));
    setTimeout(() => resolve("timeout"), 8000);
  });
  const connection = { doc, outcome, synced: 0, denied: 0, close: () => (provider.destroy(), socket.destroy()) };
  provider.on("synced", () => (connection.synced += 1));
  provider.on("authenticationFailed", () => (connection.denied += 1));
  open.push(connection);
  return connection;
}

const open = [];
const rooms = [];
const database = createDb(process.env.DATABASE_URL, { max: 2 });
const paths = (doc) => flatten(listTree(doc)).map((node) => node.path);
const text = (doc, path) => {
  const node = findByPath(doc, path);
  return node ? textOf(doc, node.id) : undefined;
};
const docOf = (room) => `room:${room.id}:files`;

const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const stamp = Date.now().toString(36);

async function newRoom(cookie, body) {
  const res = await api(cookie, "/api/rooms", { method: "POST", body: JSON.stringify(body) });
  if (res.status !== 201) throw new Error(`new room: ${res.status}`);
  rooms.push({ id: res.body.id, cookie });
  return res.body;
}

try {
  // Seeded from the room's template when it's first opened.
  const room = await newRoom(c1, { name: `Collab ${stamp}`, templateId: "python" });
  const owner = connect(docOf(room), { cookie: c1 });
  record("the owner connects", (await owner.outcome) === "synced", await owner.outcome);
  const seeded = text(owner.doc, "main.py")?.toString();
  record("the room seeds from its template", seeded !== undefined && seeded.length > 0, paths(owner.doc).join(", "));

  // Live editing between two people.
  const joined = await api(c2, "/api/rooms/join", { method: "POST", body: JSON.stringify({ code: room.id, inviteToken: room.inviteToken }) });
  record("an invited person joins as an editor", joined.body?.room?.role === "editor", joined.body?.room?.role);
  const editor = connect(docOf(room), { cookie: c2 });
  record("the editor connects", (await editor.outcome) === "synced");
  const fromEditor = `# from the editor ${stamp}\n`;
  text(editor.doc, "main.py").insert(0, fromEditor);
  record("an edit reaches the owner", await until(() => text(owner.doc, "main.py").toString().startsWith(fromEditor)));
  const fromOwner = `# from the owner ${stamp}\n`;
  text(owner.doc, "main.py").insert(0, fromOwner);
  record("and the other way", await until(() => text(editor.doc, "main.py").toString().startsWith(fromOwner)));

  // Who's refused.
  const foreign = connect(docOf(room), { cookie: c1, origin: "https://evil.example" });
  const foreignResult = await foreign.outcome;
  record("another site is refused, even with a valid session", foreignResult.startsWith("denied"), foreignResult);
  const signedOut = connect(docOf(room), { cookie: "" });
  record("a signed-out visitor is refused", (await signedOut.outcome).startsWith("denied"), await signedOut.outcome);
  const theirs = await newRoom(c2, { name: `Private ${stamp}` });
  const outsider = connect(docOf(theirs), { cookie: c1 });
  record("someone outside a private room is refused", (await outsider.outcome).startsWith("denied"), await outsider.outcome);
  const missing = connect("room:ZZZZZZ:files", { cookie: c1 });
  record("a room that doesn't exist is refused", (await missing.outcome).startsWith("denied"), await missing.outcome);

  // A viewer can read but not write.
  const openRoom = await newRoom(c1, { name: `Open ${stamp}`, visibility: "public", joinPolicy: "open", templateId: "python" });
  const viewerJoined = await api(c2, "/api/rooms/join", { method: "POST", body: JSON.stringify({ code: openRoom.id }) });
  const host = connect(docOf(openRoom), { cookie: c1 });
  await host.outcome;
  const viewer = connect(docOf(openRoom), { cookie: c2 });
  record("a viewer can read", (await viewer.outcome) === "synced" && viewerJoined.body?.room?.role === "viewer" && paths(viewer.doc).includes("main.py"), viewerJoined.body?.room?.role);
  text(viewer.doc, "main.py").insert(0, "HACKED\n");
  await sleep(800);
  record("a viewer's write reaches nobody", !text(host.doc, "main.py").toString().includes("HACKED"));
  const fresh = connect(docOf(openRoom), { cookie: c1 });
  await fresh.outcome;
  record("and isn't kept", !text(fresh.doc, "main.py").toString().includes("HACKED"));

  // A public room going private: a visitor who was watching is cut off at once, and the owner carries on.
  const shared = await newRoom(c1, { name: `Shared ${stamp}`, visibility: "public", templateId: "python" });
  const keeper = connect(docOf(shared), { cookie: c1, attempts: 20 });
  await keeper.outcome;
  const visitor = connect(docOf(shared), { cookie: c2, attempts: 20 });
  record("a visitor can watch a public room", (await visitor.outcome) === "synced", await visitor.outcome);
  const madePrivate = await api(c1, `/api/rooms/${shared.id}`, { method: "PATCH", body: JSON.stringify({ visibility: "private" }) });
  record("the owner makes it private", madePrivate.status === 200, madePrivate.status);
  record("the visitor is cut off", await until(() => visitor.denied > 0, 10_000), `refused ${visitor.denied} times`);
  record("the owner reconnects by themselves", await until(() => keeper.synced > 1, 10_000), `synced ${keeper.synced} times`);
  const secret = `# private now ${stamp}\n`;
  text(keeper.doc, "main.py").insert(0, secret);
  await sleep(800);
  record("the visitor gets no more edits", !text(visitor.doc, "main.py").toString().includes(secret));
  const reread = connect(docOf(shared), { cookie: c1 });
  await reread.outcome;
  record("the owner's edit was kept", text(reread.doc, "main.py")?.toString().startsWith(secret));

  // A room deleted with someone in it: they're cut off, and nothing of it is written back.
  const doomed = await newRoom(c1, { name: `Doomed ${stamp}`, templateId: "python" });
  const inside = connect(docOf(doomed), { cookie: c1, attempts: 20 });
  await inside.outcome;
  text(inside.doc, "main.py").insert(0, `# about to go ${stamp}\n`);
  await sleep(300);
  const deleted = await api(c1, `/api/rooms/${doomed.id}`, { method: "DELETE" });
  rooms.splice(rooms.findIndex((item) => item.id === doomed.id), 1);
  record("a room can be deleted with someone in it", deleted.status === 204, deleted.status);
  record("they're cut off", await until(() => inside.denied > 0, 10_000), `refused ${inside.denied} times`);
  text(inside.doc, "main.py").insert(0, "# written after it was deleted\n");
  await sleep(1500);
  const prefix = `room:${doomed.id}:%`;
  const [updates, snapshots] = await Promise.all([
    database.db.select({ seq: schema.docUpdates.seq }).from(schema.docUpdates).where(like(schema.docUpdates.docName, prefix)),
    database.db.select({ name: schema.docSnapshots.docName }).from(schema.docSnapshots).where(like(schema.docSnapshots.docName, prefix)),
  ]);
  record("nothing of a deleted room is left in the database", updates.length === 0 && snapshots.length === 0, `${updates.length} updates, ${snapshots.length} snapshots`);

  // Everyone leaves: the document unloads, and comes back from Postgres.
  owner.close();
  editor.close();
  await sleep(2500);
  const back = connect(docOf(room), { cookie: c1 });
  await back.outcome;
  const kept = text(back.doc, "main.py")?.toString() ?? "";
  record("edits survive everyone leaving", kept.startsWith(fromOwner) && kept.includes(fromEditor), kept.slice(0, 80));
  record("the template isn't seeded a second time", paths(back.doc).filter((path) => path === "main.py").length === 1 && kept.split(seeded).length === 2);
} catch (error) {
  record("the flow completes", false, error instanceof Error ? error.stack : String(error));
} finally {
  open.forEach((connection) => connection.close());
  for (const { id, cookie } of rooms) {
    const res = await api(cookie, `/api/rooms/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.status !== 204) record(`room ${id} is removed`, false, res?.status);
  }
  await database.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
