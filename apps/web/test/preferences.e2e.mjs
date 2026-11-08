/** Verify personal preferences against the shared dev stack, restoring seeded-user settings even after a failed check. OAuth requests and returns are mocked; no real provider account is connected. */
import { BASE, PASSWORD, check, finish, launch, sleep } from "./browser.mjs";

const destination = "/settings/preferences";
let browser, context, page, errors;
let originalDigest, originalEditor, originalStorage;
const editorSaves = [];
let digestMayHaveChanged = false;
let stage = "launch browser";

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}

async function until(operation, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await operation()) return;
    await sleep(100);
  }
  throw new Error("ConditionTimeout");
}

async function api(path) {
  const response = await context.request.get(`${BASE}${path}`);
  if (!response.ok()) throw new Error("ApiReadFailed");
  return response.json();
}

async function preferences(query = "") {
  await page.goto(`${BASE}${destination}${query}`);
  await page.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  await page.getByRole("radio", { name: "Light", exact: true }).waitFor();
  await page.getByRole("switch", { name: "Email me a daily digest", exact: true }).waitFor();
  await page.getByRole("region", { name: "Password sign-in", exact: true }).waitFor();
  await until(async () => await page.getByRole("switch", { name: "Email me a daily digest", exact: true }).isEnabled());
}

function containsSensitiveFields(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => /(?:access.?token|refresh.?token|id.?token|password|secret)/i.test(key) || containsSensitiveFields(item));
}

