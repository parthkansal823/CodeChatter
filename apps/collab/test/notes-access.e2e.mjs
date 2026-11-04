// Who may open the Notes documents (extensions/access.ts): your private notes (room:ID:mine:<you>) open for you and
// for no one else, even someone in the same room; the room's notes open for everyone in it, and a write from someone
// who can chat is kept (it reaches a second connection).
//   node --env-file=../../.env test/notes-access.e2e.mjs        (from apps/collab, with the dev stack running)
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = "http://localhost:8080";
const ROOM = "E2ETST";
const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
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

function connect(name, cookie) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: "ws://localhost:8080/collab", WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: "cookie" });
  provider.attach();
  const outcome = new Promise((resolve) => {
    provider.on("synced", () => resolve("synced"));
    provider.on("authenticationFailed", ({ reason }) => resolve(`denied: ${reason}`));
    setTimeout(() => resolve("timeout"), 8000);
  });
  return { doc, outcome, close: () => (provider.destroy(), socket.destroy()) };
}

const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const me = await fetch(`${ORIGIN}/api/me`, { headers: { origin: ORIGIN, cookie: c1 } }).then((r) => r.json());
const test1 = me.user?.id ?? me.id;
const open = [];
try {
  const own = connect(`room:${ROOM}:mine:${test1}`, c1);
  open.push(own);
  record("ownNotesOpen", (await own.outcome) === "synced", await own.outcome);
  const other = connect(`room:${ROOM}:mine:${test1}`, c2);
  open.push(other);
  const denied = await other.outcome;
  record("othersNotesClosed", denied.startsWith("denied"), denied);

  const shared1 = connect(`room:${ROOM}:notes`, c1);
  const shared2 = connect(`room:${ROOM}:notes`, c2);
  open.push(shared1, shared2);
  record("roomNotesOpen", (await shared1.outcome) === "synced" && (await shared2.outcome) === "synced");
  const marker = `access ${Date.now()}`;
  shared2.doc.getMap("probe").set("by-test2", marker);
  await sleep(800);
  record("chatterWritesKept", shared1.doc.getMap("probe").get("by-test2") === marker);
  shared2.doc.getMap("probe").delete("by-test2");
  await sleep(300);
} catch (error) {
  record("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  open.forEach((connection) => connection.close());
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
