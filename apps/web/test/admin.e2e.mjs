/** Exercise instance-admin views and confirmed account changes with a disposable account and private room, leaving seeded roles and memberships untouched. */
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const { BASE, PASSWORD, check, finish, launch } = await import("./browser.mjs");
const apiRequire = createRequire(new URL("../../api/package.json", import.meta.url));
const load = (name) => import(pathToFileURL(apiRequire.resolve(name)).href);
const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const email = `sec-admin-${stamp}@codechatter.local`;
const name = `Admin browser fixture ${stamp}`;
const password = `Admin-${randomBytes(20).toString("base64url")}!`;
let stage = "initialisation";
let browser, dbHandle, redis, auth, admin, ordinary, subject, roomId, userId, personalOrgId;
const contexts = [];
const pageErrors = [];

function verify(label, ok) {
  check(label, ok);
  if (!ok) throw new Error("CheckFailed");
}
async function request(person, path, method = "GET", data) {
  const response = await person.context.request.fetch(`${BASE}/api/${path}`, { method, headers: { origin: BASE }, ...(data !== undefined && { data }) });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
async function profile(address, secret = PASSWORD) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    pageErrors.push("PageError");
    // UI diagnostics only: redact fixture credentials, URLs and labelled auth material.
    const message = error.message.split("\n")[0].replaceAll(password, "[redacted]").replaceAll(PASSWORD, "[redacted]").replace(/https?:\/\/\S+/g, "[url]").replace(/(?:password|token|secret|cookie|authorization)\s*[:=]\s*\S+/gi, "[redacted]").slice(0, 180);
    console.error(`PAGE ERROR  ${new URL(page.url()).pathname}: ${message}`);
  });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const person = { context, page };
  const signedIn = await request(person, "auth/sign-in/email", "POST", { email: address, password: secret });
  if (signedIn.status !== 200) throw new Error("SignInFailed");
  return person;
}
async function freshSession(person) {
  return (await request(person, "auth/get-session?disableCookieCache=true")).body;
}
async function shot(label) {
  if (process.env.SHOTS) await admin.page.screenshot({ path: join(process.env.SHOTS, `${label}.png`), fullPage: true });
}
async function searchUsers(value) {
  await admin.page.getByLabel("Name or email", { exact: true }).fill(value);
  await admin.page.getByRole("search", { name: "Search users", exact: true }).getByRole("button", { name: "Search", exact: true }).click();
}
const subjectRow = () => admin.page.getByRole("table", { name: "Instance users", exact: true }).getByRole("row").filter({ has: admin.page.getByText(email, { exact: true }) });
async function confirmAction(label) {
  const dialog = admin.page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function userState() {
  const found = await request(admin, `admin/users?search=${encodeURIComponent(email)}&page=1&pageSize=25`);
  return found.body?.items?.find((user) => user.id === userId);
}
async function fixture() {
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("LocalDevelopmentOnly");
  const [{ createAuth, hashPassword }, { createDb }, { default: Redis }] = await Promise.all([load("@codechatter/auth"), load("@codechatter/db"), load("ioredis")]);
  dbHandle = createDb(process.env.DATABASE_URL, { max: 2 });
  redis = new Redis(process.env.VALKEY_URL, { maxRetriesPerRequest: 2 });
  redis.on("error", () => {});
  const noMail = async () => { throw new Error("NoFixtureMail"); };
  auth = createAuth({ db: dbHandle.db, redis, appUrl: BASE, secret: process.env.BETTER_AUTH_SECRET, production: false, mail: { sendVerificationEmail: noMail, sendPasswordResetEmail: noMail, sendOrgInvitationEmail: noMail } });
  const ctx = await auth.$context;
  for (const key of Object.keys(ctx.logger)) if (typeof ctx.logger[key] === "function") ctx.logger[key] = () => {};
  const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: true }, { method: "admin" });
  userId = user.id;
  await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: await hashPassword(password) });
}
async function cleanup() {
  if (!auth || !dbHandle) return;
  const adapter = (await auth.$context).internalAdapter;
  const own = (await adapter.findUserByEmail(email))?.user;
  if (!own) return;
  if ((userId && own.id !== userId) || own.email !== email) throw new Error("FixtureOwnershipMismatch");
  userId = own.id;
  const { schema } = await load("@codechatter/db");
  const { eq, and } = await load("drizzle-orm");
  if (roomId) {
    const room = await dbHandle.db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) });
    if (room && room.createdBy !== userId) throw new Error("FixtureRoomOwnershipMismatch");
    await dbHandle.db.delete(schema.rooms).where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.createdBy, userId)));
  }
  const organization = await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.slug, `u-${userId}`) });
  if (organization) {
    let metadata;
    try { metadata = JSON.parse(organization.metadata ?? "null"); } catch { metadata = null; }
    const members = await dbHandle.db.query.member.findMany({ where: eq(schema.member.organizationId, organization.id) });
    if (metadata?.personal !== true || members.some((member) => member.userId !== userId)) throw new Error("FixtureWorkspaceOwnershipMismatch");
    personalOrgId = organization.id;
  }
  const sessions = await dbHandle.db.query.session.findMany({ where: eq(schema.session.userId, userId) });
  await adapter.deleteUserSessions(userId);
  await adapter.deleteSessions(sessions.map((session) => session.token));
  await adapter.deleteUser(userId);
  if (personalOrgId) await dbHandle.db.delete(schema.organization).where(and(eq(schema.organization.id, personalOrgId), eq(schema.organization.slug, `u-${userId}`)));
  verify("the exact disposable user, private room and personal workspace are deleted", !(await adapter.findUserByEmail(email)) && (!roomId || !(await dbHandle.db.query.rooms.findFirst({ where: eq(schema.rooms.id, roomId) }))) && (!personalOrgId || !(await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.id, personalOrgId) }))));
}

