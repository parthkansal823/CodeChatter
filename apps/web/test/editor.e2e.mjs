// The editor's VS Code-style features: the command centre and palette (F1, ">" in Quick Open), Zen mode,
// Markdown preview, the split editor, go to line, change language, compare two files, and following
// someone (their file opens for you).
//   node test/editor.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch } from "./browser.mjs";

const ok = (promise) => promise.then(() => true, () => false);
const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;
await a.getByRole("tab", { name: /README\.md/ }).waitFor({ timeout: 30_000 });

const palette = a.getByRole("dialog", { name: "Command palette" });
async function command(name) {
  await a.keyboard.press("F1");
  await palette.waitFor({ timeout: 5_000 });
  await a.keyboard.type(name);
  await a.keyboard.press("Enter");
}

// The command centre opens Quick Open; ">" jumps to every command.
await a.getByRole("button", { name: /Search files, or type/ }).click();
await a.keyboard.type(">");
check("commandCentreOpensPalette", await ok(palette.waitFor({ timeout: 5_000 })));
const commands = await palette.getByRole("option").count();
check("paletteListsCommands", commands > 30, `${commands} commands`);
await a.keyboard.press("Escape");

// Zen mode hides everything but the editor, and comes back.
await command("Toggle Zen");
const nav = a.getByRole("navigation", { name: "Panels" });
const leave = a.getByRole("button", { name: /Leave Zen mode/ });
check("zenHidesChrome", (await ok(leave.waitFor({ timeout: 5_000 }))) && (await nav.count()) === 0);
await leave.click();
check("zenComesBack", await ok(nav.waitFor({ timeout: 5_000 })));

// Markdown preview: beside the code (button or Ctrl+K V), or on its own to read (Ctrl+Shift+V or "Preview only").
await a.getByRole("button", { name: "Markdown preview" }).click();
const preview = a.getByRole("region", { name: "Preview of README.md" });
check("markdownPreview", await ok(preview.getByRole("heading").first().waitFor({ timeout: 5_000 })));
await preview.getByRole("button", { name: /Preview only/ }).click();
await a.waitForTimeout(400);
check("markdownPreviewOnly", (await preview.isVisible()) && (await a.locator(".monaco-editor:visible").count()) === 0);
await preview.getByRole("button", { name: "Close the preview" }).click();
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.press("Control+k");
await a.keyboard.press("v");
check("markdownPreviewShortcut", await ok(preview.waitFor({ timeout: 5_000 })));
await preview.getByRole("button", { name: "Close the preview" }).click();

// A second editor beside the first.
await a.getByRole("button", { name: "Split editor" }).click();
const split = a.getByRole("region", { name: /^Split editor: / });
check("splitEditor", (await ok(split.locator(".monaco-editor").waitFor({ timeout: 10_000 }))) && (await a.locator(".monaco-editor").count()) >= 2);
await split.getByRole("button", { name: "Close the split editor" }).click();

// Suggestions are readable: the highlighted row's text against its background (the light theme once showed white on grey).
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.press("Control+End");
await a.keyboard.press("Enter");
await a.keyboard.type("Ad");
await a.keyboard.press("Control+Space");
const row = a.locator(".monaco-editor .suggest-widget .monaco-list-row.focused").first();
const shown = await ok(row.waitFor({ timeout: 5_000 }));
const contrast = shown
  ? await row.evaluate((el) => {
      const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const channel = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const text = el.querySelector(".label-name, .monaco-icon-name-container") ?? el;
      let box = el;
      let bg = parse(getComputedStyle(box).backgroundColor);
      while (bg.length === 4 && bg[3] === 0 && box.parentElement) bg = parse(getComputedStyle((box = box.parentElement)).backgroundColor);
      const [hi, lo] = [luminance(parse(getComputedStyle(text).color)), luminance(bg)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    })
  : 0;
check("suggestionsReadable", contrast >= 4.5, `contrast ${contrast.toFixed(2)}:1`);
await a.keyboard.press("Escape");
for (let i = 0; i < 3; i++) await a.keyboard.press("Control+z");

// Go to line (Ctrl+G).
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.press("Control+g");
await a.getByRole("dialog", { name: "Go to line" }).waitFor({ timeout: 5_000 });
await a.keyboard.type("3");
await a.keyboard.press("Enter");
check("goToLine", await ok(a.getByText("Ln 3, Col 1").waitFor({ timeout: 5_000 })));

// Change language mode: the README is highlighted as Python until you leave the room.
await command("Change language");
await a.getByRole("dialog", { name: "Change language mode" }).waitFor({ timeout: 5_000 });
await a.keyboard.type("Python");
await a.keyboard.press("Enter");
check("changeLanguage", await ok(a.getByText("Python", { exact: true }).last().waitFor({ timeout: 5_000 })));

// A file of the test's own, to compare with and to follow into: a fresh room has only its README.
const extra = `srv_${Date.now().toString(36)}.js`;
const extraTab = new RegExp(extra.replace(".", "\\."));
await a.getByRole("button", { name: "New file" }).click();
await a.getByPlaceholder("name.ext").fill(extra);
await a.getByPlaceholder("name.ext").press("Enter");
await a.getByRole("tab", { name: extraTab }).waitFor({ timeout: 15_000 });
await a.getByRole("tab", { name: /README\.md/ }).click();

// Compare with another file: a diff editor of the two live files.
await command("Compare");
await a.getByRole("dialog", { name: "Compare with" }).waitFor({ timeout: 5_000 });
await a.keyboard.type(extra);
await a.keyboard.press("Enter");
// The open README may be in a folder (a template's), which the label then names.
const comparing = a.getByRole("region", { name: /^Comparing (\S+\/)?README\.md with / });
check("compareFiles", await ok(comparing.locator(".monaco-diff-editor").waitFor({ timeout: 10_000 })));
await comparing.getByRole("button", { name: "Close the comparison" }).click();

// Follow test2: the file they open opens for test1.
await command("Follow");
const people = a.getByRole("dialog", { name: "Follow someone" });
await people.waitFor({ timeout: 5_000 });
await people.getByRole("option", { name: "test2" }).click();
check("followBanner", await ok(a.getByText(/Following test2/).waitFor({ timeout: 5_000 })));
// test1 closes its tab of the file first, so the one that opens is test2's doing.
await a.getByRole("tab", { name: extraTab }).getByRole("button", { name: /Close/ }).click().catch(() => {});
const theirFile = b.getByRole("tree", { name: "Files" }).getByText(extra, { exact: true });
await theirFile.click();
check("followOpensTheirFile", await ok(a.getByRole("tab", { name: extraTab }).waitFor({ timeout: 10_000 })), extra);

// Leave the room as it was.
const extraRow = b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${extra.replace(".", "\\.")}`) });
await extraRow.focus();
await extraRow.press("Delete");
check("testFileDeleted", await ok(extraRow.waitFor({ state: "detached", timeout: 10_000 })), extra);

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/editor.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
