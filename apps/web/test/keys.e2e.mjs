// Emmet and Vim (roadmap §14 A): in an HTML file an Emmet abbreviation expands from the completions, and in
// CSS a property abbreviation does too; with Vim key bindings on (from the palette), the editor starts in
// normal mode, `i` types, Escape goes back, `dd` deletes a line, `u` undoes, `:w` says it's saved, and turning
// them off gives the usual keys back. The test's files have a stamp in their names and are deleted at the end.
//   node test/keys.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const html = `ky_${stamp}.html`;
const css = `ky_${stamp}.css`;
const txt = `ky_${stamp}.txt`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const created = [];

async function newFile(name) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Delete");
}
/** The editor's text from its rendered lines, in order. */
const code = () =>
  a.evaluate(() =>
    [...(document.querySelector(".monaco-editor .view-lines")?.querySelectorAll(".view-line") ?? [])]
      .sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top))
      .map((line) => line.textContent.replace(/ /g, " "))
      .join("\n")
      .trimEnd(),
  );
async function command(name) {
  await a.keyboard.press("F1");
  await a.getByRole("dialog", { name: "Command palette" }).waitFor({ timeout: 5_000 });
  await a.keyboard.type(name);
  await a.keyboard.press("Enter");
}
async function eventually(test, timeout = 5_000) {
  for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) if (await test()) return true;
  return false;
}

try {
  // Emmet in HTML: ul>li*2 from the completions.
  await newFile(html);
  await a.keyboard.type("ul>li*2");
  const emmet = a.locator(".suggest-widget .monaco-list-row", { hasText: "Emmet" }).first();
  check("emmetOffered", await ok(emmet.waitFor({ timeout: 10_000 })), await a.locator(".suggest-widget").innerText().catch(() => "no list"));
  await emmet.click();
  check("emmetExpandsHtml", await eventually(async () => (await code()).replace(/\s+/g, "") === "<ul><li></li><li></li></ul>"), JSON.stringify(await code()));

  // Emmet in CSS: a property abbreviation.
  await newFile(css);
  await a.keyboard.type("p { m10");
  const cssEmmet = a.locator(".suggest-widget .monaco-list-row", { hasText: /margin/ }).first();
  await ok(cssEmmet.waitFor({ timeout: 10_000 }));
  await a.keyboard.press("Enter");
  check("emmetExpandsCss", await eventually(async () => (await code()).includes("margin: 10px")), JSON.stringify(await code()));

  // Vim key bindings, turned on from the palette.
  await newFile(txt);
  await a.keyboard.insertText("one\ntwo\nthree");
  await command("Turn Vim key bindings on");
  const status = a.getByLabel("Vim", { exact: true });
  check("vimStatusBar", await ok(status.waitFor({ timeout: 10_000 })));
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Escape");
  await a.keyboard.press("g");
  await a.keyboard.press("g");
  await a.keyboard.type("dd");
  check("vimDeletesLine", await eventually(async () => (await code()) === "two\nthree"), JSON.stringify(await code()));
  await a.keyboard.type("u");
  check("vimUndo", await eventually(async () => (await code()) === "one\ntwo\nthree"), JSON.stringify(await code()));
  await a.keyboard.type("A!");
  check("vimInsertMode", await eventually(async () => (await code()) === "one!\ntwo\nthree") && (await status.innerText()).toUpperCase().includes("INSERT"), `${JSON.stringify(await code())} ${await status.innerText()}`);
  await a.keyboard.press("Escape");
  await a.keyboard.type(":w");
  await a.keyboard.press("Enter");
  check("vimWriteSaves", await ok(a.getByText("Saved. Changes sync as you type.").waitFor({ timeout: 5_000 })));

  await command("Turn Vim key bindings off");
  check("vimOff", await ok(status.waitFor({ state: "detached", timeout: 5_000 })));
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+End");
  await a.keyboard.type("dd");
  check("standardKeysBack", await eventually(async () => (await code()).endsWith("threedd")), JSON.stringify(await code()));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "keys.png") });
} catch (error) {
  const shot = join(tmpdir(), "keys-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    // Settings are saved to the account: put the defaults back there (and in this browser) for other tests.
    await a.evaluate(async () => {
      localStorage.removeItem("cc-editor-settings");
      localStorage.removeItem("cc-editor-themes");
      await fetch("/api/me/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ editor: {}, themes: [] }) });
    });
    const tree = a.getByRole("tree", { name: "Files" });
    for (const name of created) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFilesDeleted", true, created.join(", "));
  } catch (error) {
    check("testFilesDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
