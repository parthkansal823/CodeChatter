// Editor themes (roadmap §14 A): Settings, Theme switches every editor to a built-in theme; Import… takes a VS
// Code theme's .json (comments and all), colours the background and the keywords from it, and keeps it after a
// reload; a file that isn't a theme says why; removing it goes back to the room's own theme. The test's file
// has a stamp in its name and is deleted at the end.
//   node test/themes.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const name = `th_${stamp}.js`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// eslint-disable-next-line no-restricted-syntax -- a VS Code theme's own colours are the test's input
const THEME = `{
  // A dark theme, as an extension ships it.
  "name": "Night Owl Test",
  "type": "dark",
  "colors": { "editor.background": "#011627", "editor.foreground": "#d6deeb", },
  "tokenColors": [
    { "scope": "keyword", "settings": { "foreground": "#7fdbca" } },
  ],
}`;

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let created = false;

const settings = a.getByRole("dialog", { name: "Editor settings" });
const background = () => a.locator(".monaco-editor .monaco-editor-background").first().evaluate((el) => getComputedStyle(el).backgroundColor);
const keywordColor = () => a.locator(".monaco-editor .view-lines span", { hasText: /^const$/ }).first().evaluate((el) => getComputedStyle(el).color);
async function openSettings() {
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+,");
  await settings.waitFor({ timeout: 5_000 });
}
async function pickTheme(label) {
  await settings.getByLabel("Theme", { exact: true }).click();
  await a.getByRole("option", { name: label }).click();
}
async function eventually(test, timeout = 5_000) {
  for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) if (await test()) return true;
  return false;
}

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText("const answer = 42;\n");
  const roomOwn = await background();

  await openSettings();
  check("themeDefaultsToRoom", (await settings.getByLabel("Theme", { exact: true }).innerText()).includes("CodeChatter"));
  await pickTheme("Visual Studio Dark");
  check("builtInTheme", await eventually(async () => (await background()) === "rgb(30, 30, 30)"), await background());

  await settings.getByLabel("VS Code theme file").setInputFiles({ name: "night-owl.json", mimeType: "application/json", buffer: Buffer.from(THEME) });
  check("importToast", await ok(a.getByText("Night Owl Test is your editor theme.").waitFor({ timeout: 5_000 })));
  check("importedBackground", await eventually(async () => (await background()) === "rgb(1, 22, 39)"), await background());
  check("importedKeywords", await eventually(async () => (await keywordColor()) === "rgb(127, 219, 202)"), await keywordColor());
  check("listedInSettings", (await settings.getByLabel("Theme", { exact: true }).innerText()).includes("Night Owl Test"));

  await settings.getByLabel("VS Code theme file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{ "version": 2 }') });
  check("notAThemeSaysSo", await ok(a.getByText("That file has no colours: it isn't a VS Code theme.").waitFor({ timeout: 5_000 })));
  await a.keyboard.press("Escape");

  await a.reload();
  await a.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) }).click();
  check("keptAfterReload", await eventually(async () => (await background()) === "rgb(1, 22, 39)", 15_000), await background().catch(() => "no editor"));

  await openSettings();
  await settings.getByRole("button", { name: "Remove this theme" }).click();
  check("removedBackToRoom", await eventually(async () => (await background()) === roomOwn) && (await settings.getByLabel("Theme", { exact: true }).innerText()).includes("CodeChatter"), await background());
  await a.keyboard.press("Escape");
} catch (error) {
  const shot = join(tmpdir(), "themes-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  await a.keyboard.press("Escape");
  // Whatever happened, leave this browser's editor theme as the room's own.
  // Settings are saved to the account: put the defaults back there (and in this browser) for other tests.
  await a.evaluate(async () => {
    localStorage.removeItem("cc-editor-settings");
    localStorage.removeItem("cc-editor-themes");
    await fetch("/api/me/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ editor: {}, themes: [] }) });
  });
  if (created) {
    try {
      const row = a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
      check("testFileDeleted", true);
    } catch (error) {
      check("testFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