try {
  ({ browser, errors } = await launch());
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  page = await context.newPage();
  page.on("pageerror", () => errors.push("PageError"));
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  stage = "sign in and capture settings";
  const login = await context.request.post(`${BASE}/api/auth/sign-in/email`, { headers: { origin: new URL(BASE).origin }, data: { email: "test1@codechatter.local", password: PASSWORD } });
  verify("seeded account signs in", login.ok());
  originalDigest = await api("/api/me/notification-settings");
  originalEditor = await api("/api/me/settings");
  const meta = await api("/api/meta");
  const accounts = await api("/api/auth/list-accounts");
  verify("listAccounts exposes no password or provider token fields", Array.isArray(accounts) && !containsSensitiveFields(accounts));

  // The existing editor sync initialises defaults when a user has no saved
  // editor settings. Capture the editor's save payload without changing the
  // shared account, including any unrelated default initialisation.
  await page.route("**/api/me/settings", (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    editorSaves.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updatedAt: new Date().toISOString() }) });
  });
  await page.goto(`${BASE}/settings`);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  originalStorage = await page.evaluate(() => Object.fromEntries(["theme", "cc-editor-settings", "cc-editor-themes", "cc-editor-settings-unsaved"].map((key) => [key, localStorage.getItem(key)])));
  await page.getByRole("link", { name: "Open preferences", exact: true }).click();
  await preferences();
  verify("Settings links to the preferences page", new URL(page.url()).pathname === destination);

  stage = "app theme selection and reload";
  for (const [label, value] of [["Dark", "dark"], ["Light", "light"], ["Match my device", "system"]]) {
    const radio = page.getByRole("radio", { name: label, exact: true });
    await radio.click();
    const dark = value !== "light"; // This browser profile follows a dark device.
    await until(() => page.evaluate((expected) => document.documentElement.classList.contains("dark") === expected, dark));
    verify(`${label} applies immediately and is marked current`, await radio.isChecked());
    await page.reload();
    await preferences();
    verify(`${label} survives a reload`, await page.getByRole("radio", { name: label, exact: true }).isChecked() && await page.evaluate((expected) => document.documentElement.classList.contains("dark") === expected, dark));
  }

  stage = "editor control and existing save path";
  const font = page.getByLabel("Font size", { exact: true });
  const originalFont = await font.inputValue();
  const targetFont = originalFont === "24" ? "25" : "24";
  verify("font control exposes the existing supported size range", Number(await font.getAttribute("min")) === 10 && Number(await font.getAttribute("max")) === 32);
  await font.fill("");
  await font.pressSequentially(targetFont, { delay: 80 });
  await font.press("Tab");
  verify("typing a multi-digit editor font size keeps the entered number", await font.inputValue() === targetFont);
  await until(() => editorSaves.at(-1)?.editor?.fontSize === Number(targetFont));
  verify("editor changes use the existing save endpoint and preserve imported themes", JSON.stringify(editorSaves.at(-1).themes) === JSON.stringify(originalEditor.settings?.themes ?? []));
  await font.fill(originalFont);
  await font.press("Tab");
  await until(() => editorSaves.at(-1)?.editor?.fontSize === Number(originalFont));
  verify("editor font is restored in the browser before later tests", await font.inputValue() === originalFont);

  stage = "digest persistence and failed-save rollback";
  const digest = page.getByRole("switch", { name: "Email me a daily digest", exact: true });
  verify("digest loads the account preference", await digest.isChecked() === originalDigest.emailDigest);
  digestMayHaveChanged = true; // A lost HTTP response can still follow a committed write.
  await digest.click();
  await page.getByText("Digest preference saved.", { exact: true }).waitFor();
  verify("digest toggle saves through the real API", (await api("/api/me/notification-settings")).emailDigest === !originalDigest.emailDigest);
  await preferences();
  verify("digest choice survives a reload", await digest.isChecked() === !originalDigest.emailDigest);
  const savedDigest = await digest.isChecked();
  await page.route("**/api/me/notification-settings", (route) => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ detail: "Simulated unavailable service" }) })
    : route.continue());
  await digest.click();
  await page.getByRole("alert").filter({ hasText: "Couldn't save your digest preference. Your previous setting is back. Try again." }).waitFor();
  verify("failed digest save restores the switch and explains it", await digest.isChecked() === savedDigest);
  verify("failed digest save leaves the server preference unchanged", (await api("/api/me/notification-settings")).emailDigest === savedDigest);
  await page.unroute("**/api/me/notification-settings");

  stage = "digest save versus a stale reconnect refresh";
  let heldPut, heldGet;
  await page.route("**/api/me/notification-settings", (route) => {
    if (route.request().method() === "PUT") heldPut = route;
    else heldGet = route;
  });
  await digest.click();
  await until(() => Boolean(heldPut));
  // providers.tsx disables focus refreshes and gives reads a 30-second fresh
  // period. Hold this response past that period, then exercise the enabled
  // reconnect refresh so a real stale read races the acknowledged write.
  await sleep(31_000);
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await until(() => Boolean(heldGet));
  await heldPut.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ emailDigest: !savedDigest }) });
  await page.getByText("Digest preference saved.", { exact: true }).waitFor();
  // Cancelling the stale refresh can make its route already closed; either
  // way an old server read must not replace the acknowledged saved choice.
  await heldGet.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ emailDigest: savedDigest }) }).catch(() => {});
  await sleep(300);
  verify("a stale reconnect refresh cannot overwrite an acknowledged digest save", await digest.isChecked() === !savedDigest && await page.getByText("Digest preference saved.", { exact: true }).count() === 1);
  await page.unroute("**/api/me/notification-settings");
  await preferences();
  verify("mocked digest race leaves the real server preference unchanged", (await api("/api/me/notification-settings")).emailDigest === savedDigest && await digest.isChecked() === savedDigest);

  stage = "configured providers and password protection";
  const connections = page.getByRole("region", { name: "Connected accounts", exact: true });
  // The section is labelled by its heading; use it to scope all provider rows.
  const accountSection = await connections.count() ? connections : page.locator("section").filter({ has: page.getByRole("heading", { name: "Connected accounts", exact: true }) });
  for (const [provider, label] of [["google", "Google"], ["github", "GitHub"]]) {
    verify(`only configured ${label} is offered`, await accountSection.getByRole("region", { name: `${label} sign-in`, exact: true }).count() === (meta.auth[provider] ? 1 : 0));
  }
  const password = page.getByRole("region", { name: "Password sign-in", exact: true });
  verify("Password has no Disconnect action", await password.getByRole("button", { name: /disconnect/i }).count() === 0);
  if (accounts.length === 1 && accounts[0].providerId === "credential") {
    const unlink = await context.request.post(`${BASE}/api/auth/unlink-account`, { headers: { origin: new URL(BASE).origin }, data: { accountId: accounts[0].id } });
    const after = await api("/api/auth/list-accounts");
    verify("a direct unlink request cannot remove the sole password", !unlink.ok() && after.length === 1 && after[0].id === accounts[0].id);
  } else {
    verify("sole-password refusal test uses the required seeded fixture", false);
  }

  stage = "mocked provider availability and connection error";
  const noSocial = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ auth: { emailPassword: true, google: false, github: false } }) });
  await page.route("**/api/meta", noSocial);
  await preferences();
  verify("no configured social providers leaves Password and a plain explanation", await page.getByRole("region", { name: /^(?:Google|GitHub) sign-in$/ }).count() === 0 && await page.getByText("No social sign-in providers are set up on this server.", { exact: true }).count() === 1);
  await page.unroute("**/api/meta", noSocial);

  const googleAvailable = async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ auth: { emailPassword: true, google: true, github: false } }) });
  await page.route("**/api/meta", googleAvailable);
  let linkInput;
  await page.route("**/api/auth/link-social", (route) => {
    linkInput = route.request().postDataJSON();
    return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "LINKING_DIFFERENT_EMAILS_NOT_ALLOWED", message: "Untrusted provider error details" }) });
  });
  await preferences();
  await page.getByRole("button", { name: "Connect Google", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "That account uses a different email address." }).waitFor();
  const successURL = linkInput && new URL(linkInput.callbackURL);
  const failureURL = linkInput && new URL(linkInput.errorCallbackURL);
  verify("mocked Connect supplies same-origin success and failure returns", linkInput?.provider === "google" && successURL?.origin === new URL(BASE).origin && successURL.pathname === destination && successURL.searchParams.get("linked") === "google" && failureURL?.origin === new URL(BASE).origin && failureURL.pathname === destination && failureURL.searchParams.get("link") === "failed");
  verify("mocked Connect mismatch shows fixed plain copy", await page.getByText("Untrusted provider error details", { exact: true }).count() === 0);
  await page.unroute("**/api/auth/link-social");
  await page.unroute("**/api/meta", googleAvailable);

  stage = "mocked OAuth failure return";
  await preferences("?link=failed&error=email_does_not_match&error_description=untrusted-return-details");
  await page.getByRole("alert").filter({ hasText: "That account uses a different email address." }).waitFor();
  verify("mocked OAuth mismatch return is visible without reflecting raw details", await page.getByText(/untrusted-return-details/).count() === 0);
  await preferences("?linked=google");
  verify("mocked success URL alone cannot claim a provider was linked", await page.getByRole("alert").filter({ hasText: "The connection didn't finish. Try again." }).count() === 1);
  const unchangedAccounts = await api("/api/auth/list-accounts");
  verify("mocked OAuth checks leave actual linked accounts unchanged", JSON.stringify(unchangedAccounts.map(({ id, providerId }) => ({ id, providerId }))) === JSON.stringify(accounts.map(({ id, providerId }) => ({ id, providerId }))));
} catch (error) {
  // Arbitrary exception text can contain browser request details. Report only
  // the controlled stage and exception category, never request/response data.
  check(`preferences workflow completes (${stage})`, false, error?.name ?? "Error");
} finally {
  if (page && originalStorage) {
    try {
      await page.goto(`${BASE}/settings`); // Unmount the existing editor save timer first.
      await page.evaluate((saved) => { for (const [key, value] of Object.entries(saved)) { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } }, originalStorage);
      const restored = await page.evaluate((saved) => Object.entries(saved).every(([key, value]) => localStorage.getItem(key) === value), originalStorage);
      check("original browser theme and editor storage are restored", restored);
    } catch { check("original browser theme and editor storage are restored", false); }
  }
  if (context && digestMayHaveChanged && originalDigest) {
    try {
      const restored = await context.request.put(`${BASE}/api/me/notification-settings`, { data: { emailDigest: originalDigest.emailDigest } });
      check("original digest preference is restored", restored.ok() && (await api("/api/me/notification-settings")).emailDigest === originalDigest.emailDigest);
    } catch { check("original digest preference is restored", false); }
  }
  if (context && originalEditor) {
    try {
      const after = await api("/api/me/settings");
      check("saved editor preferences and imported themes are unchanged", JSON.stringify(after.settings?.editor ?? {}) === JSON.stringify(originalEditor.settings?.editor ?? {}) && JSON.stringify(after.settings?.themes ?? []) === JSON.stringify(originalEditor.settings?.themes ?? []));
    } catch { check("saved editor preferences and imported themes are unchanged", false); }
  }
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
check("no browser page errors", Boolean(errors) && errors.length === 0);
finish();
