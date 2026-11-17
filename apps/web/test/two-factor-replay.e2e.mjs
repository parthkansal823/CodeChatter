/** Prove authenticator codes are single-use across enrollment and independent browser challenges using one disposable account, then remove the exact fixture even on failure. */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const { BASE, launch, check, finish, sleep } = await import("./browser.mjs");
const apiRequire = createRequire(new URL("../../api/package.json", import.meta.url));
const load = (name) => import(pathToFileURL(apiRequire.resolve(name)).href);
const email = `sec-totp-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}@codechatter.local`;
const password = `Totp-${randomBytes(20).toString("base64url")}!`;
const mailpit = process.env.SECURITY_E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const replayMessage = "That code has just been used. Wait for the next one.";
let stage = "initialisation";
let browser, firstContext, secondContext, auth, dbHandle, redis, server, transport;
let userId, personalOrgId, secret;
let pageErrors = [];
let interrupted = false;
let lastVerificationStatus = "none";
let lastAcceptedWindow = -1;
const usedCodes = new Set();

/** RFC 6238 SHA-1, decoded from the actual base32 secret shown by the settings UI. */
function totp(base32, now = Date.now()) {
  let bits = "";
  for (const character of base32.toUpperCase().replace(/[\s=]/g, "")) {
    const index = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    if (index < 0) throw new Error("InvalidAuthenticatorSecret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}
async function until(operation, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !interrupted) {
    const value = await operation();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(interrupted ? "Interrupted" : "ConditionTimeout");
}
async function nextAuthenticatorCode() {
  return until(() => {
    const now = Date.now();
    const window = Math.floor(now / 30_000);
    // Leave nearly a full period for the first verification and the replay.
    if (window === lastAcceptedWindow || now % 30_000 >= 3000) return null;
    const code = totp(secret, now);
    // An unrelated later counter can very rarely produce the same six digits.
    if (usedCodes.has(code)) return null;
    lastAcceptedWindow = window;
    usedCodes.add(code);
    return code;
  }, 95_000);
}
function observe(page) {
  // Playwright call logs and raw errors may contain entered credentials/codes.
  page.on("pageerror", () => pageErrors.push("PageError"));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/auth/two-factor/verify-totp") lastVerificationStatus = String(response.status());
  });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  return page;
}
async function freshSession(context) {
  const response = await context.request.get(`${BASE}/api/auth/get-session?disableCookieCache=true`);
  return response.ok() ? response.json() : null;
}
async function account(page) {
  await page.goto(`${BASE}/settings/account`);
  await page.getByRole("heading", { name: "Account security", exact: true }).waitFor();
  await page.getByRole("button", { name: "Turn on", exact: true }).waitFor();
}
async function challenge(page, trustDevice = false) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/two-factor(?:\?|$)/);
  await page.getByRole("checkbox").setChecked(trustDevice);
  await page.getByLabel("6-digit code").waitFor();
}
async function submitCode(page, code) {
  const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/auth/two-factor/verify-totp" && reply.request().method() === "POST");
  await page.getByLabel("6-digit code").fill(code);
  return response;
}
async function verificationLink() {
  return until(async () => {
    const list = await fetch(`${mailpit}/api/v1/messages`).then((response) => response.json());
    const message = list.messages?.find((item) => item.To?.some((to) => to.Address?.toLowerCase() === email));
    if (!message) return null;
    const contents = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`).then((response) => response.json());
    const link = String(contents.Text ?? "").match(/https?:\/\/[^\s<>]+\/api\/auth\/verify-email\?[^\s<>]+/)?.[0];
    if (!link) return null;
    const url = new URL(link);
    if (url.origin !== new URL(BASE).origin || url.pathname !== "/api/auth/verify-email") throw new Error("UnexpectedVerificationOrigin");
    return url.href;
  });
}

/** Reuse the account-security suite's recipient-limited signup handler and real Mailpit verification, without changing the shared API or its mail configuration. */
async function initialiseFixtureAuth() {
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("LocalDevelopmentOnly");
  if (!process.env.DATABASE_URL || !process.env.VALKEY_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("MissingDevelopmentConfiguration");
  process.env.CODECHATTER_SECURITY_E2E = "1";
  const [{ createAuth, createOriginPolicy }, { createDb }, { default: Redis }, { toNodeHandler }, { default: nodemailer }] = await Promise.all([
    load("@codechatter/auth"), load("@codechatter/db"), load("ioredis"), load("better-auth/node"), load("nodemailer"),
  ]);
  dbHandle = createDb(process.env.DATABASE_URL, { max: 2 });
  redis = new Redis(process.env.VALKEY_URL, { maxRetriesPerRequest: 2 });
  redis.on("error", () => {});
  transport = nodemailer.createTransport({ host: "127.0.0.1", port: 1025, secure: false });
  const sendOwnMail = async (to, url) => {
    if (to.email !== email) throw new Error("FixtureRecipientOnly");
    await transport.sendMail({ from: "security-test@codechatter.local", to: email, subject: "CodeChatter disposable TOTP verification", text: url });
  };
  auth = createAuth({
    db: dbHandle.db, redis, appUrl: BASE, secret: process.env.BETTER_AUTH_SECRET, production: false,
    origins: createOriginPolicy({ appUrl: BASE, allowPrivateNetwork: false }),
    mail: { sendVerificationEmail: sendOwnMail, sendPasswordResetEmail: sendOwnMail, sendOrgInvitationEmail: async () => { throw new Error("NoFixtureInvitations"); } },
  });
  const isolatedContext = await auth.$context;
  for (const key of Object.keys(isolatedContext.logger)) {
    if (typeof isolatedContext.logger[key] === "function") isolatedContext.logger[key] = () => {};
  }
  const handler = toNodeHandler(auth);
  server = createServer((request, response) => {
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/api/auth/sign-up/email") { response.writeHead(404).end(); return; }
    void handler(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}/api/auth/sign-up/email`;
}

/** Native deletion plus an ownership-checked adapter fallback also handles a failed two-factor sign-in. */
async function cleanupFixture() {
  if (!auth || !dbHandle) return;
  const adapter = (await auth.$context).internalAdapter;
  const ownUser = (await adapter.findUserByEmail(email))?.user;
  if (!ownUser) return;
  if (ownUser.email !== email || (userId && ownUser.id !== userId)) throw new Error("FixtureOwnershipMismatch");
  userId = ownUser.id;
  const { schema } = await load("@codechatter/db");
  const { eq, and } = await load("drizzle-orm");
  const sessions = await dbHandle.db.query.session.findMany({ where: eq(schema.session.userId, userId) });
  const tokens = sessions.map((session) => session.token);
  const org = await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.slug, `u-${userId}`) });
  if (org) {
    let metadata;
    try { metadata = JSON.parse(org.metadata ?? "null"); } catch { metadata = null; }
    const members = await dbHandle.db.query.member.findMany({ where: eq(schema.member.organizationId, org.id) });
    if (metadata?.personal !== true || (personalOrgId && personalOrgId !== org.id) || members.some((member) => member.userId !== userId)) throw new Error("FixtureWorkspaceOwnershipMismatch");
    personalOrgId = org.id;
  }
  let nativeDeleted = false;
  for (const context of [firstContext, secondContext]) {
    if (!context || nativeDeleted) continue;
    try {
      const cookies = await context.cookies(BASE);
      const headers = new Headers({ cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), origin: BASE });
      nativeDeleted = (await auth.api.deleteUser({ headers, body: { password } })).success === true;
    } catch { /* The exact-fixture fallback below also cleans up incomplete challenges. */ }
  }
  if (!nativeDeleted || await adapter.findUserByEmail(email)) {
    await adapter.deleteUserSessions(userId);
    await adapter.deleteUser(userId);
  }
  await adapter.deleteSessions(tokens);
  await adapter.deleteUserSessions(userId);
  if (personalOrgId) await dbHandle.db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.organization).where(and(eq(schema.organization.id, personalOrgId), eq(schema.organization.slug, `u-${userId}`))).for("update");
    if (!current) return;
    const members = await tx.select().from(schema.member).where(eq(schema.member.organizationId, current.id));
    if (members.length || JSON.parse(current.metadata ?? "null")?.personal !== true) throw new Error("FixtureWorkspaceNotEmpty");
    await tx.delete(schema.organization).where(eq(schema.organization.id, current.id));
  });
  verify("disposable account and its personal workspace are deleted", !(await adapter.findUserByEmail(email)) && (!personalOrgId || !(await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.id, personalOrgId) }))));
}

