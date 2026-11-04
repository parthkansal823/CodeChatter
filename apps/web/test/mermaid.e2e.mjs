/** Mermaid room files render for two people, update live, and keep their last drawing through mistakes. */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const name = `flow_${Date.now().toString(36)}.mmd`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const code = (page) => page.locator(".monaco-editor .view-lines:visible").first();
const preview = (page) => page.getByRole("region", { name: `Preview of ${name}` });
const image = (page) => preview(page).getByRole("img", { name: `Diagram preview of ${name}` });
const row = (page) => page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
const ok = (promise) => promise.then(() => true, () => false);

const { browser, errors, signIn } = await launch();
const contexts = [];
let a;
let created = false;

async function replaceSource(text) {
  await code(a).click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
}

async function openPreview(page) {
  await code(page).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("v");
  await image(page).waitFor({ timeout: 30_000 });
  await page.waitForFunction((label) => {
    const img = Array.from(document.querySelectorAll("img")).find((candidate) => candidate.alt === label);
    return img?.complete && img.naturalWidth > 0;
  }, `Diagram preview of ${name}`, { timeout: 30_000 });
}

try {
  const owner = await signIn("test1@codechatter.local");
  a = owner.page;
  contexts.push(owner.context);
  await owner.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const editor = await signIn("test2@codechatter.local");
  const b = editor.page;
  contexts.push(editor.context);

  await a.getByRole("button", { name: "New file", exact: true }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  created = true;
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  await replaceSource("graph TD\n  A[Start] --> B[Done]\n");
  await openPreview(a);
  check("ownerSeesDiagram", await image(a).isVisible());

  await row(b).waitFor({ timeout: 15_000 });
  await row(b).dblclick();
  await b.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  await openPreview(b);
  check("editorSeesDiagram", await image(b).isVisible());
  const before = await image(b).getAttribute("src");

  await code(a).click();
  await a.keyboard.press("Control+End");
  await a.keyboard.insertText("  B --> C[Again]\n");
  await b.waitForFunction(({ label, previous }) => {
    const img = Array.from(document.querySelectorAll("img")).find((candidate) => candidate.alt === label);
    const src = img?.getAttribute("src") ?? "";
    return src !== previous && decodeURIComponent(src).includes("Again") && img.complete && img.naturalWidth > 0;
  }, { label: `Diagram preview of ${name}`, previous: before }, { timeout: 15_000 });
  check("editUpdatesOtherPreview", true);
  const lastGood = await image(b).getAttribute("src");
  await a.waitForFunction((label) => {
    const img = Array.from(document.querySelectorAll("img")).find((candidate) => candidate.alt === label);
    return img?.complete && img.naturalWidth > 0 && decodeURIComponent(img.src).includes("Again");
  }, `Diagram preview of ${name}`, { timeout: 15_000 });
  const lastGoodOwner = await image(a).getAttribute("src");

  await replaceSource("graph TD\n  A[Start] --> B[Done]\n  B --> C[Again\n");
  const problem = preview(a).getByRole("alert");
  await problem.waitFor({ timeout: 15_000 });
  const message = await problem.innerText();
  const line = Number(/Line (\d+):/.exec(message)?.[1]);
  check("mistakeHasLine", Number.isInteger(line) && line > 0, message);
  await preview(b).getByRole("alert").waitFor({ timeout: 15_000 });
  check("lastGoodDrawingStays", await image(b).isVisible() && (await image(b).getAttribute("src")) === lastGood);

  // The error link also restores the editor when only the preview is showing.
  await a.keyboard.press("Control+Shift+v");
  await preview(a).getByRole("button", { name: "Show the code", exact: true }).waitFor({ timeout: 5_000 });
  check("previewOnItsOwn", (await a.locator(".monaco-editor:visible").count()) === 0);
  check("lastGoodDrawingSurvivesFullPreview", await image(a).isVisible() && (await image(a).getAttribute("src")) === lastGoodOwner);
  await problem.getByRole("button", { name: "Show in the code", exact: true }).click();
  check("problemRevealsItsLine", Number.isInteger(line) && line > 0 && await ok(a.getByText(`Ln ${line}, Col 1`, { exact: true }).waitFor({ timeout: 5_000 })));
  check("problemFocusesCode", await ok(a.waitForFunction(() => Boolean(document.activeElement?.closest(".monaco-editor")), undefined, { timeout: 5_000 })));
  check("lastGoodDrawingSurvivesShowingCode", await image(a).isVisible() && (await image(a).getAttribute("src")) === lastGoodOwner);
} catch (error) {
  const shot = join(tmpdir(), `mermaid-${name}-failed.png`);
  const failedPage = a ?? browser.contexts().flatMap((context) => context.pages()).at(-1);
  await failedPage?.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    if (created && a) {
      await row(a).focus();
      await row(a).press("Delete");
      await row(a).waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFileDeleted", true, name);
  } catch (error) {
    check("testFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
}

check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
