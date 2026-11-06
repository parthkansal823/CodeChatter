/**
 * Exercises account security with a disposable account, leaving seeded users alone.
 * Run with the shared stack and local Mailpit already running:
 * node apps/web/test/account-security.e2e.mjs
 * Only sign-up uses an isolated auth handler so its real verification email goes
 * to Mailpit rather than the shared stack's configured SMTP service. Every
 * subsequent browser request uses the shared application and Better Auth API.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const { BASE, launch, check, finish, sleep } = await import("./browser.mjs");
const apiRequire = createRequire(new URL("../../api/package.json", import.meta.url));
const load = (name) => import(pathToFileURL(apiRequire.resolve(name)).href);
const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const email = `sec-${stamp}@codechatter.local`;
const originalPassword = `Sec-${randomBytes(20).toString("base64url")}!`;
const nextPassword = `Sec-${randomBytes(20).toString("base64url")}!`;
const accountPath = "/settings/account";
const mailpit = process.env.SECURITY_E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
let stage = "initialisation";
let browser, context, secondContext, auth, dbHandle, redis, server, transport;
let userId, personalOrgId, secret, backupCodes;
let currentPassword = originalPassword;
let pageErrors = [];
let interrupted = false;
let lastAuthenticatorWindow = -1;
let lastAuthResponse = "none";

// RFC 6238: decode the actual base32 secret shown by the application and use
// SHA-1, a 30-second moving counter, dynamic truncation and six decimal digits.
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

async function authenticatorCode() {
  // A new moving window for each successful verification also avoids testing
  // with an almost-expired code when a slow development render takes a moment.
  await until(() => {
    const now = Date.now();
    return Math.floor(now / 30_000) !== lastAuthenticatorWindow && now % 30_000 < 27_000;
  }, 35_000);
  lastAuthenticatorWindow = Math.floor(Date.now() / 30_000);
  return totp(secret);
}

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}

async function until(operation, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && !interrupted) {
    const value = await operation();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(interrupted ? "Interrupted" : "ConditionTimeout");
}

function observe(page) {
  // Error messages and Playwright call logs can contain entered secrets.
  page.on("pageerror", () => pageErrors.push("PageError"));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (["/api/auth/sign-up/email", "/api/auth/verify-email", "/api/auth/list-accounts", "/api/auth/get-session"].includes(path)) lastAuthResponse = `${path}: ${response.status()}`;
  });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  return page;
}

async function authPost(target, path, data) {
  return target.request.post(`${BASE}/api/auth/${path}`, { headers: { origin: BASE }, data });
}

async function freshSession(target) {
  // The shared app deliberately caches signed session cookies for up to 60s.
  // A fresh check consults the backing session store and clears a revoked
  // device's cached cookie before we test the protected account-page redirect.
  const response = await target.request.get(`${BASE}/api/auth/get-session?disableCookieCache=true`);
  return response.ok() ? response.json() : null;
}

async function account(page) {
  await page.goto(`${BASE}${accountPath}`);
  await page.getByRole("heading", { name: "Account security", exact: true }).waitFor();
  await page.getByLabel("Name", { exact: true }).waitFor();
  await page.getByRole("table", { name: "Active sessions" }).waitFor();
}

async function signOut(target, page) {
  const response = await authPost(target, "sign-out", {});
  verify("fixture session signs out", response.ok());
  await page.goto(`${BASE}/sign-in`);
}

async function signIn(page, password, factor) {
  await page.goto(`${BASE}/sign-in?returnTo=${encodeURIComponent(accountPath)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (factor) {
    await page.waitForURL(/\/two-factor(?:\?|$)/);
    await page.getByRole("checkbox").uncheck(); // Do not let a trusted-device cookie bypass later checks.
    if (factor === "totp") await page.getByLabel("6-digit code").fill(await authenticatorCode());
    else {
      await page.getByRole("button", { name: "Use a backup code", exact: true }).click();
      await page.getByLabel("Backup code", { exact: true }).fill(factor);
      await page.getByRole("button", { name: "Verify", exact: true }).click();
    }
  }
  await page.waitForURL(/\/(?:dashboard|settings\/account)(?:\?|$)/);
  await account(page);
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

async function initialiseFixtureAuth() {
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(BASE).hostname)) throw new Error("LocalDevelopmentOnly");
  if (!process.env.DATABASE_URL || !process.env.VALKEY_URL || !process.env.BETTER_AUTH_SECRET) throw new Error("MissingDevelopmentConfiguration");
  // This opt-in is process-local. The shared API never enables account deletion.
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
    await transport.sendMail({ from: "security-test@codechatter.local", to: email, subject: "CodeChatter disposable verification", text: url });
  };
  auth = createAuth({
    db: dbHandle.db, redis, appUrl: BASE, secret: process.env.BETTER_AUTH_SECRET, production: false,
    origins: createOriginPolicy({ appUrl: BASE, allowPrivateNetwork: false }),
    mail: { sendVerificationEmail: sendOwnMail, sendPasswordResetEmail: sendOwnMail, sendOrgInvitationEmail: async () => { throw new Error("NoFixtureInvitations"); } },
  });
  const isolatedContext = await auth.$context;
  // Better Auth's default error logger can include request details. Silence
  // only this private handler; the test reports safe stage/name failures.
  for (const key of Object.keys(isolatedContext.logger)) {
    if (typeof isolatedContext.logger[key] === "function") isolatedContext.logger[key] = () => {};
  }
  const handler = toNodeHandler(auth);
  server = createServer((request, response) => {
    // This private handler cannot be used as a second application auth server.
    if (request.method !== "POST" || request.url?.split("?")[0] !== "/api/auth/sign-up/email") { response.writeHead(404).end(); return; }
    void handler(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}/api/auth/sign-up/email`;
}

async function cleanupFixture() {
  if (!auth || !dbHandle) return;
  const adapter = (await auth.$context).internalAdapter;
  const record = await adapter.findUserByEmail(email);
  const ownUser = record?.user;
  if (!ownUser) return;
  if (ownUser.email !== email || (userId && ownUser.id !== userId)) throw new Error("FixtureOwnershipMismatch");
  userId = ownUser.id;
  const { schema } = await load("@codechatter/db");
  const { eq, and } = await load("drizzle-orm");
  // Capture this exact user's tokens before native deletion cascades session
  // rows, so they can be purged independently from secondary storage as well.
  const ownSessions = await dbHandle.db.query.session.findMany({ where: eq(schema.session.userId, userId) });
  const ownSessionTokens = ownSessions.map((session) => session.token);
  const org = await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.slug, `u-${userId}`) });
  if (org) {
    let metadata;
    try { metadata = JSON.parse(org.metadata ?? "null"); } catch { metadata = null; }
    const members = await dbHandle.db.query.member.findMany({ where: eq(schema.member.organizationId, org.id) });
    if (metadata?.personal !== true || (personalOrgId && personalOrgId !== org.id) || members.some((member) => member.userId !== userId)) throw new Error("FixtureWorkspaceOwnershipMismatch");
    personalOrgId = org.id;
  }
  let nativeDeleted = false;
  if (context) {
    try {
      const cookies = await context.cookies(BASE);
      const headers = new Headers({ cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), origin: BASE });
      const result = await auth.api.deleteUser({ headers, body: { password: currentPassword } });
      nativeDeleted = result.success === true;
    } catch { /* A failed/interrupted sign-in still gets the exact-fixture fallback below. */ }
  }
  if (!nativeDeleted || await adapter.findUserByEmail(email)) {
    await adapter.deleteUserSessions(userId);
    await adapter.deleteUser(userId);
  }
  await adapter.deleteSessions(ownSessionTokens);
  await adapter.deleteUserSessions(userId);
  // Account deletion cascades the fixture's membership, but organisations have
  // their own lifetime. Delete only its canonical, independently checked org.
  if (personalOrgId) {
    await dbHandle.db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.organization).where(and(eq(schema.organization.id, personalOrgId), eq(schema.organization.slug, `u-${userId}`))).for("update");
      if (!current) return;
      const members = await tx.select().from(schema.member).where(eq(schema.member.organizationId, current.id));
      if (members.length || JSON.parse(current.metadata ?? "null")?.personal !== true) throw new Error("FixtureWorkspaceNotEmpty");
      await tx.delete(schema.organization).where(eq(schema.organization.id, current.id));
    });
  }
  verify("disposable user and personal workspace are deleted", !(await adapter.findUserByEmail(email)) && (!personalOrgId || !(await dbHandle.db.query.organization.findFirst({ where: eq(schema.organization.id, personalOrgId) }))));
}

