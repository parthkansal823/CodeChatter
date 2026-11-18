/** Exercise instance administration, live revocation and audit through the shared API using only disposable accounts and rooms; seeded accounts are read-only fixtures. */
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { createAuth, hashPassword } from "@codechatter/auth";
import { createDb, schema } from "@codechatter/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Redis } from "ioredis";
import WebSocket from "ws";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("LocalDevelopmentOnly");
if (!process.env.DATABASE_URL || !process.env.VALKEY_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("MissingTestConfiguration");
const database = createDb(process.env.DATABASE_URL, { max: 3 });
const redis = new Redis(process.env.VALKEY_URL, { maxRetriesPerRequest: 2 });
redis.on("error", () => {});
const auth = createAuth({
  db: database.db, redis, appUrl: BASE, secret: process.env.BETTER_AUTH_SECRET, production: false,
  mail: { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {}, sendOrgInvitationEmail: async () => {} },
});
const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const tag = `sec-admin-api-${stamp}`;
const password = `Admin-${randomBytes(24).toString("base64url")}!`;
const fixtures = ["operator", "organisation-owner", "target", "extra"].map((label, index) => ({
  id: randomUUID(), name: `${label} ${tag}`, email: `${tag}-${index}@codechatter.local`, role: index === 0 ? "admin" : "user",
}));
const [operator, ordinary, target] = fixtures;
const orgId = `admin-api-${stamp}`;
const roomId = `AD${randomBytes(2).toString("hex").toUpperCase()}`;
const roomName = `Admin private room ${stamp}`;
const results = [];
const clients = [];
const connections = [];
let stage = "fixture setup";
let seededBefore;

function verify(name, passed) {
  results.push(Boolean(passed));
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}`);
  if (!passed) throw new Error("CheckFailed");
}
async function until(probe, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await probe()) return true;
    await sleep(150);
  } while (Date.now() < deadline);
  return false;
}
function person() {
  const cookies = new Map();
  const call = async (path, method = "GET", body) => {
    const response = await fetch(`${BASE}/api/${path}`, {
      method, signal: AbortSignal.timeout(45_000),
      headers: { origin: BASE, cookie: call.cookie(), ...(body !== undefined && { "content-type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (/max-age=0/i.test(cookie)) cookies.delete(pair.slice(0, at));
      else cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  call.cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  clients.push(call);
  return call;
}
async function signIn(user) {
  const call = person();
  const response = await call("auth/sign-in/email", "POST", { email: user.email, password });
  verify("a disposable fixture signs in", response.status === 200);
  return call;
}
async function sessionOf(call) {
  const response = await call("auth/get-session?disableCookieCache=true");
  return response.status === 200 ? response.body : null;
}
function noCredentials(value) {
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).every(([key, child]) => !/^(?:token|sessionToken|password|passwordHash|secret|accessToken|refreshToken|backupCodes)$/i.test(key) && noCredentials(child));
}
async function openDocument(call) {
  const requireCollab = createRequire(new URL("../../collab/package.json", import.meta.url));
  const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import(pathToFileURL(requireCollab.resolve("@hocuspocus/provider")).href);
  const Y = await import(pathToFileURL(requireCollab.resolve("yjs")).href);
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie: call.cookie(), origin: BASE } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${roomId}:files`, document: doc, token: "cookie" });
  let destroyed = false;
  const state = { closed: 0, close: () => {
    if (destroyed) return;
    destroyed = true;
    try { provider.destroy(); } finally { socket.destroy(); doc.destroy(); }
  } };
  connections.push(state);
  provider.on("close", () => { state.closed++; });
  const synced = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 15_000);
    const finish = (ok) => { clearTimeout(timeout); resolve(ok); };
    provider.on("synced", () => finish(true));
    provider.on("authenticationFailed", () => finish(false));
  });
  provider.attach();
  verify("the disposable member has a real live editor connection before the ban", await synced);
  return state;
}
async function seedSnapshot() {
  return database.db.select({ id: schema.user.id, email: schema.user.email, role: schema.user.role, banned: schema.user.banned, twoFactorEnabled: schema.user.twoFactorEnabled }).from(schema.user)
    .where(inArray(schema.user.email, ["test1@codechatter.local", "test2@codechatter.local"])).orderBy(schema.user.email);
}

