// Tasks (roadmap §14 A): a .vscode/tasks.json with a default build task and another task, and a package.json's
// script. Ctrl+Shift+B runs the build task in a Task terminal with ${relativeFile} filled in; Run task… in the
// palette lists every task (npm scripts too) and runs the one picked in the same terminal, in its folder. The
// test's folders have a stamp in their names (.vscode is removed only if the test made it).
//   node test/tasks.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const folder = `tk_${stamp}`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const TASKS = `{
  // As VS Code writes it.
  "version": "2.0.0",
  "tasks": [
    { "label": "say hello", "type": "shell", "command": "echo", "args": ["hello-from-\${relativeFile}"], "group": { "kind": "build", "isDefault": true } },
    { "label": "where am I", "command": "pwd", "options": { "cwd": "\${workspaceFolder}/${folder}" } },
  ],
}`;

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const tree = a.getByRole("tree", { name: "Files" });
const madeFolders = [];

async function newFolder(name) {
  await a.getByRole("button", { name: "New folder" }).click();
  await a.getByPlaceholder("folder").fill(name);
  await a.getByPlaceholder("folder").press("Enter");
  await tree.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) }).waitFor({ timeout: 10_000 });
  madeFolders.push(name);
}
async function newFileIn(dir, name, text) {
  const row = tree.getByRole("treeitem", { name: new RegExp(`^${dir.replace(".", "\\.")}`) });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await row.click({ button: "right" });
  await a.getByRole("menuitem", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(500);
}
const taskScreen = () => a.locator(".xterm-rows").last();

try {
  if (!(await tree.getByRole("treeitem", { name: /^\.vscode/ }).count())) await newFolder(".vscode");
  await newFileIn(".vscode", "tasks.json", TASKS);
  await newFolder(folder);
  await newFileIn(folder, "package.json", '{ "scripts": { "greet": "echo npm-greeting-ok" } }');

  // Ctrl+Shift+B from README.md: the default build task, with the open file's path filled in.
  await tree.getByRole("treeitem", { name: /^README\.md/ }).click();
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Shift+B");
  check("buildTaskTab", await ok(a.getByRole("tab", { name: "Task: say hello" }).waitFor({ timeout: 10_000 })));
  // The output line itself (the typed command line contains the words too).
  check("buildTaskRuns", await ok(taskScreen().getByText("hello-from-README.md", { exact: true }).waitFor({ timeout: 60_000 })));

  // Run task… lists tasks.json's and the npm script; the picked one runs in its folder.
  await a.keyboard.press("F1");
  await a.keyboard.type("Run task");
  await a.keyboard.press("Enter");
  const picker = a.getByRole("dialog", { name: "Run task" });
  await picker.waitFor({ timeout: 5_000 });
  const options = (await picker.getByRole("option").allInnerTexts()).map((t) => t.split("\n")[0]);
  check("listsEveryTask", ["say hello", "where am I", `npm: greet (${folder})`].every((label) => options.includes(label)), options.join(" | "));
  await a.keyboard.type("where am I");
  await a.keyboard.press("Enter");
  check("pickedTaskRunsInItsFolder", await ok(taskScreen().getByText(new RegExp(`^/workspace/${folder}\\s*$`)).first().waitFor({ timeout: 30_000 })), JSON.stringify(await taskScreen().evaluate((el) => [...el.children].map((r) => r.textContent).filter((t) => t.trim()).slice(-4))));
  check("tabNamesTheTask", await ok(a.getByRole("tab", { name: "Task: where am I" }).waitFor({ timeout: 5_000 })), (await a.getByRole("tab").allInnerTexts()).join(" | "));

  await a.keyboard.press("F1");
  await a.keyboard.type("Run task");
  await a.keyboard.press("Enter");
  await picker.waitFor({ timeout: 5_000 });
  await a.keyboard.type("greet");
  await a.keyboard.press("Enter");
  check("npmScriptRuns", await ok(taskScreen().getByText("npm-greeting-ok", { exact: true }).waitFor({ timeout: 60_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "tasks.png") });
} catch (error) {
  const shot = join(tmpdir(), "tasks-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    await a.keyboard.press("Escape");
    a.on("dialog", (dialog) => void dialog.accept());
    for (const name of [...madeFolders].reverse()) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFoldersDeleted", true, madeFolders.join(", "));
  } catch (error) {
    check("testFoldersDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