async function run() {
  verify("RFC 6238 matches the published SHA-1 test vector", totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000) === "287082");
  stage = "shared API and Mailpit preflight";
  const responses = await Promise.all([fetch(`${BASE}/api/meta`, { signal: AbortSignal.timeout(15_000) }), fetch(`${BASE}/api/auth/get-session`, { signal: AbortSignal.timeout(15_000) }), fetch(`${mailpit}/api/v1/messages`, { signal: AbortSignal.timeout(15_000) })]);
  verify("shared API and local Mailpit are ready", responses.every((response) => response.ok));
  stage = "disposable signup and real verification";
  const signupEndpoint = await initialiseFixtureAuth();
  ({ browser, errors: pageErrors } = await launch());
  firstContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const first = observe(await firstContext.newPage());
  await first.route("**/api/auth/sign-up/email", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (route.request().postDataJSON().email !== email) throw new Error("FixtureSignupOnly");
    await route.fulfill({ response: await route.fetch({ url: signupEndpoint }) });
  });
  await first.goto(`${BASE}/sign-up?returnTo=${encodeURIComponent("/settings/account")}`);
  await first.getByLabel("Name", { exact: true }).fill("TOTP replay browser fixture");
  await first.getByLabel("Email", { exact: true }).fill(email);
  await first.getByLabel("Password", { exact: true }).fill(password);
  await first.getByRole("button", { name: "Create account", exact: true }).click();
  await first.waitForURL(/\/verify-email\?/);
  await first.unroute("**/api/auth/sign-up/email");
  await first.goto(await verificationLink());
  await account(first);
  const me = await firstContext.request.get(`${BASE}/api/me`).then((response) => response.json());
  userId = me.user?.id;
  personalOrgId = me.personalOrgId;
  verify("the fixture is a genuinely verified disposable account", me.user?.email === email && Boolean(userId) && Boolean(personalOrgId) && Boolean((await freshSession(firstContext))?.user?.emailVerified));

  stage = "authenticator enrollment";
  await first.getByRole("button", { name: "Turn on", exact: true }).click();
  await first.locator("#two-factor-password").fill(password);
  await first.getByRole("button", { name: "Continue", exact: true }).click();
  await first.getByTestId("totp-secret").waitFor();
  secret = (await first.getByTestId("totp-secret").textContent()).replace(/\s/g, "");
  const enrollmentCode = await nextAuthenticatorCode();
  await first.getByLabel("Authenticator code", { exact: true }).fill(enrollmentCode);
  await first.getByRole("button", { name: "Confirm code", exact: true }).click();
  await first.getByLabel("Backup codes", { exact: true }).waitFor();
  verify("a real authenticator code enables two-factor sign-in", Boolean((await freshSession(firstContext))?.user?.twoFactorEnabled));
  await first.getByRole("button", { name: "I've saved these codes", exact: true }).click();
  verify("fixture session signs out", (await firstContext.request.post(`${BASE}/api/auth/sign-out`, { headers: { origin: BASE }, data: {} })).ok());
  await challenge(first);
  stage = "enrollment code cannot sign in again";
  const enrollmentReplay = await submitCode(first, enrollmentCode);
  verify("enrollment consumes the code for subsequent sign-in too", !enrollmentReplay.ok() && !(await freshSession(firstContext)));
  await first.getByRole("alert").filter({ hasText: replayMessage }).waitFor();

  stage = "independent sign-in challenge";
  secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" });
  const second = observe(await secondContext.newPage());
  await challenge(second, true);
  verify("both browsers are sessionless before authenticator verification", !(await freshSession(firstContext)) && !(await freshSession(secondContext)));
  stage = "first fresh code succeeds";
  const acceptedCode = await nextAuthenticatorCode();
  const accepted = await submitCode(first, acceptedCode);
  await first.waitForURL(/\/dashboard(?:\?|$)/);
  verify("the first browser signs in with a fresh code", accepted.ok() && (await freshSession(firstContext))?.user?.id === userId);
  stage = "second browser cannot replay accepted code";
  const replayed = await submitCode(second, acceptedCode);
  verify("the independent challenge refuses the accepted code", !replayed.ok());
  await second.getByRole("alert").filter({ hasText: replayMessage }).waitFor();
  verify("another browser receives the kinder replay message", !replayed.ok() && new URL(second.url()).pathname === "/two-factor");
  verify("rejected browser gets no session and the accepted session stays valid", !(await freshSession(secondContext)) && (await freshSession(firstContext))?.user?.id === userId);
  verify("a rejected replay cannot create a trusted-device cookie", !(await secondContext.cookies(BASE)).some((cookie) => cookie.name === "cc.trust_device" || cookie.name === "__Secure-cc.trust_device"));
  stage = "next code succeeds in the rejected challenge";
  const next = await submitCode(second, await nextAuthenticatorCode());
  await second.waitForURL(/\/dashboard(?:\?|$)/);
  verify("the next code completes the same rejected challenge", next.ok() && (await freshSession(secondContext))?.user?.id === userId);
  verify("no browser page errors occurred", pageErrors.length === 0);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; void browser?.close(); });
try { await run(); }
catch (error) {
  const name = /^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "Error";
  check("two-factor replay workflow completes", false, `${stage}: ${name}; last verification HTTP ${lastVerificationStatus}`);
}
finally {
  try { await cleanupFixture(); }
  catch { check("disposable fixture cleanup completes", false, "Exact fixture cleanup failed; no unrelated data was changed."); }
  secret = undefined;
  usedCodes.clear();
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  transport?.close();
  if (redis) await redis.quit().catch(() => redis.disconnect());
  await dbHandle?.close().catch(() => {});
}
finish();
