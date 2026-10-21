// launch.json for the room's debugger (roadmap §14 A): Run and debug adds .vscode/launch.json, a configuration
// with arguments and environment shows in its picker (one it can't run is listed with why), Debug runs it, and so
// does F5 while it's picked. The test's file and .vscode folder are deleted.
//   node test/launch.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stamp = Date.now().toString(36);
const file = `lc_${stamp}.py`;
const config = JSON.stringify({
  version: "0.2.0",
  configurations: [
    { name: "Greet", type: "debugpy", request: "launch", program: `\${workspaceFolder}/${file}`, args: ["one", "two words"], env: { GREETING: "hi" } },
    { name: "Old binary", type: "cppdbg", request: "launch", program: "${workspaceFolder}/a.out" },
  ],
});

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const tree = a.getByRole("tree", { name: "Files" });
const panels = a.getByRole("navigation", { name: "Panels" });
let created = false;
let launchMade = false;

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText('import os, sys\nprint("argv", sys.argv[1:], os.environ.get("GREETING"))\n');

  await panels.getByRole("button", { name: "Run and debug" }).click();
  const view = a.getByRole("region", { name: "Run and debug" });
  await view.getByRole("button", { name: /^Add a launch\.json/ }).click();
  check("launchAdded", await ok(a.getByRole("tab", { name: /launch\.json/ }).waitFor({ timeout: 10_000 })));
  launchMade = true;
  check("starterWritten", await ok(a.locator(".monaco-editor .view-lines", { hasText: "Python: current file" }).first().waitFor({ timeout: 10_000 })));
  // With launch.json itself open, the starter's ${file} configurations don't apply, and the view says so.
  check("starterExplained", await ok(view.getByText(/isn't a Python file/).waitFor({ timeout: 10_000 })));

  // Our own configurations, in place of the starter's.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  // Typing over a selection would wrap it in the first bracket typed: clear it first.
  await a.keyboard.press("Delete");
  await a.keyboard.insertText(config);
  check("skippedExplained", await ok(view.locator("p", { hasText: "Old binary" }).filter({ hasText: /set program to the \.c or \.cpp file/ }).waitFor({ timeout: 10_000 })));

  await view.getByRole("combobox", { name: "Configuration" }).click();
  await a.getByRole("option", { name: "Greet" }).click();
  await view.getByRole("button", { name: "Debug: Greet" }).click();
  const log = a.locator('[role="log"][aria-label="Debug console"]');
  const printed = "argv ['one', 'two words'] hi";
  check("configRan", await ok(log.filter({ hasText: printed }).waitFor({ timeout: 45_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "launch.png") });

  // F5 runs the picked configuration too.
  await view.getByRole("button", { name: "Debug: Greet" }).waitFor({ timeout: 20_000 });
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("F5");
  check("f5RunsIt", await ok(view.getByRole("status").filter({ hasText: /^Greet:/ }).waitFor({ timeout: 20_000 }).then(() => log.filter({ hasText: printed }).waitFor({ timeout: 45_000 }))));
} catch (error) {
  const shot = join(tmpdir(), "launch-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  // A dropdown left open (a failure mid-pick) would cover the file list.
  await a.keyboard.press("Escape").catch(() => {});
  await panels.getByRole("button", { name: "Files", exact: true }).click().catch(() => {});
  for (const [made, name] of [
    [created, new RegExp(`^${escape(file)}`)],
    [launchMade, /^\.vscode/],
  ]) {
    if (!made) continue;
    try {
      const row = tree.getByRole("treeitem", { name }).first();
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
      check(`deleted ${String(name)}`, true);
    } catch (error) {
      check(`deleted ${String(name)}`, false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
