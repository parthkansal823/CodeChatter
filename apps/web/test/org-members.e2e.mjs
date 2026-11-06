/** Exercise team creation, invitations, roles and leaving in real browser profiles, then delete the disposable organisation even after a failure. */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, PASSWORD, check, finish, launch, sleep } from "./browser.mjs";

const stamp = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
const teamName = `E2E team ${stamp}`;
const teamSlug = `e2e-team-${stamp}`;
const firstEmail = "test1@codechatter.local";
const secondEmail = "test2@codechatter.local";
const contexts = [];
const accounts = [];
const organisations = new Set();
let browser;
let errors = [];
let owner;

function requireCheck(name, passed, detail = "") {
  check(name, passed, detail);
  if (!passed) throw new Error(name);
}

function shortError(error) { return error instanceof Error ? error.message.split("\n")[0] : "Unexpected browser failure"; }

async function api(context, path, body) {
  const response = await context.request.fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin: BASE },
    ...(body !== undefined && { data: body }),
    timeout: 30_000,
  });
  return { status: response.status(), data: await response.json().catch(() => null) };
}

async function me(account) {
  const result = await api(account.context, "/api/me");
  if (result.status !== 200 || !result.data?.personalOrgId) throw new Error(`Reading the test account failed (${result.status}).`);
  return result.data;
}

async function pageFor(context, label) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message.split("\n")[0]}`));
  return page;
}

async function signInToDashboard(email) {
  // The shared signIn helper opens the room IDE. This suite signs in to the dashboard
  // so team verification neither starts a sandbox nor depends on editor compilation.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  const page = await pageFor(context, email);
  await page.goto(`${BASE}/sign-in?returnTo=%2Fdashboard`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  const account = { context, page, email };
  const initial = await me(account);
  account.personalOrgId = initial.personalOrgId;
  account.originalOrgId = initial.session.activeOrganizationId;
  accounts.push(account);
  return account;
}

async function membersPage(account) {
  await account.page.goto(`${BASE}/settings/members`);
  await account.page.getByRole("heading", { level: 1, name: "Members", exact: true }).waitFor();
}

function memberRow(page, email) {
  return page.getByRole("table", { name: `Members of ${teamName}` }).getByRole("row").filter({ hasText: email });
}

async function refreshMembers(account) {
  await account.page.getByRole("button", { name: "Refresh", exact: true }).click();
}

async function copyInvitation(page, email) {
  await page.getByRole("button", { name: `Copy link for ${email}`, exact: true }).click();
  let link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  if (!link.includes("/invite/")) link = await page.getByLabel("Invitation link", { exact: true }).inputValue();
  const url = new URL(link);
  requireCheck("copied invitation uses the app origin and invitation route", url.origin === new URL(BASE).origin && /^\/invite\/[^/]+$/.test(url.pathname));
  return url.href;
}

async function inviteSecond(page) {
  await page.getByLabel("Emails", { exact: true }).fill(secondEmail);
  await page.getByRole("button", { name: "Invite people", exact: true }).click();
  await page.getByRole("list", { name: "Invitation results" }).getByText("Invitation sent.", { exact: false }).waitFor();
  await page.getByRole("button", { name: `Copy link for ${secondEmail}`, exact: true }).waitFor();
  return copyInvitation(page, secondEmail);
}

async function captureMembers(page) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, colorScheme === "dark");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      check(`members fit ${width}px in ${colorScheme} theme`, !overflow);
      await page.screenshot({ path: join(tmpdir(), `org-members-${stamp}-${width}-${colorScheme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
}

