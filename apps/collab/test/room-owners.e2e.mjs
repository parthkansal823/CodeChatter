/** Exercise room ownership, locked handovers and concurrent demotions in disposable rooms while leaving seeded memberships unchanged. */
import { createDb, schema } from "@codechatter/db";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { and, eq, inArray, like } from "drizzle-orm";
import { randomInt } from "node:crypto";
import WebSocket from "ws";
import * as Y from "yjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const WS_ORIGIN = ORIGIN.replace(/^http/, "ws");
const database = createDb(process.env.DATABASE_URL, { max: 3 });
const results = [];
const ownedRooms = new Set();
const connections = [];
const cookies = [];
const stamp = Date.now().toString(36);
let stage = "sign in";
let firstId, secondId, seededBefore;

function check(name, ok) {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) throw new Error("CheckFailed");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(operation, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await operation()) return true;
    await sleep(75);
  }
  return false;
}

async function api(cookie, path, method = "GET", data) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, cookie, ...(data !== undefined && { "content-type": "application/json" }) },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  let body = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) { try { body = JSON.parse(text); } catch { /* A proxy error must not print response data. */ } }
  }
  return { status: response.status, body };
}

async function signIn(email) {
  const response = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "codechatter123" }),
  });
  if (!response.ok) throw Object.assign(new Error("FixtureSignInFailed"), { name: `FixtureSignInHttp${response.status}` });
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  cookies.push(cookie);
  return cookie;
}

async function memberRows(roomId) {
  return database.db.select({ userId: schema.roomMembers.userId, role: schema.roomMembers.role, status: schema.roomMembers.status })
    .from(schema.roomMembers).where(eq(schema.roomMembers.roomId, roomId));
}
const activeOwners = (rows) => rows.filter((row) => row.role === "owner" && row.status === "active");
const roleOf = (rows, userId) => rows.find((row) => row.userId === userId && row.status === "active")?.role;
const refused = (response) => response.status === 403 || response.status === 409;