try {
  const fixtureContext = await auth.$context;
  for (const key of Object.keys(fixtureContext.logger)) {
    if (typeof fixtureContext.logger[key] === "function") fixtureContext.logger[key] = () => {};
  }
  seededBefore = await seedSnapshot();
  verify("the seed makes test1 an instance admin and leaves test2 ordinary", seededBefore.find((u) => u.email === "test1@codechatter.local")?.role?.split(",").includes("admin") && !seededBefore.find((u) => u.email === "test2@codechatter.local")?.role?.split(",").includes("admin"));
  const hash = await hashPassword(password);
  await database.db.transaction(async (tx) => {
    await tx.insert(schema.user).values(fixtures.map((user) => ({ ...user, emailVerified: true })));
    await tx.insert(schema.account).values(fixtures.map((user) => ({ id: randomUUID(), userId: user.id, accountId: user.id, providerId: "credential", password: hash })));
    await tx.insert(schema.organization).values({ id: orgId, name: `Admin test organisation ${stamp}`, slug: orgId, createdAt: new Date() });
    await tx.insert(schema.member).values([{ id: randomUUID(), organizationId: orgId, userId: ordinary.id, role: "owner", createdAt: new Date() }, { id: randomUUID(), organizationId: orgId, userId: target.id, role: "admin", createdAt: new Date() }]);
    await tx.insert(schema.rooms).values({ id: roomId, orgId, name: roomName, visibility: "private", kind: "workspace", templateId: "blank", createdBy: ordinary.id });
    await tx.insert(schema.roomMembers).values([{ roomId, userId: ordinary.id, role: "owner" }, { roomId, userId: target.id, role: "owner" }]);
  });
  const [admin, user, victim] = await Promise.all([signIn(operator), signIn(ordinary), signIn(target)]);
  const anonymous = person();
  stage = "authorization";
  const routes = [
    ["admin/access", "GET"], ["admin/users", "GET"], ["admin/rooms", "GET"], ["admin/health", "GET"],
    [`admin/users/${target.id}/ban`, "POST", { reason: "Unauthorised fixture request" }],
    [`admin/users/${target.id}/unban`, "POST", {}], [`admin/users/${target.id}/sessions/revoke`, "POST", {}],
    [`admin/users/${target.id}/role`, "POST", { role: "admin" }],
  ];
  for (const [path, method, body] of routes) {
    verify(`an ordinary organisation owner gets 404 from ${method} ${path.replace(target.id, ":userId")}`, (await user(path, method, body)).status === 404);
    verify(`an anonymous caller gets 404 from ${method} ${path.replace(target.id, ":userId")}`, (await anonymous(path, method, body)).status === 404);
  }
  verify("organisation-admin status is not instance-admin status", (await victim("admin/access")).status === 404);
  const access = await admin("admin/access");
  verify("instance-admin access identifies the authenticated operator", access.status === 200 && access.body?.userId === operator.id && access.body?.role === "admin");
  await database.db.update(schema.user).set({ role: "user" }).where(eq(schema.user.id, operator.id));
  try { verify("each request checks current database role rather than a cached session role", (await admin("admin/access")).status === 404); }
  finally { await database.db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.id, operator.id)); }

  stage = "raw plugin bypass prevention";
  for (const [path, method, body] of [
    ["admin/list-users", "GET"], ["admin/set-role", "POST", { userId: ordinary.id, role: "admin" }],
    ["admin/ban-user", "POST", { userId: ordinary.id }], ["admin/unban-user", "POST", { userId: ordinary.id }],
    ["admin/revoke-user-sessions", "POST", { userId: ordinary.id }], ["admin/impersonate-user", "POST", { userId: ordinary.id }],
    ["admin/remove-user", "POST", { userId: ordinary.id }], ["admin/list-user-sessions", "POST", { userId: ordinary.id }],
    ["admin/update-user", "POST", { userId: ordinary.id, data: { role: "admin" } }],
  ]) verify(`the raw plugin ${path} route cannot bypass the audited API`, (await admin(`auth/${path}`, method, body)).status === 404);

  stage = "user search and paging";
  const byEmail = await admin(`admin/users?${new URLSearchParams({ search: target.email, page: "1", pageSize: "2" })}`);
  verify("users can be found by email with safe status and organisation fields", byEmail.status === 200 && byEmail.body?.items?.length === 1 && byEmail.body.items[0].id === target.id && byEmail.body.items[0].emailVerified === true && byEmail.body.items[0].twoFactorEnabled === false && byEmail.body.items[0].organizations.some((org) => org.id === orgId && org.role === "admin"));
  const byName = await admin(`admin/users?${new URLSearchParams({ search: ordinary.name, page: "1", pageSize: "2" })}`);
  verify("the same search also matches names", byName.status === 200 && byName.body.items.some((item) => item.id === ordinary.id));
  const firstPage = await admin(`admin/users?${new URLSearchParams({ search: tag, page: "1", pageSize: "2" })}`);
  const secondPage = await admin(`admin/users?${new URLSearchParams({ search: tag, page: "2", pageSize: "2" })}`);
  verify("users are genuinely paged without duplicate rows", firstPage.status === 200 && secondPage.status === 200 && firstPage.body.total === 4 && firstPage.body.items.length === 2 && secondPage.body.items.length === 2 && !firstPage.body.items.some((a) => secondPage.body.items.some((b) => a.id === b.id)));
  verify("admin user responses contain no credentials or session material", noCredentials(byEmail.body) && noCredentials(firstPage.body));
  verify("invalid pagination is rejected", (await admin("admin/users?page=0&pageSize=10000")).status === 400);

  stage = "room visibility and health";
  const byCode = await admin(`admin/rooms?${new URLSearchParams({ search: roomId })}`);
  const listedRoom = byCode.body?.items?.find((item) => item.id === roomId);
  verify("an admin finds a private room's metadata without gaining membership", byCode.status === 200 && listedRoom?.organization?.id === orgId && listedRoom.visibility === "private" && listedRoom.kind === "workspace" && listedRoom.members === 2 && listedRoom.owners.length === 2 && ["running", "stopped", "unknown"].includes(listedRoom.sandbox) && Number.isFinite(Date.parse(listedRoom.lastActiveAt)));
  const byRoomName = await admin(`admin/rooms?${new URLSearchParams({ search: roomName, page: "1", pageSize: "1" })}`);
  verify("room search matches names and honours paging", byRoomName.status === 200 && byRoomName.body.pageSize === 1 && byRoomName.body.items[0]?.id === roomId);
  verify("instance admin does not grant private room or file access", [403, 404].includes((await admin(`rooms/${roomId}`)).status));
  verify("an existing room member still has normal access", (await user(`rooms/${roomId}`)).status === 200);
  const health = await admin("admin/health");
  verify("health reports timestamped up/down/unknown results safely", health.status === 200 && Number.isFinite(Date.parse(health.body?.checkedAt)) && health.body.checks.length >= 5 && health.body.checks.every((item) => typeof item.id === "string" && typeof item.label === "string" && ["up", "down", "unknown"].includes(item.status) && Number.isFinite(Date.parse(item.checkedAt))) && noCredentials(health.body));

  stage = "self-protection";
  verify("an instance admin cannot ban themselves", [400, 403, 409].includes((await admin(`admin/users/${operator.id}/ban`, "POST", { reason: "Must be refused" })).status));
  verify("an admin cannot remove their own admin rights", [400, 403, 409].includes((await admin(`admin/users/${operator.id}/role`, "POST", { role: "user" })).status));
  verify("bad ban inputs cannot change an account", (await admin(`admin/users/${target.id}/ban`, "POST", { reason: "", expiresAt: "not-a-date" })).status === 400);

  stage = "ban and live revocation";
  const connection = await openDocument(victim);
  const closedBefore = connection.closed;
  const reason = `Disposable abuse report ${stamp}`;
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  verify("an admin can ban a disposable account with reason and expiry", (await admin(`admin/users/${target.id}/ban`, "POST", { reason, expiresAt })).status === 200);
  const banned = (await database.db.select().from(schema.user).where(eq(schema.user.id, target.id)))[0];
  verify("the ban stores its reason and optional end", banned?.banned === true && banned.banReason === reason && banned.banExpires?.toISOString() === expiresAt);
  verify("banning ends the already signed-in session", await until(async () => !(await sessionOf(victim))));
  verify("banning closes the already open editor connection", await until(() => connection.closed > closedBefore));
  connection.close();
  const refused = await person()("auth/sign-in/email", "POST", { email: target.email, password });
  verify("a banned account cannot sign in", refused.status >= 400 && refused.status < 500);
  verify("an admin can unban the disposable account", (await admin(`admin/users/${target.id}/unban`, "POST", {})).status === 200);
  const unbanned = (await database.db.select().from(schema.user).where(eq(schema.user.id, target.id)))[0];
  verify("unban clears every ban field", unbanned?.banned === false && unbanned.banReason === null && unbanned.banExpires === null);
  const afterUnban = await signIn(target);
  verify("the unbanned account can sign in again", Boolean(await sessionOf(afterUnban)));
  verify("unban also revokes sessions when repeated on an unbanned account", (await admin(`admin/users/${target.id}/unban`, "POST", {})).status === 200 && await until(async () => !(await sessionOf(afterUnban))));

  stage = "sign out everywhere and role changes";
  const [deviceOne, deviceTwo] = await Promise.all([signIn(target), signIn(target)]);
  verify("sign out everywhere revokes all existing devices", (await admin(`admin/users/${target.id}/sessions/revoke`, "POST", {})).status === 200 && await until(async () => !(await sessionOf(deviceOne)) && !(await sessionOf(deviceTwo))));
  verify("an admin can grant another disposable account instance-admin rights", (await admin(`admin/users/${target.id}/role`, "POST", { role: "admin" })).status === 200);
  const promoted = await signIn(target);
  verify("the promoted account can use instance administration", (await promoted("admin/access")).status === 200);
  verify("retrying an already-saved role still completes session revocation", (await admin(`admin/users/${target.id}/role`, "POST", { role: "admin" })).status === 200 && await until(async () => !(await sessionOf(promoted))));
  const promotedAgain = await signIn(target);
  verify("an admin can revoke another account's instance-admin rights", (await admin(`admin/users/${target.id}/role`, "POST", { role: "user" })).status === 200);
  verify("a demoted account immediately loses administration despite its prior session", (await promotedAgain("admin/access")).status === 404);

  stage = "audit completeness";
  const events = await database.db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.actorId, operator.id), eq(schema.auditEvents.targetId, target.id), isNull(schema.auditEvents.orgId)));
  verify("every kind of administration change is audited with actor, target and timestamp", ["instance.user.ban", "instance.user.unban", "instance.sessions.revoke", "instance.user.role"].every((action) => events.some((event) => event.action === action && event.targetType === "user" && Number.isFinite(event.createdAt.getTime()))) && events.filter((event) => event.action === "instance.user.role").length >= 2 && events.filter((event) => event.action === "instance.user.unban").length >= 2);
  verify("the audit includes the ban reason without credential material", events.some((event) => event.action === "instance.user.ban" && JSON.stringify(event.data).includes(reason)) && noCredentials(events));
} catch (error) {
  results.push(false);
  const name = /^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "Error";
  console.error(`FAIL  admin API workflow (${stage}): ${name}`);
} finally {
  for (const connection of connections) connection.close();
  await Promise.all(clients.map((call) => call("auth/sign-out", "POST", {}).catch(() => {})));
  try {
    const adapter = (await auth.$context).internalAdapter;
    await database.db.delete(schema.rooms).where(eq(schema.rooms.id, roomId));
    await database.db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    for (const user of fixtures) {
      const found = await adapter.findUserByEmail(user.email);
      if (found?.user.id !== user.id && found?.user) throw new Error("FixtureOwnershipMismatch");
      await adapter.deleteUserSessions(user.id);
      if (found?.user) await adapter.deleteUser(user.id);
    }
    verify("all disposable accounts, organisation and room are removed", !(await database.db.select().from(schema.user).where(inArray(schema.user.id, fixtures.map((user) => user.id)))).length && !(await database.db.select().from(schema.organization).where(eq(schema.organization.id, orgId))).length && !(await database.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId))).length);
    if (seededBefore) verify("seeded accounts' roles, bans and two-factor settings remain unchanged", JSON.stringify(await seedSnapshot()) === JSON.stringify(seededBefore));
    // Instance audit events intentionally remain as the append-only history of
    // these real actions; deleting fixture users clears their actor FK only.
  } catch {
    results.push(false);
    console.error("FAIL  exact fixture cleanup");
  }
  await Promise.allSettled([database.close(), redis.quit().catch(() => redis.disconnect())]);
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
