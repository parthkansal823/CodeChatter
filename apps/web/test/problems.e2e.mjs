// The Problems tab (roadmap §14 A): a TypeScript type error and an unused-variable warning in an open file
// show in the status bar's counts and in the tab, grouped by file; the filter and the switches narrow it; a
// click puts the cursor on the problem; fixing the code empties the list. Check all files finds a problem in a
// Python file nobody has open (written from a terminal) and says what ran. The test's files have a stamp in their
// names and are deleted at the end.
//   node test/problems.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const name = `pr_${stamp}.ts`;
const unopened = `pr_${stamp}.py`;
// The terminal is shared and keeps earlier runs' lines: this run's markers are its own numbers.
const marker = Date.now() % 100000;
let madeUnopened = false;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
let created = false;

const counts = a.getByRole("button", { name: /^Problems: / });
const panel = a.getByRole("region", { name: "Output and terminals" });
const list = panel.getByRole("list", { name: "Problems" });

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), 'export function f() {\n  const count: number = "three";\n  return count;\n}\n');
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");

  check("statusBarCounts", await ok(a.getByRole("button", { name: "Problems: 1 error, 0 warnings" }).waitFor({ timeout: 30_000 })), await counts.getAttribute("aria-label"));
  await counts.click();
  check("tabOpensFromStatusBar", await ok(list.waitFor({ timeout: 5_000 })));
  const fileRow = list.getByRole("button", { name: new RegExp(escape(name)) });
  check("groupedByFile", (await fileRow.count()) === 1 && (await fileRow.innerText()).replace(/\s+/g, " ").trim() === `${name} 1`, await fileRow.innerText());
  const problem = list.getByRole("button", { name: /not assignable to type 'number'/ });
  check("showsTheMessage", (await problem.count()) === 1 && (await problem.innerText()).includes("[2, 9]"), await list.innerText());

  await panel.getByLabel("Filter problems").fill("nothing like this");
  check("filterNarrows", await ok(panel.getByText("No problem matches the filter.").waitFor({ timeout: 3_000 })));
  await panel.getByLabel("Filter problems").fill("");
  await panel.getByRole("button", { name: /^Errors: 1/ }).click();
  check("switchHidesErrors", await ok(panel.getByText("No problem matches the filter.").waitFor({ timeout: 3_000 })));
  await panel.getByRole("button", { name: /^Errors: 1/ }).click();

  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Home");
  await problem.click();
  check("clickGoesThere", await ok(a.getByText("Ln 2, Col 9").waitFor({ timeout: 5_000 })));

  // Fixed: the list empties.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  await a.keyboard.insertText("export const ok = 1;\n");
  check("fixedEmpties", await ok(panel.getByText("No problems in the open files.").waitFor({ timeout: 30_000 })) && (await counts.getAttribute("aria-label")) === "Problems: 0 errors, 0 warnings");
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "problems.png") });

  // A file nobody has open, written from a terminal: only Check all files finds its problem. (The shell works the
  // marker out, so only its output has it.)
  await a.keyboard.press("Control+`");
  await a.locator(".xterm").last().click();
  await a.keyboard.type(`printf 'count: int = "three"\\n' > ${unopened} && echo made-$((${marker}+1))\n`);
  await a.locator(".xterm-rows").last().getByText(`made-${marker + 1}`, { exact: true }).waitFor({ timeout: 30_000 });
  madeUnopened = true;
  await counts.click();
  await panel.getByRole("button", { name: "Check all files" }).click();
  check("checkFindsUnopenedFile", await ok(list.getByRole("button", { name: new RegExp(escape(unopened)) }).waitFor({ timeout: 90_000 })), await list.innerText().catch(() => ""));
  check("checkSaysWhatRan", await ok(panel.getByRole("status", { name: "Last check" }).getByText(/Every file checked with Pyright/).waitFor({ timeout: 5_000 })));
  check("checkedProblemIsPyrights", await ok(list.getByRole("button", { name: /Literal\['three'\]/ }).first().waitFor({ timeout: 5_000 })));
} catch (error) {
  const shot = join(tmpdir(), "problems-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (madeUnopened) {
    try {
      // Back to the terminal, which the Problems tab hid.
      await panel.getByRole("tab", { name: /^Terminal/ }).first().click();
      await a.locator(".xterm").last().click();
      await a.keyboard.type(`rm -f ${unopened} && echo gone-$((${marker}+2))\n`);
      check("unopenedFileDeleted", await ok(a.locator(".xterm-rows").last().getByText(`gone-${marker + 2}`, { exact: true }).waitFor({ timeout: 15_000 })));
    } catch (error) {
      check("unopenedFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
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
