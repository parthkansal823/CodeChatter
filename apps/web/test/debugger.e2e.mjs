// The multiplayer debugger (roadmap §14 A), two people in E2ETST: Ana (test1) puts a breakpoint on a line with F9
// and Ben (test2) sees it in his editor; Ana debugs the file from Run and debug; both see it paused there (the line
// marked, "x = 1" in Variables, who started it); a watch expression, a step (F10), the Debug console, then F5 runs
// it to the end and the output and the end reach both. The test's file is deleted.
//   node test/debugger.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch, ROOM } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stamp = Date.now().toString(36);
const file = `dbg_${stamp}.py`;
const source = ["x = 1", "y = x + 1", 'print("y is", y)', "z = y * 10", 'print("z is", z)', ""].join("\n");

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const { page: b } = await signIn("test2@codechatter.local");
let created = false;
const tab = (page) => page.getByRole("tab", { name: new RegExp(escape(file)) });
const debugButton = (page) => page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Run and debug" });

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await tab(a).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(source);
  // A breakpoint on line 2, with F9.
  await a.keyboard.press("Control+Home");
  await a.keyboard.press("ArrowDown");
  await a.keyboard.press("F9");
  check("breakpointShown", await ok(a.locator(".monaco-editor .cc-breakpoint").first().waitFor({ timeout: 5_000 })));

  // Ben opens the same file: the breakpoint is there for him too.
  await b.goto(`${BASE}/rooms/${ROOM}`);
  const benTree = b.getByRole("tree", { name: "Files" });
  await benTree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) }).click();
  check("breakpointShared", await ok(b.locator(".monaco-editor .cc-breakpoint").first().waitFor({ timeout: 10_000 })));

  // Ana debugs it.
  await debugButton(a).click();
  const anaView = a.getByRole("region", { name: "Run and debug" });
  await anaView.getByRole("button", { name: `Debug ${file}` }).click();
  check("paused", await ok(anaView.getByRole("status").filter({ hasText: "paused (breakpoint)" }).waitFor({ timeout: 45_000 })));
  const variablesShown = await ok(anaView.getByRole("tree", { name: "Variables" }).getByRole("treeitem", { name: "x = 1" }).first().waitFor({ timeout: 10_000 }));
  check("variables", variablesShown, variablesShown ? "" : await anaView.innerText());
  check("lineMarked", await ok(a.locator(".monaco-editor .cc-debug-line").first().waitFor({ timeout: 5_000 })));
  check("callStack", await ok(anaView.getByRole("list", { name: "Call stack" }).getByText("<module>").waitFor({ timeout: 5_000 })));
  check("consoleOpened", await ok(a.getByRole("log", { name: "Debug console" }).waitFor({ timeout: 5_000 })));

  // Ben follows along.
  await debugButton(b).click();
  const benView = b.getByRole("region", { name: "Run and debug" });
  check("benSeesWho", await ok(benView.getByRole("status").filter({ hasText: "started by test1" }).filter({ hasText: "paused" }).waitFor({ timeout: 10_000 })));
  check("benSeesVariables", await ok(benView.getByRole("tree", { name: "Variables" }).getByRole("treeitem", { name: "x = 1" }).first().waitFor({ timeout: 10_000 })));
  check("benSeesLine", await ok(b.locator(".monaco-editor .cc-debug-line").first().waitFor({ timeout: 10_000 })));

  // A watch, a step, and the console.
  await anaView.getByLabel("Add a watch expression").fill("x * 100");
  await anaView.getByLabel("Add a watch expression").press("Enter");
  check("watch", await ok(anaView.getByRole("list", { name: "Watch expressions" }).getByText("100").waitFor({ timeout: 10_000 })));
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("F10");
  check("stepped", await ok(anaView.getByRole("status").filter({ hasText: "paused (step)" }).waitFor({ timeout: 10_000 })));
  check("steppedVariables", await ok(anaView.getByRole("tree", { name: "Variables" }).getByRole("treeitem", { name: "y = 2" }).first().waitFor({ timeout: 10_000 })));
  await a.getByLabel("Evaluate in the debugger").fill("y + 40");
  await a.getByLabel("Evaluate in the debugger").press("Enter");
  check("console", await ok(a.getByRole("log", { name: "Debug console" }).getByText("42", { exact: true }).waitFor({ timeout: 10_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "debugger.png") });

  // F5 runs it to the end; both see the output and the end.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("F5");
  check("ended", await ok(anaView.getByRole("button", { name: `Debug ${file}` }).waitFor({ timeout: 20_000 })));
  const output = await a.getByRole("log", { name: "Debug console" }).innerText();
  check("output", output.includes("y is 2") && output.includes("z is 20"), output.slice(-200));
  check("benSeesEnd", await ok(benView.getByText(/^Nobody is debugging/).or(benView.getByRole("button", { name: /^Debug / })).first().waitFor({ timeout: 10_000 })));
  // Ben's console has it too, though his panel shows another tab (so it's read as text, not as seen).
  const benOutput = (await b.locator('[role="log"][aria-label="Debug console"]').textContent({ timeout: 5_000 }).catch(() => "")) ?? "";
  check("benSawOutput", benOutput.includes("z is 20"), benOutput.slice(-120));
} catch (error) {
  const shot = join(tmpdir(), "debugger-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      const view = a.getByRole("region", { name: "Run and debug" });
      if (await view.getByRole("button", { name: "Remove all" }).count()) await view.getByRole("button", { name: "Remove all" }).click();
      await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
      const row = a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) });
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