async function run() {
  verify("RFC 6238 matches the published SHA-1 test vector", totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000) === "287082");
  stage = "shared API and Mailpit health preflight";
  const [meta, session, mailbox] = await Promise.all([
    fetch(`${BASE}/api/meta`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`${BASE}/api/auth/get-session`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`${mailpit}/api/v1/messages`, { signal: AbortSignal.timeout(15_000) }),
  ]);
  verify("shared API and local Mailpit are ready before fixture creation", meta.ok && session.ok && mailbox.ok);
  stage = "local verification handler";
  const signupEndpoint = await initialiseFixtureAuth();
  ({ browser, errors: pageErrors } = await launch());
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = observe(await context.newPage());
  stage = "real sign-up and email verification";
  await page.route("**/api/auth/sign-up/email", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (body.email !== email) throw new Error("FixtureSignupOnly");
    await route.fulfill({ response: await route.fetch({ url: signupEndpoint }) });
  });
  await page.goto(`${BASE}/sign-up?returnTo=${encodeURIComponent(accountPath)}`);
  await page.getByLabel("Name", { exact: true }).fill("Security browser fixture");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  stage = "submitting disposable sign-up";
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL(/\/verify-email\?/);
  await page.unroute("**/api/auth/sign-up/email");
  stage = "waiting for disposable verification email";
  const link = await verificationLink();
  stage = "opening real email verification link";
  await page.goto(link);
  stage = "loading verified disposable account settings";
  await account(page);
  const meResponse = await context.request.get(`${BASE}/api/me`);
  const me = await meResponse.json();
  userId = me.user?.id;
  personalOrgId = me.personalOrgId;
  verify("new account is genuinely email verified", meResponse.ok() && me.user?.email === email && Boolean((await freshSession(context))?.user?.emailVerified) && Boolean(userId) && Boolean(personalOrgId));
  verify("email is read-only and the credential provider is shown", await page.getByLabel("Email", { exact: true }).getAttribute("readonly") !== null && await page.getByText("You sign in with password.", { exact: true }).isVisible());

  stage = "profile and password";
  await page.getByLabel("Name", { exact: true }).fill("Security browser updated");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await until(async () => (await freshSession(context))?.user?.name === "Security browser updated");
  await page.reload();
  verify("updated profile survives a reload", await page.getByLabel("Name", { exact: true }).inputValue() === "Security browser updated");
  await page.getByLabel("Current password", { exact: true }).fill(originalPassword);
  await page.getByLabel("New password", { exact: true }).fill(nextPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill(`${nextPassword}different`);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  verify("password confirmation is checked", await page.getByRole("alert").filter({ hasText: "The two new passwords don't match." }).isVisible());
  await page.getByLabel("Current password", { exact: true }).fill(`${originalPassword}wrong`);
  await page.getByLabel("Confirm new password", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Your current password is incorrect." }).waitFor();
  verify("wrong current password is rejected by the API", true);
  await page.getByLabel("Current password", { exact: true }).fill(originalPassword);
  verify("password change defaults to signing out other devices", await page.getByRole("checkbox", { name: "Sign out my other devices", exact: true }).isChecked());
  const changed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/change-password" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  verify("password change succeeds", (await changed).ok());
  currentPassword = nextPassword;
  await signOut(context, page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  const oldLogin = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/sign-in/email" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  verify("the old password no longer signs in", !(await oldLogin).ok());
  await signIn(page, nextPassword);

  stage = "authenticator setup and saved backup codes";
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await page.locator("#two-factor-password").fill(nextPassword);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const shownSecret = page.getByTestId("totp-secret");
  await shownSecret.waitFor();
  secret = (await shownSecret.textContent()).replace(/\s/g, "");
  const uri = new URL(await page.getByRole("link", { name: "Open in authenticator", exact: true }).getAttribute("href"));
  verify("manual setup contains the real authenticator secret", uri.protocol === "otpauth:" && uri.searchParams.get("secret") === secret);
  await page.getByLabel("Authenticator code", { exact: true }).fill(await authenticatorCode());
  await page.getByRole("button", { name: "Confirm code", exact: true }).click();
  await page.getByLabel("Backup codes", { exact: true }).waitFor();
  backupCodes = (await page.getByLabel("Backup codes", { exact: true }).inputValue()).trim().split(/\s+/);
  verify("authenticator enabled and backup codes are shown once", backupCodes.length >= 8 && Boolean((await freshSession(context))?.user?.twoFactorEnabled));
  stage = "backup-code preservation during a transient settings refetch";
  const failRefetch = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporarily unavailable" }) });
  await page.route("**/api/auth/list-accounts", failRefetch);
  await page.route("**/api/auth/get-session*", failRefetch);
  const backgroundFailure = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/list-accounts" && response.status() === 503);
  await page.evaluate(() => { window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("visibilitychange")); });
  await backgroundFailure;
  await page.getByRole("alert").filter({ hasText: "Showing your last loaded settings." }).waitFor();
  verify("transient auth refetch preserves one-time backup codes", await page.getByLabel("Backup codes", { exact: true }).inputValue() === backupCodes.join("\n"));
  await page.unroute("**/api/auth/list-accounts", failRefetch);
  await page.unroute("**/api/auth/get-session*", failRefetch);
  await page.getByRole("alert").filter({ hasText: "Showing your last loaded settings." }).getByRole("button", { name: "Try again", exact: true }).click();
  await until(async () => await page.getByRole("alert").filter({ hasText: "Showing your last loaded settings." }).count() === 0);
  verify("settings recover without losing the backup-code view", await page.getByLabel("Backup codes", { exact: true }).inputValue() === backupCodes.join("\n"));
  stage = "copying and downloading backup codes";
  await page.getByRole("button", { name: "Copy backup codes", exact: true }).click();
  // Clipboard writes complete after the click handler returns, and Windows
  // can expose native CRLF line endings when reading the clipboard back.
  await until(async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n") === backupCodes.join("\n"));
  verify("copy contains exactly the displayed backup codes", true);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup codes", exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const downloaded = Buffer.concat(chunks).toString("utf8");
  verify("download is a plain-text copy of the backup codes", download.suggestedFilename() === "codechatter-backup-codes.txt" && backupCodes.every((code) => downloaded.includes(code)));
  await download.delete();
  await page.getByRole("button", { name: "I've saved these codes", exact: true }).click();
  await page.reload();
  verify("saved backup codes do not reappear on reload", await page.locator("#backup-codes").count() === 0);

  stage = "real authenticator and single-use backup sign-in";
  await signOut(context, page);
  await signIn(page, nextPassword, "totp");
  verify("real RFC 6238 code completes two-factor sign-in", Boolean((await freshSession(context))?.user?.twoFactorEnabled));
  await signOut(context, page);
  await signIn(page, nextPassword, backupCodes[0]);
  verify("a saved backup code completes sign-in", (await freshSession(context))?.user?.id === userId);
  await signOut(context, page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(nextPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/two-factor(?:\?|$)/);
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Use a backup code", exact: true }).click();
  await page.getByLabel("Backup code", { exact: true }).fill(backupCodes[0]);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Each code can only be used once." }).waitFor();
  verify("the same backup code cannot be used twice", new URL(page.url()).pathname === "/two-factor");
  await page.getByRole("button", { name: "Use an authenticator code", exact: true }).click();
  await page.getByLabel("6-digit code").fill(await authenticatorCode());
  await page.waitForURL(/\/dashboard(?:\?|$)/);
  await account(page);

  stage = "other-device session revocation";
  secondContext = await browser.newContext({ viewport: { width: 1300, height: 900 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" });
  const secondPage = observe(await secondContext.newPage());
  await signIn(secondPage, nextPassword, "totp");
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  const table = page.getByRole("table", { name: "Active sessions" });
  const otherRow = table.getByRole("row").filter({ hasText: "Firefox on Linux" });
  await otherRow.waitFor();
  verify("sessions identify this device and the second browser", await table.getByText("This device", { exact: true }).count() === 1 && await otherRow.getByRole("button", { name: "Sign out", exact: true }).isVisible());
  await otherRow.getByRole("button", { name: "Sign out", exact: true }).click();
  await until(async () => !(await freshSession(secondContext)));
  await secondPage.goto(`${BASE}${accountPath}`);
  await secondPage.waitForURL(/\/sign-in(?:\?|$)/);
  verify("revoked device loses its fresh session and account-page access", (await freshSession(context))?.user?.id === userId);
  await signIn(secondPage, nextPassword, "totp");
  await page.getByRole("button", { name: "Refresh sessions", exact: true }).click();
  await otherRow.waitFor();
  await page.getByRole("button", { name: "Sign out all other devices", exact: true }).click();
  await until(async () => !(await freshSession(secondContext)));
  verify("sign out all other devices preserves only the current session", (await freshSession(context))?.user?.id === userId);

  stage = "backup-code regeneration and disabling two-factor";
  await page.getByRole("button", { name: "New backup codes", exact: true }).click();
  await page.locator("#two-factor-password").fill(nextPassword);
  await page.getByRole("button", { name: "Create new backup codes", exact: true }).click();
  await page.getByLabel("Backup codes", { exact: true }).waitFor();
  const replacementCodes = (await page.getByLabel("Backup codes", { exact: true }).inputValue()).trim().split(/\s+/);
  verify("regenerating creates a different set of backup codes", replacementCodes.length === backupCodes.length && replacementCodes.every((code) => !backupCodes.includes(code)));
  await page.getByRole("button", { name: "I've saved these codes", exact: true }).click();
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await page.locator("#two-factor-password").fill(nextPassword);
  await page.getByRole("button", { name: "Confirm turn off", exact: true }).click();
  await until(async () => (await freshSession(context))?.user?.twoFactorEnabled === false);
  verify("two-factor can be disabled with the current password", true);
  verify("no browser page errors occurred", pageErrors.length === 0);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; void browser?.close(); });
try { await run(); }
catch (error) {
  const errorName = /^[A-Za-z]+$/.test(error?.name ?? "") ? error.name : "Error";
  const networkCode = String(error?.message ?? "").match(/net::ERR_[A-Z_]+/)?.[0];
  check("account security flow completes", false, `${stage}: ${errorName}${networkCode ? ` (${networkCode})` : ""}; ${lastAuthResponse}`);
}
finally {
  stage = "fixture cleanup";
  try { await cleanupFixture(); }
  catch { check("disposable fixture cleanup completes", false, "Exact fixture cleanup failed; no unrelated data was changed."); }
  secret = undefined;
  backupCodes = undefined;
  await browser?.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  transport?.close();
  if (redis) await redis.quit().catch(() => redis.disconnect());
  await dbHandle?.close().catch(() => {});
}
finish();