/** A real collab connection confirms the existing rights-change fanout also reaches owners. */
function editor(roomId, cookie) {
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: ORIGIN } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${WS_ORIGIN}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 8 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${roomId}:files`, document: doc, token: "session" });
  const peer = { synced: 0, denied: 0, close() { provider.destroy(); socket.destroy(); doc.destroy(); } };
  provider.on("synced", () => { peer.synced++; });
  provider.on("authenticationFailed", () => { peer.denied++; });
  provider.attach();
  connections.push(peer);
  return peer;
}

function terminal(roomId, cookie) {
  const ws = new WebSocket(`${WS_ORIGIN}/ws/terminal?room=${roomId}&n=1&cols=80&rows=24`, { headers: { cookie, origin: ORIGIN } });
  const shell = { ready: false, closed: null, refused: null, close() { ws.terminate(); } };
  ws.on("message", (data, binary) => { if (!binary && data.toString().includes('"ready"')) shell.ready = true; });
  ws.on("close", (code) => { shell.closed = code; });
  ws.on("unexpected-response", (_request, response) => { shell.refused = response.statusCode; });
  ws.on("error", () => {});
  connections.push(shell);
  return shell;
}

async function notifications(roomId, userId) {
  return database.db.select({ type: schema.notifications.type, payload: schema.notifications.payload })
    .from(schema.notifications).where(and(eq(schema.notifications.roomId, roomId), eq(schema.notifications.userId, userId)));
}

try {
  const [first, second] = await Promise.all([signIn("test1@codechatter.local"), signIn("test2@codechatter.local")]);
  const [me1, me2] = await Promise.all([api(first, "/api/me"), api(second, "/api/me")]);
  firstId = me1.body?.user.id;
  secondId = me2.body?.user.id;
  check("both seeded accounts sign in", me1.status === 200 && me2.status === 200 && Boolean(firstId) && Boolean(secondId));
  seededBefore = (await memberRows("E2ETST")).filter((row) => [firstId, secondId].includes(row.userId));

  stage = "create disposable room";
  const created = await api(first, "/api/rooms", "POST", { name: `Owners ${stamp}`, templateId: "blank" });
  check("a disposable room is created", created.status === 201 && Boolean(created.body?.id));
  const id = created.body.id;
  ownedRooms.add(id);
  const path = `/api/rooms/${id}`;
  const people = `${path}/people`;
  const firstPath = `${people}/${encodeURIComponent(firstId)}`;
  const secondPath = `${people}/${encodeURIComponent(secondId)}`;
  const setRole = (cookie, personPath, role) => api(cookie, personPath, "PATCH", { role });
  const join = (cookie, extra = {}) => api(cookie, "/api/rooms/join", "POST", { code: id, inviteToken: created.body.inviteToken, ...extra });
  const joined = await join(second, { role: "owner" });
  check("an invite cannot inject an owner role", joined.status === 200 && joined.body?.status === "joined" && roleOf(await memberRows(id), secondId) === "editor");
  check("an editor cannot make themselves owner", (await setRole(second, secondPath, "owner")).status === 403);
  check("interview roles are not accepted in workspace role requests", (await setRole(first, secondPath, "interviewer")).status === 400);

  stage = "last-owner direct requests";
  check("the last owner cannot step down", refused(await setRole(first, firstPath, "editor")));
  check("the last owner cannot leave", refused(await api(first, `${path}/leave`, "POST")));
  check("the last owner cannot remove themselves", refused(await api(first, firstPath, "DELETE")));
  const lastOwnerMessage = await setRole(first, firstPath, "viewer");
  check("last-owner refusal has a plain owner explanation", refused(lastOwnerMessage) && /needs an owner/i.test(lastOwnerMessage.body?.detail ?? lastOwnerMessage.body?.message ?? ""));
  check("all refused requests retain exactly one active owner", activeOwners(await memberRows(id)).length === 1 && roleOf(await memberRows(id), firstId) === "owner");
  check("handing a room to yourself is refused", (await api(first, `${firstPath}/handover`, "POST")).status === 403);
  check("handover requires an active recipient", (await api(first, `${people}/no-such-active-member/handover`, "POST")).status === 404 && roleOf(await memberRows(id), firstId) === "owner");

  stage = "promotion and management by a second owner";
  check("an owner can promote an active member", (await setRole(first, secondPath, "owner")).status === 204);
  check("both owners are listed as active", activeOwners(await memberRows(id)).length === 2 && (await api(second, people)).status === 200);
  check("the new owner receives a role notification", await until(async () => (await notifications(id, secondId)).some((item) => item.type === "room.role" && item.payload?.role === "owner")));
  check("a second owner can demote the creator", (await setRole(second, firstPath, "editor")).status === 204 && roleOf(await memberRows(id), firstId) === "editor");
  check("a former owner immediately loses management access", (await setRole(first, secondPath, "viewer")).status === 403);
  check("a second owner can restore the creator as owner", (await setRole(second, firstPath, "owner")).status === 204 && activeOwners(await memberRows(id)).length === 2);

  stage = "owner rights revocation";
  const doc = editor(id, second);
  check("a second owner can open a real editor connection", await until(() => doc.synced > 0, 30_000));
  const shell = terminal(id, second);
  check("a second owner can open a real terminal", await until(() => shell.ready, 60_000));
  const synced = doc.synced;
  check("another owner can demote an owner to viewer", (await setRole(first, secondPath, "viewer")).status === 204);
  check("an owner losing terminal rights has their socket closed", await until(() => shell.closed === 4205));
  check("an owner whose role changes has their editor rechecked", await until(() => doc.synced > synced));
  check("the demoted owner sees their current viewer role", (await api(second, path)).body?.role === "viewer");
  const deniedShell = terminal(id, second);
  check("a demoted owner cannot reconnect a terminal", await until(() => deniedShell.refused === 403));
  check("the demoted owner receives the new role notification", await until(async () => (await notifications(id, secondId)).some((item) => item.type === "room.role" && item.payload?.role === "viewer")));
  check("the active viewer can become an owner again", (await setRole(first, secondPath, "owner")).status === 204);

  stage = "owner removal and owner leave";
  check("an owner can remove another owner", (await api(first, secondPath, "DELETE")).status === 204);
  check("removing an owner closes and refuses their editor", await until(() => doc.denied > 0));
  doc.close();
  check("the removed owner has no room access", (await api(second, path)).status === 404);
  check("the removed owner is notified", await until(async () => (await notifications(id, secondId)).some((item) => item.type === "room.removed")));
  check("a removed owner can be allowed back", (await api(first, `${secondPath}/allow`, "POST")).status === 204);
  check("returning through a link never restores ownership", (await join(second)).body?.status === "joined" && roleOf(await memberRows(id), secondId) === "editor");
  check("a returning active member can be promoted again", (await setRole(first, secondPath, "owner")).status === 204);
  check("an owner can leave while another active owner remains", (await api(second, `${path}/leave`, "POST")).status === 204 && activeOwners(await memberRows(id)).length === 1);
  check("a departed owner rejoins as an editor", (await join(second)).body?.status === "joined" && roleOf(await memberRows(id), secondId) === "editor");

  stage = "concurrent owner demotions";
  check("the race starts with two active owners", (await setRole(first, secondPath, "owner")).status === 204 && activeOwners(await memberRows(id)).length === 2);
  const raced = await Promise.all([setRole(first, secondPath, "editor"), setRole(second, firstPath, "editor")]);
  const afterRace = await memberRows(id);
  check("concurrent cross-demotions allow one write and refuse the stale actor", raced.filter((response) => response.status === 204).length === 1 && raced.filter(refused).length === 1);
  check("concurrent cross-demotions leave exactly one active owner", activeOwners(afterRace).length === 1);
  const survivorId = activeOwners(afterRace)[0].userId;
  const survivor = survivorId === firstId ? first : second;
  const demotedId = survivorId === firstId ? secondId : firstId;
  check("the surviving owner can restore the other owner", (await setRole(survivor, `${people}/${demotedId}`, "owner")).status === 204);
  const selfRace = await Promise.all([setRole(first, firstPath, "editor"), setRole(second, secondPath, "editor")]);
  check("concurrent self-demotions also leave one owner", selfRace.filter((response) => response.status === 204).length === 1 && selfRace.filter(refused).length === 1 && activeOwners(await memberRows(id)).length === 1);
  const soleId = activeOwners(await memberRows(id))[0].userId;
  const sole = soleId === firstId ? first : second;
  check("the last owner after a race still cannot leave", refused(await api(sole, `${path}/leave`, "POST")));
  if (soleId !== firstId) check("the creator can regain ownership for the handover test", (await setRole(sole, firstPath, "owner")).status === 204);
  check("the handover recipient is prepared as editor", (await setRole(first, secondPath, "editor")).status === 204);

  stage = "transactional handover and return";
  check("the room can be handed to an active member", (await api(first, `${secondPath}/handover`, "POST")).status === 204);
  const handed = await memberRows(id);
  check("handover promotes the recipient and steps the actor down together", roleOf(handed, firstId) === "editor" && roleOf(handed, secondId) === "owner" && activeOwners(handed).length === 1);
  check("the previous owner cannot manage after handover", (await api(first, people)).status === 403);
  check("the new owner can hand the room back", (await api(second, `${firstPath}/handover`, "POST")).status === 204);
  const returned = await memberRows(id);
  check("handover back restores the creator and leaves the other editor", roleOf(returned, firstId) === "owner" && roleOf(returned, secondId) === "editor" && activeOwners(returned).length === 1);
  check("an editor cannot hand the room over", (await api(second, `${firstPath}/handover`, "POST")).status === 403);

  stage = "approval must never grant ownership";
  check("the recipient can leave for an approval test", (await api(second, `${path}/leave`, "POST")).status === 204);
  check("the owner can enable approval", (await api(first, path, "PATCH", { joinPolicy: "approval" })).status === 200);
  check("the request waits without becoming an owner", (await join(second, { role: "owner" })).body?.status === "pending" && activeOwners(await memberRows(id)).length === 1);
  check("a waiting member cannot be promoted through the active-member endpoint", (await setRole(first, secondPath, "owner")).status === 404);
  check("a waiting member cannot receive a handover", (await api(first, `${secondPath}/handover`, "POST")).status === 404);
  check("an approval request cannot grant owner", (await api(first, `${secondPath}/approve`, "POST", { role: "owner" })).status === 400);
  check("a rejected owner approval leaves the request pending", (await memberRows(id)).some((row) => row.userId === secondId && row.status === "pending" && row.role !== "owner"));
  check("normal editor approval still works", (await api(first, `${secondPath}/approve`, "POST", { role: "editor" })).status === 204);

  stage = "audit entries";
  const audited = await database.db.select({ actorId: schema.auditEvents.actorId, action: schema.auditEvents.action, data: schema.auditEvents.data })
    .from(schema.auditEvents).where(eq(schema.auditEvents.targetId, id));
  check("owner promotion is audited with recipient and role", audited.some((event) => event.action === "room.member.role" && event.actorId === firstId && event.data?.personId === secondId && event.data?.role === "owner"));
  check("handover records the actor stepping down too", audited.some((event) => event.action === "room.member.role" && event.actorId === firstId && event.data?.personId === firstId && event.data?.role === "editor"));
  check("handover back records both changed people", audited.some((event) => event.action === "room.member.role" && event.actorId === secondId && event.data?.personId === firstId && event.data?.role === "owner") && audited.some((event) => event.action === "room.member.role" && event.actorId === secondId && event.data?.personId === secondId && event.data?.role === "editor"));
  check("owner removal and leave are audited", ["room.member.remove", "room.member.leave"].every((action) => audited.some((event) => event.action === action)));

  stage = "interview refusal";
  const workspace = await database.db.query.rooms.findFirst({ where: eq(schema.rooms.id, id) });
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const interviewId = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  await database.db.transaction(async (tx) => {
    await tx.insert(schema.rooms).values({ id: interviewId, orgId: workspace.orgId, name: `Owner interview ${stamp}`, kind: "interview", createdBy: firstId });
    await tx.insert(schema.roomMembers).values([{ roomId: interviewId, userId: firstId, role: "interviewer" }, { roomId: interviewId, userId: secondId, role: "candidate" }]);
  });
  ownedRooms.add(interviewId);
  const interview = `/api/rooms/${interviewId}`;
  const interviewResponses = await Promise.all([
    api(first, `${interview}/people`),
    api(first, `${interview}/people/${secondId}`, "PATCH", { role: "owner" }),
    api(first, `${interview}/people/${secondId}`, "DELETE"),
    api(first, `${interview}/people/${secondId}/approve`, "POST", { role: "editor" }),
    api(first, `${interview}/people/${secondId}/handover`, "POST"),
    api(first, `${interview}/leave`, "POST"),
  ]);
  check("interview membership and handover routes remain refused", interviewResponses.every((response) => response.status === 403));
  check("interview roles are unchanged", roleOf(await memberRows(interviewId), firstId) === "interviewer" && roleOf(await memberRows(interviewId), secondId) === "candidate");
} catch (error) {
  results.push(false);
  console.log(`FAIL  ownership workflow completes (${stage}; ${error?.name ?? "Error"})`);
} finally {
  for (const connection of connections.reverse()) { try { connection.close(); } catch { /* Closing twice is harmless. */ } }
  for (const id of ownedRooms) {
    let removed = false;
    for (const cookie of cookies) {
      try { if ((await api(cookie, `/api/rooms/${id}`, "DELETE")).status === 204) { removed = true; break; } } catch { /* Try the other owner, then exact fixture cleanup. */ }
    }
    if (!removed) {
      try {
        await database.db.delete(schema.rooms).where(eq(schema.rooms.id, id));
        await database.db.delete(schema.docUpdates).where(like(schema.docUpdates.docName, `room:${id}:%`));
        await database.db.delete(schema.docSnapshots).where(like(schema.docSnapshots.docName, `room:${id}:%`));
      } catch { results.push(false); console.log("FAIL  exact disposable room cleanup completes"); }
    }
  }
  try {
    const remaining = ownedRooms.size ? await database.db.select({ id: schema.rooms.id }).from(schema.rooms).where(inArray(schema.rooms.id, [...ownedRooms])) : [];
    const cleanup = remaining.length === 0;
    results.push(cleanup); console.log(`${cleanup ? "PASS" : "FAIL"}  all disposable rooms and cascaded memberships are removed`);
    if (seededBefore) {
      const after = (await memberRows("E2ETST")).filter((row) => [firstId, secondId].includes(row.userId));
      const normalize = (rows) => JSON.stringify([...rows].sort((a, b) => a.userId.localeCompare(b.userId)));
      const unchanged = normalize(after) === normalize(seededBefore);
      results.push(unchanged); console.log(`${unchanged ? "PASS" : "FAIL"}  seeded room memberships are unchanged`);
    }
  } catch { results.push(false); console.log("FAIL  final cleanup verification completes"); }
  for (const cookie of cookies) await api(cookie, "/api/auth/sign-out", "POST", {}).catch(() => {});
  await database.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
