// Managing a room's people, in disposable rooms, through Caddy: who may do what, and that a change of rights reaches
// everything a person has open (editor, terminal, debugger, language server), and only theirs. The invite link, approving,
// declining, removing, letting back, leaving, public rooms, and interview rooms staying out of it.
//   node --env-file=../../.env test/room-people.e2e.mjs        (from apps/collab, with the dev stack running)
import { createDb, schema } from "@codechatter/db";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { and, eq, like } from "drizzle-orm";
import { randomInt } from "node:crypto";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const WS_ORIGIN = ORIGIN.replace(/^http/, "ws");
const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await probe()) return true;
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

async function api(cookie, path, method = "GET", body) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, cookie, ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const open = [];

/** A browser-like editor connection. It reconnects, as a browser does. */
function editor(room, cookie) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: ORIGIN } });
    }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${WS_ORIGIN}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 20 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${room}:files`, document: doc, token: "cookie" });
  provider.attach();
  const connection = { doc, synced: 0, denied: 0, close: () => (provider.destroy(), socket.destroy()) };
  provider.on("synced", () => (connection.synced += 1));
  provider.on("authenticationFailed", () => (connection.denied += 1));
  open.push(connection);
  return connection;
}

/** A socket like the browser's, on /ws/terminal, /ws/debug or /ws/lsp. */
function liveSocket(path, cookie) {
  const ws = new WebSocket(`${WS_ORIGIN}${path}`, { headers: { cookie, origin: ORIGIN } });
  const live = { ws, opened: false, ready: false, output: "", closed: null, refused: null, type: (text) => ws.send(JSON.stringify({ t: "in", d: text })), close: () => ws.terminate() };
  ws.on("open", () => (live.opened = true));
  ws.on("message", (data, binary) => {
    if (binary) live.output += data.toString();
    else if (data.toString().includes('"ready"')) live.ready = true;
  });
  ws.on("close", (code, reason) => (live.closed = { code, reason: reason.toString() }));
  ws.on("unexpected-response", (_request, response) => (live.refused = response.statusCode));
  ws.on("error", () => {});
  open.push(live);
  return live;
}
const terminal = (room, cookie) => liveSocket(`/ws/terminal?room=${room}&n=1&cols=80&rows=24`, cookie);

const database = createDb(process.env.DATABASE_URL, { max: 2 });
const [c1, c2] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
const [me1, me2] = await Promise.all([api(c1, "/api/me"), api(c2, "/api/me")]);
const owner = me1.body.user.id;
const two = me2.body.user.id;
const stamp = Date.now().toString(36);
const rooms = [];
const CLOSED = 4205;

try {
  const created = await api(c1, "/api/rooms", "POST", { name: `People ${stamp}`, templateId: "blank" });
  const id = created.body.id;
  rooms.push(id);
  const room = `/api/rooms/${id}`;
  const people = `${room}/people`;
  const join = (cookie, inviteToken) => api(cookie, "/api/rooms/join", "POST", { code: id, ...(inviteToken && { inviteToken }) });
  const inbox = async () => (await api(c2, "/api/me/notifications")).body.items.filter((item) => item.room?.id === id).map((item) => item.type);

  // The invite link.
  const link = await api(c1, `${room}/invite-link`);
  record("linkCanBeCopiedAgain", link.status === 200 && link.body.token === created.body.inviteToken);
  record("strangersDontGetTheLink", (await api(c2, `${room}/invite-link`)).status === 404);
  const wrong = await join(c2, "not-the-token-but-the-same-sort-of-length-as-one");
  record("aWrongLinkDoesNothing", wrong.status === 404 && (await api(c2, room)).status === 404, `HTTP ${wrong.status}`);
  const joined = await join(c2, link.body.token);
  record("theLinkLetsYouIn", joined.body?.status === "joined" && joined.body.room.role === "editor", JSON.stringify(joined.body?.status));
  record("editorsCanCopyTheLink", (await api(c2, `${room}/invite-link`)).body?.token === link.body.token);
  record("onlyTheOwnerMakesANewLink", (await api(c2, `${room}/invite-link`, "POST")).status === 403);

  // Who may manage.
  record("editorsDontManagePeople", (await api(c2, people)).status === 403 && (await api(c2, `${people}/${owner}`, "PATCH", { role: "viewer" })).status === 403 && (await api(c2, `${people}/${owner}`, "DELETE")).status === 403);
  record("theOwnerCantBeRemovedOrChanged", (await api(c1, `${people}/${owner}`, "DELETE")).status === 404 && (await api(c1, `${people}/${owner}`, "PATCH", { role: "viewer" })).status === 404);
  record("theOwnerCantLeave", (await api(c1, `${room}/leave`, "POST")).status === 403);
  record("nobodyBecomesOwner", (await api(c1, `${people}/${two}`, "PATCH", { role: "owner" })).status === 400 && (await api(c1, `${people}/${two}`, "PATCH", { role: "candidate" })).status === 400);
  record("noSuchPerson", (await api(c1, `${people}/nobody-at-all`, "PATCH", { role: "viewer" })).status === 404);

  // Changing a role reaches what they have open, and only theirs.
  const ownerDoc = editor(id, c1);
  const twoDoc = editor(id, c2);
  record("bothEditorsConnect", await until(() => ownerDoc.synced > 0 && twoDoc.synced > 0), `owner ${ownerDoc.synced}, test2 ${twoDoc.synced}`);
  twoDoc.doc.getMap("probe").set("before", 1);
  record("editorsWrite", await until(() => ownerDoc.doc.getMap("probe").get("before") === 1));

  const ownerShell = terminal(id, c1);
  const twoShell = terminal(id, c2);
  await until(() => ownerShell.ready && twoShell.ready, 60_000);
  record("bothHaveTerminals", ownerShell.ready && twoShell.ready, `owner ${ownerShell.ready}, test2 ${twoShell.ready}`);
  twoShell.type('export CC_MARK=here; echo "mark=[$CC_MARK]"\r');
  await until(() => /mark=\[here\]/.test(twoShell.output), 10_000);
  const twoDebug = liveSocket(`/ws/debug?room=${id}`, c2);
  const twoLsp = liveSocket(`/ws/lsp?room=${id}&language=python`, c2);
  await until(() => twoDebug.opened && twoLsp.opened, 10_000);
  await sleep(1500); // a base image without this language server says so by closing, with its own code
  const lspWasUp = twoLsp.opened && !twoLsp.closed;
  const ownerSyncs = ownerDoc.synced;
  const twoSyncs = twoDoc.synced;

  record("roleChanges", (await api(c1, `${people}/${two}`, "PATCH", { role: "viewer" })).status === 204);
  record("theirTerminalCloses", await until(() => twoShell.closed), JSON.stringify(twoShell.closed));
  record("withTheRightCode", twoShell.closed?.code === CLOSED);
  record("theirDebuggerClosesToComeBackWatching", await until(() => twoDebug.closed?.code === CLOSED), JSON.stringify(twoDebug.closed));
  record("theirLanguageServerCloses", !lspWasUp || (await until(() => twoLsp.closed?.code === CLOSED)), lspWasUp ? JSON.stringify(twoLsp.closed) : "no server in this image");
  record("theirEditorReconnects", await until(() => twoDoc.synced > twoSyncs));
  await sleep(600);
  record("theOwnersTerminalStaysOpen", ownerShell.closed === null);
  record("theOwnersEditorIsntDisturbed", ownerDoc.synced === ownerSyncs && ownerDoc.denied === 0, `synced ${ownerSyncs} then ${ownerDoc.synced}`);
  twoDoc.doc.getMap("probe").set("demoted", 1);
  await sleep(1500);
  record("viewersCantWrite", ownerDoc.doc.getMap("probe").get("demoted") === undefined);
  const refusedShell = terminal(id, c2);
  await until(() => refusedShell.refused);
  record("viewersGetNoTerminal", refusedShell.refused === 403, String(refusedShell.refused));
  record("theRoomSaysTheirRole", (await api(c2, room)).body?.role === "viewer");
  const watching = liveSocket(`/ws/debug?room=${id}`, c2);
  record("viewersCanStillWatchTheDebugger", await until(() => watching.opened));
  record("toldAboutTheirRole", await until(async () => (await inbox()).includes("room.role")));

  const twoSyncsBeforePromotion = twoDoc.synced;
  await api(c1, `${people}/${two}`, "PATCH", { role: "editor" });
  await until(() => twoDoc.synced > twoSyncsBeforePromotion);
  twoDoc.doc.getMap("probe").set("promoted", 1);
  record("promotedPeopleWriteAtOnce", await until(() => ownerDoc.doc.getMap("probe").get("promoted") === 1));
  const secondShell = terminal(id, c2);
  await until(() => secondShell.ready, 30_000);
  secondShell.type('echo "mark=[$CC_MARK]"\r');
  // The old shell had CC_MARK set. A new one doesn't: what they had running ended with the right.
  record("theirOldShellEnded", (await until(() => /mark=\[\]/.test(secondShell.output), 10_000)) && !/mark=\[here\]/.test(secondShell.output), secondShell.output.slice(-120));

  // Removing someone.
  const twoSyncsBeforeRemoval = twoDoc.denied;
  record("theOwnerCanRemove", (await api(c1, `${people}/${two}`, "DELETE")).status === 204);
  record("theirTerminalClosesWhenRemoved", await until(() => secondShell.closed?.code === CLOSED), JSON.stringify(secondShell.closed));
  record("theirEditorIsRefused", await until(() => twoDoc.denied > twoSyncsBeforeRemoval));
  twoDoc.close();
  record("theRoomIsGoneForThem", (await api(c2, room)).status === 404);
  record("itLeavesTheirRooms", !(await api(c2, "/api/rooms")).body.some((item) => item.id === id));
  const listed = (await api(c1, people)).body;
  record("itsListed", listed.removed.some((person) => person.id === two) && !listed.members.some((person) => person.id === two));
  record("theLinkNoLongerLetsThemIn", (await join(c2, link.body.token)).body?.status === "refused");
  record("toldTheyWereRemoved", await until(async () => (await inbox()).includes("room.removed")));
  record("theOwnerStaysConnected", ownerDoc.denied === 0 && ownerShell.closed === null);

  record("theOwnerCanLetThemBack", (await api(c1, `${people}/${two}/allow`, "POST")).status === 204);
  record("theyreOffTheList", (await api(c1, people)).body.removed.length === 0);
  record("theLinkWorksAgain", (await join(c2, link.body.token)).body?.status === "joined");

  // Leaving, and a new link.
  record("membersCanLeave", (await api(c2, `${room}/leave`, "POST")).status === 204);
  record("thenItsGoneForThem", (await api(c2, room)).status === 404);
  const fresh = await api(c1, `${room}/invite-link`, "POST");
  record("aNewLinkIsMade", fresh.status === 200 && fresh.body.token !== link.body.token);
  record("theOldLinkStopsWorking", (await join(c2, link.body.token)).status === 404);
  record("theLinkStaysTheNewOne", (await api(c1, `${room}/invite-link`)).body?.token === fresh.body.token);
  record("theNewLinkWorks", (await join(c2, fresh.body.token)).body?.status === "joined");
  await api(c2, `${room}/leave`, "POST");

  // Asking to join.
  await api(c1, room, "PATCH", { joinPolicy: "approval" });
  record("askingToJoinWaits", (await join(c2, fresh.body.token)).body?.status === "pending");
  record("whileWaitingTheRoomIsClosed", (await api(c2, room)).status === 404);
  const waitingDoc = editor(id, c2);
  record("whileWaitingNoEditor", await until(() => waitingDoc.denied > 0));
  waitingDoc.close();
  const asking = (await api(c1, people)).body;
  record("theOwnerSeesWhoAsks", asking.waiting.length === 1 && asking.waiting[0].id === two && asking.waiting[0].email === "test2@codechatter.local");
  record("onlyWaitingPeopleShowTheirEmail", asking.members.every((person) => person.email === undefined));
  record("approvingGivesTheRoleChosen", (await api(c1, `${people}/${two}/approve`, "POST", { role: "runner" })).status === 204 && (await api(c2, room)).body?.role === "runner");
  record("toldTheyreIn", await until(async () => (await inbox()).includes("room.approved")));
  record("approvingTwiceIsRefused", (await api(c1, `${people}/${two}/approve`, "POST", { role: "editor" })).status === 404);
  await api(c2, `${room}/leave`, "POST");
  await join(c2, fresh.body.token);
  record("theOwnerCanDecline", (await api(c1, `${people}/${two}`, "DELETE")).status === 204);
  record("decliningKeepsThemOut", (await join(c2, fresh.body.token)).body?.status === "refused");
  record("toldTheyreDeclined", await until(async () => (await inbox()).includes("room.declined")));

  // In a public room anyone can look, but someone removed still can't become a member.
  await api(c1, room, "PATCH", { visibility: "public", joinPolicy: "open" });
  const looking = await api(c2, room);
  record("publicRoomsStayVisible", looking.status === 200 && looking.body.role === "viewer");
  record("butTheyCantJoinIt", (await join(c2)).body?.status === "refused");

  // Interview rooms are the interview's business.
  const row = await database.db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) });
  const interviewId = Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[randomInt(31)]).join("");
  await database.db.insert(schema.rooms).values({ id: interviewId, orgId: row.orgId, name: `Interview ${stamp}`, kind: "interview", createdBy: owner });
  await database.db.insert(schema.roomMembers).values({ roomId: interviewId, userId: owner, role: "interviewer" });
  const interviewStatuses = [
    (await api(c1, `/api/rooms/${interviewId}/people`)).status,
    (await api(c1, `/api/rooms/${interviewId}/invite-link`)).status,
    (await api(c1, `/api/rooms/${interviewId}/invite-link`, "POST")).status,
    (await api(c1, `/api/rooms/${interviewId}/leave`, "POST")).status,
  ];
  await database.db.delete(schema.rooms).where(eq(schema.rooms.id, interviewId));
  record("interviewRoomsAreLeftAlone", interviewStatuses.every((status) => status === 403), interviewStatuses.join(","));

  // Written in the audit log, for the organisation's admins.
  const audited = await database.db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(and(eq(schema.auditEvents.targetId, id), like(schema.auditEvents.action, "room.%")));
  const actions = new Set(audited.map((event) => event.action));
  const wanted = ["room.member.role", "room.member.remove", "room.member.allow", "room.member.leave", "room.member.approve", "room.member.decline", "room.invite-link.reset"];
  record("everyChangeIsAudited", wanted.every((action) => actions.has(action)), wanted.filter((action) => !actions.has(action)).join(", "));
} catch (error) {
  record("noUnexpectedError", false, error?.stack ?? String(error));
} finally {
  for (const item of open) item.close();
  for (const id of rooms) await api(c1, `/api/rooms/${id}`, "DELETE").catch(() => {});
  await database.close?.();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
