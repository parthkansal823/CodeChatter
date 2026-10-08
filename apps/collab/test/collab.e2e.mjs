// End-to-end: real sessions → Caddy (/collab) → Hocuspocus → Postgres.
// Needs infra, the API and collab running, and the dev seed (test1/test2).
//   node apps/collab/test/collab.e2e.mjs
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { flatten, listTree, textOf } from "@codechatter/workspace-model";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = "http://localhost:8080";
const WS = "ws://localhost:8080/collab";
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

async function api(cookie, path, init = {}) {
  const res = await fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { origin: ORIGIN, cookie, "content-type": "application/json", ...init.headers },
  });
  return res.status === 204 ? null : res.json();
}

/** A browser-like connection: the cookie and Origin ride on the upgrade. */
function connect(docName, { cookie, origin = ORIGIN }) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { ...(cookie && { cookie }), origin } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: "cookie" });
  // A shared (external) socket is not attached automatically in Hocuspocus 4.
  provider.attach();
  const outcome = new Promise((resolve) => {
    provider.on("synced", () => resolve("synced"));
    provider.on("authenticationFailed", ({ reason }) => resolve(`denied: ${reason}`));
    setTimeout(() => resolve("timeout"), 6000);
  });
  return { doc, provider, socket, outcome, close: () => { provider.destroy(); socket.destroy(); } };
}

const paths = (doc) => flatten(listTree(doc)).map((n) => n.path);
const fileId = (doc, path) => flatten(listTree(doc)).find((n) => n.path === path)?.id;

const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);

// 1. Seeded from the room's template on first open.
const A = connect("room:E2ETST:files", { cookie: c1 });
record("ownerConnects", (await A.outcome) === "synced", await A.outcome);
const seeded = paths(A.doc);
record("templateSeededOnce", seeded.includes("src/server.js") && seeded.includes("package.json"), seeded.join(", "));

// 2. Live editing between two accounts.
const B = connect("room:E2ETST:files", { cookie: c2 });
record("editorConnects", (await B.outcome) === "synced");
const serverId = fileId(B.doc, "src/server.js");
const marker = `// edited by test2 at ${Date.now()}`;
textOf(B.doc, serverId).insert(0, `${marker}\n`);
await sleep(400);
record("editReachesOtherUser", textOf(A.doc, serverId).toString().startsWith(marker));

// 3. Refusals.
const badOrigin = connect("room:E2ETST:files", { cookie: c1, origin: "https://evil.example" });
record("foreignOriginRefused", (await badOrigin.outcome).startsWith("denied"), await badOrigin.outcome);
badOrigin.close();
const noCookie = connect("room:E2ETST:files", { cookie: "" });
record("signedOutRefused", (await noCookie.outcome).startsWith("denied"));
noCookie.close();
const privateRoom = await api(c2, "/api/rooms", { method: "POST", body: JSON.stringify({ name: "test2 only" }) });
const outsider = connect(`room:${privateRoom.id}:files`, { cookie: c1 });
record("nonMemberRefused", (await outsider.outcome).startsWith("denied"));
outsider.close();

// 4. A viewer (joined an open public room) can read but not write.
const publicRoom = await api(c1, "/api/rooms", {
  method: "POST",
  body: JSON.stringify({ name: "open house", visibility: "public", joinPolicy: "open", templateId: "python" }),
});
const joined = await api(c2, "/api/rooms/join", { method: "POST", body: JSON.stringify({ code: publicRoom.id }) });
const owner = connect(`room:${publicRoom.id}:files`, { cookie: c1 });
await owner.outcome;
const viewer = connect(`room:${publicRoom.id}:files`, { cookie: c2 });
record("viewerCanRead", (await viewer.outcome) === "synced" && joined.room?.role === "viewer" && paths(viewer.doc).includes("main.py"));
const mainId = fileId(viewer.doc, "main.py");
textOf(viewer.doc, mainId).insert(0, "HACKED\n");
await sleep(600);
record("viewerWritesRejected", !textOf(owner.doc, mainId).toString().includes("HACKED"));
owner.close();
viewer.close();

// 5. Everyone leaves; the edit is in Postgres and comes back.
A.close();
B.close();
await sleep(2500);
const C = connect("room:E2ETST:files", { cookie: c1 });
await C.outcome;
record("editPersistsAfterEveryoneLeaves", textOf(C.doc, fileId(C.doc, "src/server.js")).toString().startsWith(marker));
C.close();

// Clean up the throwaway rooms.
await api(c2, `/api/rooms/${privateRoom.id}`, { method: "DELETE" });
await api(c1, `/api/rooms/${publicRoom.id}`, { method: "DELETE" });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
