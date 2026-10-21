// Editor settings follow you (roadmap §14 A): a change in one browser is saved to your account, and a fresh browser
// (nothing in its storage) signed in as you opens the room with it. Uses test2 and puts its defaults back at the end.
//   node test/account-settings.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const reset = (page) =>
  page.evaluate(() => fetch("/api/me/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ editor: {}, themes: [] }) }).then((r) => r.status));

const { browser, errors, signIn } = await launch();
const first = (await signIn("test2@codechatter.local")).page;
try {
  check("startsFromDefaults", (await reset(first)) === 200);
  await first.reload();
  await first.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });

  // Two sizes up, and word wrap on, in the first browser.
  await first.locator(".monaco-editor .view-lines").first().click();
  await first.keyboard.press("Control+,");
  const dialog = first.getByRole("dialog", { name: "Editor settings" });
  await dialog.waitFor({ timeout: 5_000 });
  await dialog.getByRole("button", { name: "Larger font" }).click();
  await dialog.getByRole("button", { name: "Larger font" }).click();
  await dialog.getByLabel("Word wrap").click();
  check("savedToAccount", await ok(first.waitForResponse((r) => r.url().endsWith("/api/me/settings") && r.request().method() === "PUT" && r.ok(), { timeout: 10_000 })));

  // A fresh browser profile: nothing stored, the account has it.
  const second = (await signIn("test2@codechatter.local")).page;
  await second.locator(".monaco-editor .view-lines").first().click();
  await second.keyboard.press("Control+,");
  const there = second.getByRole("dialog", { name: "Editor settings" });
  await there.waitFor({ timeout: 5_000 });
  check("fontSizeFollows", (await there.getByLabel("Font size").innerText()) === "16", await there.getByLabel("Font size").innerText());
  check("wordWrapFollows", (await there.getByLabel("Word wrap").getAttribute("aria-checked")) === "true");
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  await reset(first).catch(() => {});
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
