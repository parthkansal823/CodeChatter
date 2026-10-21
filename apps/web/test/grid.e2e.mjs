// The editor grid (roadmap §14 A): Ctrl+\ splits right, Split editor down fills below the main editor and then
// below the right one (four editors), every editor edits the same live file, each can show another file (Change
// file), and closing one or all puts the layout back. The test's file has a stamp in its name and is deleted.
//   node test/grid.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const name = `gr_${stamp}.txt`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let created = false;
const region = (label) => a.getByRole("region", { name: new RegExp(`^${escape(label)}: `) });
const editors = () => a.locator(".monaco-editor").count();

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  await a.keyboard.insertText("first line");

  await a.keyboard.press("Control+\\");
  check("splitRight", await ok(region("Split editor").waitFor({ timeout: 10_000 })));
  await a.getByRole("button", { name: "Split down" }).click();
  check("splitBelow", await ok(region("Editor below").waitFor({ timeout: 10_000 })));
  await a.getByRole("button", { name: "Split down" }).click();
  check("splitBelowRight", await ok(region("Editor below right").waitFor({ timeout: 10_000 })) && (await editors()) === 4, `${await editors()} editors`);

  // One live file in every editor: typing below shows in the main one.
  await region("Editor below").locator(".monaco-editor .view-lines").click();
  await a.keyboard.press("Control+End");
  await a.keyboard.insertText(" plus more");
  const mainText = () => a.locator(".monaco-editor .view-lines").first().innerText();
  // Monaco draws spaces as no-break spaces: compare with plain ones.
  check("sameLiveFile", await ok(a.waitForFunction(() => document.querySelector(".monaco-editor .view-lines")?.textContent?.replace(/ /g, " ").includes("plus more"), null, { timeout: 5_000 })), await mainText());

  // Another file in one editor of the grid.
  await region("Editor below right").getByRole("button", { name: "Change file" }).click();
  await a.getByRole("dialog", { name: "Show in this editor" }).waitFor({ timeout: 5_000 });
  await a.keyboard.type("README");
  await a.getByRole("dialog", { name: "Show in this editor" }).getByRole("option", { name: /README\.md/ }).click();
  check("changeFile", await ok(a.getByRole("region", { name: "Editor below right: README.md" }).waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "grid.png") });

  await region("Editor below").getByRole("button", { name: "Close the editor below" }).click();
  check("closeOne", (await region("Editor below").count()) === 0 && (await editors()) === 3);
  await a.getByRole("button", { name: "Close all split editors" }).click();
  check("closeAll", (await editors()) === 1 && (await a.getByRole("button", { name: "Close all split editors" }).count()) === 0);
} catch (error) {
  const shot = join(tmpdir(), "grid-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
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
