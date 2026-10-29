// Keyboard shortcuts (roadmap §6): Ctrl+K Ctrl+S opens the sheet; a new key for "Open a terminal" opens one; Zen
// mode moved to a new chord works in the code editor and out of it, and its old chord stops; a key another command
// had (Ctrl+P, Go to file) moves with a note and runs its new command; the palette shows your keys; they're saved
// to your account; Reset all puts every default back. test1's shortcuts are reset at the end.
//   node test/shortcuts.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const sheet = a.getByRole("dialog", { name: "Keyboard shortcuts" });
const nav = a.getByRole("navigation", { name: "Panels" });
const zenOn = a.getByRole("button", { name: /Leave Zen mode/ });
const saved = () => a.evaluate(() => fetch("/api/me/settings").then((r) => r.json()).then((r) => r.settings?.editor?.keybindings ?? null));
const code = a.locator(".monaco-editor .view-lines:visible").first();
// Focus a row of the file list without opening it (clicking would open another test's file).
const outsideEditor = () => a.getByRole("tree", { name: "Files" }).getByRole("treeitem").first().focus();

async function openSheet() {
  await outsideEditor();
  await a.keyboard.press("Control+k");
  await a.keyboard.press("Control+s");
  await sheet.waitFor({ timeout: 10_000 });
}
async function search(text) {
  await sheet.getByLabel("Search shortcuts").fill(text);
}
/** Record keys for a command: each press, then Enter. */
async function addKey(label, presses) {
  await sheet.getByRole("button", { name: `Add a key to ${label}` }).click();
  for (const press of presses) await a.keyboard.press(press);
  await a.keyboard.press("Enter");
  await sheet.getByRole("group", { name: "New key" }).waitFor({ state: "detached", timeout: 5_000 });
}
const row = (label) => sheet.getByRole("listitem", { name: label, exact: true });

try {
  // README.md in the code editor (another test's notebook may be the open tab).
  await a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^README\.md/ }).click();
  await code.waitFor({ timeout: 30_000 });
  await openSheet();
  check("chordOpensSheet", await sheet.isVisible());
  await search("terminal");
  const terminalRow = row("Open a terminal");
  check("defaultsListed", (await terminalRow.innerText()).includes("Ctrl `"), await terminalRow.innerText());

  // A new key for Open a terminal, then pressed.
  await addKey("Open a terminal", ["Control+Alt+t"]);
  check("keyAdded", (await terminalRow.innerText()).includes("Ctrl Alt T"), await terminalRow.innerText());

  // Zen mode on a new chord only.
  await search("zen");
  await addKey("Toggle Zen mode", ["Control+k", "Control+z"]);
  await sheet.getByRole("button", { name: "Remove Ctrl K, Z from Toggle Zen mode" }).click();
  const zenRow = row("Toggle Zen mode");
  check("chordRebound", (await zenRow.innerText()).includes("Ctrl K, Ctrl Z") && !(await zenRow.innerText()).includes("Ctrl K, Z\n"), await zenRow.innerText());

  // Ctrl+P, Go to file's, given to Show problems: it moves.
  await search("problems");
  await addKey("Show problems", ["Control+p"]);
  const moved = a.getByText(/Ctrl P moved here from “Go to file…”/);
  check("conflictMoves", await ok(moved.waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "shortcuts.png") });
  await a.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached", timeout: 5_000 });

  await outsideEditor();
  await a.keyboard.press("Control+Alt+t");
  check("newKeyOpensTerminal", await ok(a.locator(".xterm:visible").first().waitFor({ timeout: 15_000 })));

  // The new chord in the code editor, and out of it; the old one does nothing now.
  await code.click();
  await a.keyboard.press("Control+k");
  await a.keyboard.press("Control+z");
  check("chordInEditor", await ok(zenOn.waitFor({ timeout: 5_000 })));
  await zenOn.click();
  await nav.waitFor({ timeout: 5_000 });
  await outsideEditor();
  await a.keyboard.press("Control+k");
  await a.keyboard.press("Control+z");
  check("chordOutsideEditor", await ok(zenOn.waitFor({ timeout: 5_000 })));
  await zenOn.click();
  await nav.waitFor({ timeout: 5_000 });
  await outsideEditor();
  await a.keyboard.press("Control+k");
  await a.keyboard.press("z");
  await a.waitForTimeout(500);
  check("oldChordGone", (await zenOn.count()) === 0);

  // Ctrl+P runs its new command; Quick Open doesn't open.
  await outsideEditor();
  await a.keyboard.press("Control+p");
  const problems = a.getByRole("region", { name: "Output and terminals" }).getByRole("tab", { name: /^Problems/, selected: true });
  const quickOpen = a.getByRole("dialog", { name: "Open file" });
  check("movedKeyRunsNewCommand", (await ok(problems.waitFor({ timeout: 5_000 }))) && (await quickOpen.count()) === 0);

  // The palette shows your keys.
  await a.keyboard.press("F1");
  const palette = a.getByRole("dialog", { name: "Command palette" });
  await palette.waitFor({ timeout: 5_000 });
  await a.keyboard.type("Toggle Zen");
  const option = palette.getByRole("option", { name: /Toggle Zen mode/ });
  check("paletteShowsYourKeys", (await option.innerText()).includes("Ctrl K, Ctrl Z"), await option.innerText());
  await a.keyboard.press("Escape");

  // Saved to your account (a moment after the change).
  await a.waitForTimeout(2_500);
  const stored = await saved();
  check(
    "savedToAccount",
    JSON.stringify(stored?.terminal) === JSON.stringify(["Ctrl+`", "Ctrl+Alt+T"]) && JSON.stringify(stored?.zen) === JSON.stringify(["Ctrl+K Ctrl+Z"]) && JSON.stringify(stored?.["quick-open"]) === "[]",
    JSON.stringify(stored),
  );

  // Reset all: Ctrl+P is Go to file's again.
  await openSheet();
  await sheet.getByRole("button", { name: "Reset all" }).click();
  await a.keyboard.press("Escape");
  await outsideEditor();
  await a.keyboard.press("Control+p");
  check("resetAllRestoresDefaults", await ok(quickOpen.waitFor({ timeout: 5_000 })));
  await a.keyboard.press("Escape");
} catch (error) {
  const shot = join(tmpdir(), "shortcuts-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  // test1's shortcuts back to the defaults, in this browser and the account.
  await a.evaluate(() => {
    const raw = localStorage.getItem("cc-editor-settings");
    if (raw) {
      const stored = JSON.parse(raw);
      stored.state.keybindings = {};
      localStorage.setItem("cc-editor-settings", JSON.stringify(stored));
    }
    return fetch("/api/me/settings")
      .then((r) => r.json())
      .then(({ settings }) =>
        settings &&
        fetch("/api/me/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ editor: { ...settings.editor, keybindings: {} }, themes: settings.themes }),
        }),
      );
  });
  const after = await saved();
  check("shortcutsReset", !after || Object.keys(after).length === 0, JSON.stringify(after));
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