try {
  stage = "create disposable account";
  await fixture();
  ({ browser } = await launch());
  [admin, ordinary, subject] = await Promise.all([profile("test1@codechatter.local"), profile("test2@codechatter.local"), profile(email, password)]);
  verify("seeded test1 is an instance admin and test2 is ordinary", (await request(admin, "admin/access")).status === 200 && (await request(ordinary, "admin/access")).status === 404);
  const room = await request(subject, "rooms", "POST", { name: `Admin room ${stamp}`, templateId: "blank", visibility: "private", joinPolicy: "invite" });
  verify("the disposable user can create a private room", room.status === 201 && Boolean(room.body?.id));
  roomId = room.body.id;
  stage = "admin menu and users";
  await admin.page.goto(`${BASE}/dashboard`);
  stage = "open admin user menu";
  await admin.page.getByRole("button", { name: /test1@codechatter\.local/ }).click();
  stage = "follow instance-admin menu link";
  await admin.page.getByRole("menuitem", { name: "Instance admin", exact: true }).click();
  stage = "render instance administration";
  await admin.page.getByRole("heading", { name: "Instance admin", exact: true }).waitFor();
  verify("the admin link opens all three administration sections", await admin.page.getByRole("tab", { name: "Users", exact: true }).isVisible() && await admin.page.getByRole("tab", { name: "Rooms", exact: true }).isVisible() && await admin.page.getByRole("tab", { name: "Health", exact: true }).isVisible());
  await searchUsers("test1@codechatter.local");
  const selfRow = admin.page.getByRole("table", { name: "Instance users", exact: true }).getByRole("row").filter({ has: admin.page.getByText("test1@codechatter.local", { exact: true }) });
  await selfRow.waitFor();
  verify("the admin's own ban and demotion controls are disabled", await selfRow.getByRole("button", { name: "Ban", exact: true }).isDisabled() && await selfRow.getByRole("button", { name: "Remove admin", exact: true }).isDisabled());
  await searchUsers(name);
  await subjectRow().waitFor();
  verify("users can be found by name with joined, security and organisation metadata", (await subjectRow().innerText()).includes("Email verified") && (await subjectRow().innerText()).includes("Two-factor off") && (await subjectRow().innerText()).includes("workspace"));
  await searchUsers(email);
  await subjectRow().waitFor();
  verify("users can be found by email and pagination starts on page one", await admin.page.getByRole("navigation", { name: "Users pages", exact: true }).getByRole("button", { name: "Previous", exact: true }).isDisabled());
  await shot("admin-users");
  stage = "ban confirmation";
  await subjectRow().getByRole("button", { name: "Ban", exact: true }).click();
  await admin.page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  verify("cancelling the ban does not change the account", (await userState())?.banned === false);
  await subjectRow().getByRole("button", { name: "Ban", exact: true }).click();
  await admin.page.getByRole("alertdialog").getByRole("button", { name: "Ban account", exact: true }).click();
  await admin.page.getByRole("alertdialog").getByText("Add a reason for this ban.", { exact: true }).waitFor();
  verify("a ban requires a reason before any account change", (await userState())?.banned === false);
  await admin.page.getByRole("alertdialog").getByLabel("Reason", { exact: true }).fill("Disposable browser moderation check");
  const end = await admin.page.evaluate(() => { const value = new Date(Date.now() + 3_600_000); const pad = (n) => String(n).padStart(2, "0"); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`; });
  await admin.page.getByRole("alertdialog").getByLabel("End time (optional)", { exact: true }).fill(end);
  await confirmAction("Ban account");
  await subjectRow().getByRole("button", { name: "Unban", exact: true }).waitFor();
  verify("a confirmed ban records its reason and optional end", (await subjectRow().innerText()).includes("Disposable browser moderation check") && Boolean((await userState())?.banExpires));
  await shot("admin-banned");
  const denied = await request(subject, "auth/sign-in/email", "POST", { email, password });
  verify("the banned account cannot sign in and loses its prior session", denied.status !== 200 && !(await freshSession(subject)));
  stage = "unban and session revocation";
  await subjectRow().getByRole("button", { name: "Unban", exact: true }).click();
  await confirmAction("Unban account");
  await subjectRow().getByRole("button", { name: "Ban", exact: true }).waitFor();
  verify("unban allows a fresh sign-in", (await request(subject, "auth/sign-in/email", "POST", { email, password })).status === 200);
  await subjectRow().getByRole("button", { name: "Sign out everywhere", exact: true }).click();
  await confirmAction("Sign out everywhere");
  verify("confirmed sign-out revokes the disposable account's sessions", !(await freshSession(subject)));
  stage = "instance role confirmations";
  await subjectRow().getByRole("button", { name: "Make admin", exact: true }).click();
  await confirmAction("Make instance admin");
  await subjectRow().getByRole("button", { name: "Remove admin", exact: true }).waitFor();
  verify("confirmed promotion grants instance-admin role", (await userState())?.role === "admin");
  await subjectRow().getByRole("button", { name: "Remove admin", exact: true }).click();
  await confirmAction("Remove admin access");
  await subjectRow().getByRole("button", { name: "Make admin", exact: true }).waitFor();
  verify("confirmed demotion restores the disposable account's ordinary role", (await userState())?.role === "user");
  stage = "room search and membership boundary";
  await admin.page.getByRole("tab", { name: "Rooms", exact: true }).click();
  await admin.page.getByLabel("Room code or name", { exact: true }).fill(roomId);
  await admin.page.getByRole("search", { name: "Search rooms", exact: true }).getByRole("button", { name: "Search", exact: true }).click();
  const roomRow = admin.page.getByRole("table", { name: "Instance rooms", exact: true }).getByRole("row").filter({ hasText: roomId });
  await roomRow.waitFor();
  verify("room search shows owner, organisation, visibility and sandbox status", (await roomRow.innerText()).includes(name) && (await roomRow.innerText()).includes("private") && /Running|Stopped|Couldn't tell/.test(await roomRow.innerText()));
  verify("the page explains that admin does not grant file access", await admin.page.getByText("Being an instance admin does not grant access to a room or its files. Normal room permissions still apply.", { exact: true }).isVisible());
  await shot("admin-rooms");
  const boundary = await admin.page.goto(`${BASE}/rooms/${roomId}`);
  verify("the admin cannot open a private room they do not belong to", boundary?.status() === 404);
  stage = "health and phone";
  await admin.page.goto(`${BASE}/admin`);
  await admin.page.getByRole("tab", { name: "Health", exact: true }).click();
  await admin.page.getByRole("table", { name: "Instance health", exact: true }).waitFor();
  verify("health displays service states and check times", await admin.page.getByRole("table", { name: "Instance health", exact: true }).getByRole("row").count() > 1 && await admin.page.getByText(/^Last checked /).isVisible());
  await shot("admin-health");
  await admin.page.getByRole("button", { name: "Check now", exact: true }).click();
  await admin.page.setViewportSize({ width: 390, height: 844 });
  await admin.page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.classList.remove("light"); });
  verify("the health page fits a phone with horizontally scrollable tables", await admin.page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth));
  await shot("admin-phone-dark");
  stage = "ordinary user cannot discover admin";
  await ordinary.page.goto(`${BASE}/dashboard`);
  await ordinary.page.getByRole("button", { name: /test2@codechatter\.local/ }).click();
  verify("the ordinary user has no instance-admin menu link", await ordinary.page.getByRole("menuitem", { name: "Instance admin", exact: true }).count() === 0);
  await ordinary.page.keyboard.press("Escape");
  const missing = await ordinary.page.goto(`${BASE}/admin`);
  verify("the ordinary user gets a plain 404", missing?.status() === 404 && await ordinary.page.getByRole("heading", { name: "Instance admin", exact: true }).count() === 0);
  const outside = await browser.newContext();
  contexts.push(outside);
  const outsideResponse = await outside.request.get(`${BASE}/admin`, { maxRedirects: 0 });
  verify("signed-out visitors get a plain 404 too", outsideResponse.status() === 404);
  const staleCookies = await admin.context.cookies(BASE);
  verify("the browser test ends its own admin session", (await request(admin, "auth/sign-out", "POST", {})).status === 200);
  await outside.addCookies(staleCookies);
  const staleResponse = await outside.request.get(`${BASE}/admin`, { maxRedirects: 0 });
  verify("a revoked admin-session cookie still gets a plain 404", staleResponse.status() === 404);
} catch (error) {
  check("instance-admin browser workflow completes", false, `${stage}: ${/^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "Error"}`);
  if (admin?.page && process.env.SHOTS) await shot("admin-failure").catch(() => {});
} finally {
  try { await cleanup(); } catch { check("exact disposable fixture cleanup completes", false); }
  for (const person of [admin, ordinary, subject]) if (person) await request(person, "auth/sign-out", "POST", {}).catch(() => {});
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (redis) await redis.quit().catch(() => redis.disconnect());
  await dbHandle?.close().catch(() => {});
}
check("no browser page errors", pageErrors.length === 0);
finish();