try {
  ({ browser, errors } = await launch());
  owner = await signInToDashboard(firstEmail);
  const invited = await signInToDashboard(secondEmail);
  const a = owner.page;
  const b = invited.page;
  await owner.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const personal = await api(owner.context, "/api/auth/organization/set-active", { organizationId: owner.personalOrgId });
  requireCheck("owner can activate their personal workspace", personal.status === 200);
  await membersPage(owner);
  check("personal workspace explains that it is just you", await a.getByText("This is your personal workspace, just for you.", { exact: false }).isVisible());
  check("personal workspace has no invitation controls", await a.getByLabel("Emails", { exact: true }).count() === 0);
  const personalInvite = await api(owner.context, "/api/auth/organization/invite-member", { organizationId: owner.personalOrgId, email: secondEmail, role: "member" });
  if (personalInvite.status >= 200 && personalInvite.status < 300 && personalInvite.data?.id) {
    const cancelled = await api(owner.context, "/api/auth/organization/cancel-invitation", { invitationId: personalInvite.data.id });
    check("unexpected personal invitation is cancelled immediately", cancelled.status === 200);
  }
  requireCheck("shared API refuses invitations into personal workspaces", [400, 403].includes(personalInvite.status), `HTTP ${personalInvite.status}`);

  await a.getByRole("link", { name: "Create an organisation", exact: true }).click();
  await a.getByRole("heading", { name: "New organisation", exact: true }).waitFor();
  check("empty organisation name cannot be submitted", await a.getByRole("button", { name: "Create organisation", exact: true }).isDisabled());
  await a.getByLabel("Organisation name", { exact: true }).fill(teamName);
  requireCheck("organisation name supplies an editable slug", await a.getByLabel("Slug", { exact: true }).inputValue() === teamSlug);
  await a.getByText("This slug is available.", { exact: true }).waitFor();
  const creation = a.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/organization/create" && response.request().method() === "POST");
  await a.getByRole("button", { name: "Create organisation", exact: true }).click();
  const createdResponse = await creation;
  const created = await createdResponse.json().catch(() => null);
  if (created?.id) organisations.add(created.id);
  requireCheck("test1 creates the organisation", createdResponse.ok() && typeof created?.id === "string");
  const orgId = created.id;
  await a.waitForURL((url) => url.pathname === "/dashboard");
  const afterCreate = await me(owner);
  check("creation makes the organisation active", afterCreate.session.activeOrganizationId === orgId);
  check("fresh sidebar displays the created organisation", await a.getByText(teamName, { exact: true }).first().isVisible());

  await a.goto(`${BASE}/orgs/new`);
  await a.getByLabel("Organisation name", { exact: true }).fill(teamName);
  await a.getByText("That slug is already in use.", { exact: true }).waitFor();
  check("taken slugs receive a plain message and cannot be submitted", await a.getByRole("button", { name: "Create organisation", exact: true }).isDisabled());
  await a.goto(`${BASE}/settings`);
  await a.getByRole("link", { name: "Open members", exact: true }).click();
  await a.getByRole("heading", { level: 1, name: "Members", exact: true }).waitFor();
  await memberRow(a, firstEmail).waitFor();
  check("last owner cannot demote themselves", await a.getByRole("combobox", { name: `Role for ${firstEmail}`, exact: true }).isDisabled());
  check("last owner cannot leave", await a.getByRole("button", { name: "Leave organisation", exact: true }).count() === 0 && await a.getByText("Last owner", { exact: true }).isVisible());

  await a.getByLabel("Emails", { exact: true }).fill(Array.from({ length: 21 }, (_, index) => `invalid-${index}`).join(","));
  await a.getByRole("button", { name: "Invite people", exact: true }).click();
  check("batch invitation is limited to twenty addresses", await a.getByText("Invite at most 20 people at once.", { exact: true }).isVisible());
  await a.getByLabel("Emails", { exact: true }).fill(`not-an-email, ${firstEmail}\n${secondEmail}`);
  await a.getByRole("button", { name: "Invite people", exact: true }).click();
  const results = a.getByRole("list", { name: "Invitation results" });
  await results.getByText("Invitation sent.", { exact: false }).waitFor();
  check("batch results identify invalid emails", await results.getByText("Not a valid email address.", { exact: false }).isVisible());
  check("batch results identify existing members", await results.getByText("Already a member.", { exact: false }).isVisible());
  const link = await copyInvitation(a, secondEmail);
  const invitePath = new URL(link).pathname;
  await a.getByLabel("Emails", { exact: true }).fill(secondEmail);
  await a.getByRole("button", { name: "Invite people", exact: true }).click();
  await results.getByText("Already invited.", { exact: false }).waitFor();
  check("already invited addresses are reported without another invitation", true);
  await captureMembers(a);

  await a.goto(link);
  await a.getByText("This invitation is for a different email address.", { exact: false }).waitFor();
  check("wrong email is explained without offering Join", await a.getByRole("button", { name: "Join", exact: true }).count() === 0);
  check("wrong email offers sign-out and another email", await a.getByRole("button", { name: "Sign out and use another email", exact: true }).isVisible());
  await membersPage(owner);

  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  contexts.push(guest);
  const guestPage = await pageFor(guest, "signed-out invitation");
  await guestPage.goto(link);
  await guestPage.waitForURL((url) => url.pathname === "/sign-in");
  check("signed-out invitations keep their return destination", new URL(guestPage.url()).searchParams.get("returnTo") === invitePath);
  await guestPage.getByRole("link", { name: "Create an account", exact: true }).click();
  await guestPage.waitForURL((url) => url.pathname === "/sign-up");
  check("sign-up retains the invitation destination", new URL(guestPage.url()).searchParams.get("returnTo") === invitePath);
  check("sign-up back-link retains the invitation destination", (await guestPage.getByRole("link", { name: "Sign in", exact: true }).getAttribute("href"))?.includes(encodeURIComponent(invitePath)));

  // Mock only account creation/email sending: verify callback routing without leaving a new user behind.
  let signUpCallback;
  let resendCallback;
  const fakeEmail = `invite-${stamp}@example.test`;
  await guestPage.route("**/api/auth/sign-up/email", async (route) => {
    signUpCallback = route.request().postDataJSON().callbackURL;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: null, user: { id: "invite-sign-up-fixture", name: "Invitation fixture", email: fakeEmail, emailVerified: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) });
  });
  await guestPage.route("**/api/auth/send-verification-email", async (route) => {
    resendCallback = route.request().postDataJSON().callbackURL;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: true }) });
  });
  await guestPage.getByLabel("Name", { exact: true }).fill("Invitation fixture");
  await guestPage.getByLabel("Email", { exact: true }).fill(fakeEmail);
  await guestPage.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await guestPage.getByRole("button", { name: "Create account", exact: true }).click();
  await guestPage.getByRole("heading", { name: "Check your inbox", exact: true }).waitFor();
  check("account creation verification returns to the invitation", signUpCallback === invitePath);
  const resent = guestPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/send-verification-email");
  await guestPage.getByRole("button", { name: "Send the link again", exact: true }).click();
  await resent;
  check("resending verification retains the invitation destination", resendCallback === invitePath);
  await guest.close();

  await b.goto(link);
  await b.getByRole("button", { name: "Join", exact: true }).waitFor();
  check("invitation shows organisation and inviter", await b.getByText(teamName, { exact: true }).isVisible() && await b.getByText(firstEmail, { exact: true }).isVisible());
  check("invitation shows the offered member role", await b.getByText("Role: member", { exact: false }).isVisible());
  await b.screenshot({ path: join(tmpdir(), `org-invitation-${stamp}-desktop.png`) });
  const failActivation = async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary activation fixture failure", code: "SERVICE_UNAVAILABLE" }) });
  await b.route("**/api/auth/organization/set-active", failActivation);
  await b.getByRole("button", { name: "Join", exact: true }).click();
  await b.getByRole("button", { name: "Open organisation", exact: true }).waitFor();
  check("joining survives a subsequent activation failure", await b.getByRole("button", { name: "Open organisation", exact: true }).isVisible());
  await b.unroute("**/api/auth/organization/set-active", failActivation);
  await b.getByRole("button", { name: "Open organisation", exact: true }).click();
  await b.waitForURL((url) => url.pathname === "/dashboard");
  const joined = await me(invited);
  check("test2 joined as member and made the organisation active", joined.session.activeOrganizationId === orgId && joined.organizations.some((org) => org.id === orgId && org.role === "member"));

  await membersPage(invited);
  await memberRow(b, secondEmail).waitFor();
  check("member sees their own row and joined date", (await memberRow(b, secondEmail).innerText()).includes("(you)") && await memberRow(b, secondEmail).locator("time").count() === 1);
  check("members see a read-only list", await b.getByRole("combobox").count() === 0 && await b.getByLabel("Emails", { exact: true }).count() === 0);
  await refreshMembers(owner);
  await memberRow(a, secondEmail).waitFor();
  check("owner sees the joined member", true);
  await a.getByRole("combobox", { name: `Role for ${secondEmail}`, exact: true }).click();
  await a.getByRole("option", { name: "Admin", exact: true }).click();
  await a.getByRole("combobox", { name: `Role for ${secondEmail}`, exact: true }).getByText("Admin", { exact: true }).waitFor();
  check("owner changes test2 to admin", true);
  await b.reload();
  await b.getByRole("combobox", { name: `Role for ${secondEmail}`, exact: true }).getByText("Admin", { exact: true }).waitFor();
  check("test2 sees the new admin role after reload", await b.getByLabel("Emails", { exact: true }).isVisible());
  await b.getByRole("combobox", { name: "Invitation role", exact: true }).click();
  check("admins cannot offer the owner role", await b.getByRole("option", { name: "Owner", exact: true }).count() === 0);
  await b.keyboard.press("Escape");
  await b.getByRole("button", { name: "Leave organisation", exact: true }).click();
  const leaveDialog = b.getByRole("dialog", { name: "Leave organisation", exact: true });
  await leaveDialog.waitFor();
  check("leaving requires confirmation", true);
  await leaveDialog.getByRole("button", { name: "Leave organisation", exact: true }).click();
  await b.waitForURL((url) => url.pathname === "/dashboard");
  const afterLeave = await me(invited);
  check("test2 leaves and returns to their personal workspace", !afterLeave.organizations.some((org) => org.id === orgId) && afterLeave.session.activeOrganizationId === invited.personalOrgId);
  await refreshMembers(owner);
  await memberRow(a, secondEmail).waitFor({ state: "detached" });
  check("owner's refreshed member list no longer includes test2", true);

  await b.goto(link);
  await b.getByText("This invitation has expired, was cancelled, or has already been used.", { exact: true }).waitFor();
  check("used invitation has a plain message and dashboard link", await b.getByRole("link", { name: "Go to dashboard", exact: true }).isVisible());
  const cancelledLink = await inviteSecond(a);
  await a.getByRole("button", { name: `Cancel invitation for ${secondEmail}`, exact: true }).click();
  await a.getByRole("button", { name: `Cancel invitation for ${secondEmail}`, exact: true }).waitFor({ state: "detached" });
  await b.goto(cancelledLink);
  await b.getByText("This invitation has expired, was cancelled, or has already been used.", { exact: true }).waitFor();
  check("cancelled invitations cannot be joined", await b.getByRole("button", { name: "Join", exact: true }).count() === 0);
  const declinedLink = await inviteSecond(a);
  await b.goto(declinedLink);
  await b.getByRole("button", { name: "Decline", exact: true }).click();
  await b.getByRole("heading", { name: "Invitation declined", exact: true }).waitFor();
  check("declining does not add membership", !(await me(invited)).organizations.some((org) => org.id === orgId));
} catch (error) {
  const shot = join(tmpdir(), `org-members-${stamp}-failed.png`);
  await owner?.page.screenshot({ path: shot }).catch(() => {});
  check("team browser flow completes", false, `${shortError(error)} (screenshot: ${shot})`);
} finally {
  if (owner) {
    // If create committed before a navigation or response failed, recover only this run's exact team.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await me(owner).catch(() => null);
      for (const org of current?.organizations ?? []) if (org.name === teamName && org.slug === teamSlug) organisations.add(org.id);
      if (organisations.size || attempt === 2) break;
      await sleep(250);
    }
    for (const organisationId of organisations) {
      let removed;
      for (let attempt = 0; attempt < 3; attempt++) {
        removed = await api(owner.context, "/api/auth/organization/delete", { organizationId: organisationId }).catch(() => null);
        if ([200, 404].includes(removed?.status)) break;
        const remaining = await me(owner).catch(() => null);
        if (remaining && !remaining.organizations.some((org) => org.id === organisationId)) { removed = { status: 404 }; break; }
        await sleep(300);
      }
      check("disposable organisation is deleted", [200, 404].includes(removed?.status), `HTTP ${removed?.status ?? "request failed"}`);
    }
  }
  for (const account of accounts) {
    const current = await me(account).catch(() => null);
    const originalExists = current?.organizations.some((org) => org.id === account.originalOrgId);
    const restored = await api(account.context, "/api/auth/organization/set-active", { organizationId: originalExists ? account.originalOrgId : account.personalOrgId }).catch(() => null);
    check(`original workspace restored for ${account.email}`, restored?.status === 200, `HTTP ${restored?.status ?? "request failed"}`);
  }
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
finish();
