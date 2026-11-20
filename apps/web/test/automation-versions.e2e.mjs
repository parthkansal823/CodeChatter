// A flow's Versions (n8n's workflow history), in a browser in E2ETST: an example flow, a named checkpoint in History, a step turned off and one
// removed, then Versions comparing that checkpoint with now (in words and on its chart as it was), and Restore putting the step back after a
// "Before restoring" checkpoint, after which it's the same as now. It removes the flow and its named checkpoint.
//   node test/automation-versions.e2e.mjs        (from apps/web, with the dev stack running)
import { readdirSync, readFileSync } from "node:fs";

import { check, finish, fromMore, launch, openApp, sleep } from "./browser.mjs";

// The same installed axe as a11y.e2e.mjs.
const STORE = new URL("../../../node_modules/.pnpm/", import.meta.url);
const AXE = readFileSync(new URL(`${readdirSync(STORE).find((each) => each.startsWith("axe-core@"))}/node_modules/axe-core/axe.min.js`, STORE), "utf8");
const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const { browser, signIn, errors } = await launch();
const { page } = await signIn("test1@codechatter.local", { width: 1440, height: 900 });
const tool = page.getByRole("region", { name: "Automations", exact: true });
const chart = tool.getByRole("group", { name: "The steps of this automation" });
const files = page.getByRole("tree", { name: "Files", exact: true });
const panels = page.getByRole("navigation", { name: "Panels" });
const history = page.getByRole("region", { name: "History" });
const versions = tool.getByRole("region", { name: "Versions" });
const ok = (promise) => promise.then(() => true, () => false);
const name = `Versions test ${Date.now().toString(36)}`;
async function audit(label) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.evaluate(AXE);
  const found = await page.evaluate(async (tags) => {
    const result = await window.axe.run({ include: [['[aria-label="Versions"]']] }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return result.violations.map((rule) => `${rule.id}×${rule.nodes.length}`);
  }, A11Y_TAGS);
  check(label, found.length === 0, found.join(", "));
}
let made = null;
let saved = false;

try {
  await openApp(page, "Automations");
  await tool.getByRole("button", { name: /^(See the examples|Examples)$/ }).first().waitFor({ timeout: 60_000 });
  await tool.getByRole("button", { name: /^(See the examples|Examples)$/ }).first().click();
  await tool.getByLabel("Search the examples").fill("second review");
  await tool.getByRole("button", { name: "Use Send big changes for a second review" }).click();
  await chart.getByRole("button", { name: /^Step Measure it,/ }).waitFor({ timeout: 15_000 });
  made = (await tool.getByLabel("Automation to show").inputValue()).split("/").at(-1);
  await sleep(1500);

  // ---- A checkpoint with the flow as it is, then two changes ----
  await panels.getByRole("button", { name: "History" }).click();
  await history.getByRole("button", { name: "Save a checkpoint" }).click();
  await history.getByLabel("New checkpoint's name").fill(name);
  await history.getByRole("button", { name: "Save checkpoint" }).click();
  saved = await ok(history.getByRole("group", { name: "Selected checkpoint" }).getByText(name, { exact: true }).waitFor({ timeout: 15_000 }));
  check("aCheckpointWithTheFlow", saved);
  await panels.getByRole("button", { name: "Files", exact: true }).click();
  const measure = chart.getByRole("button", { name: /^Step Measure it,/ });
  await measure.focus();
  await measure.press("d");
  const second = chart.getByRole("button", { name: /^Step Ask for a second/ });
  await second.focus();
  await second.press("Delete");
  await second.waitFor({ state: "detached", timeout: 5000 });
  await sleep(800);

  // ---- Versions: that checkpoint against now ----
  await tool.getByRole("button", { name: "Versions", exact: true }).click();
  await versions.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  const summary = versions.getByRole("status").filter({ hasText: /^Since then:/ });
  check("versionsSayWhatsChangedSince", (await ok(summary.waitFor({ timeout: 15_000 }))) && (await summary.innerText()) === "Since then: 1 step changed, 1 step removed.", await summary.innerText().catch(() => ""));
  const list = versions.getByRole("list", { name: "What's changed since" });
  check("stepByStep", /Changed since: Measure it \(turned off\)/.test(await list.innerText()) && /Gone since: Ask for a second review/.test(await list.innerText()), await list.innerText());
  const then = versions.getByRole("group", { name: "The steps as they were" });
  await audit("versionsHaveNoAccessibilityProblemsInLight");
  await fromMore(page, "Dark theme");
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await sleep(300);
  await audit("orInDark");
  await fromMore(page, "Light theme");
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  check("andOnTheChartAsItWas", (await then.getByRole("button", { name: /^Step Ask for a second review.*Gone since/ }).count()) === 1 && (await then.getByRole("button", { name: /^Step Measure it.*Changed since: turned off/ }).count()) === 1);

  // ---- Restore ----
  await versions.getByRole("button", { name: "Restore this version" }).click();
  check("restoringPutsItBack", await ok(chart.getByRole("button", { name: /^Step Ask for a second/ }).waitFor({ timeout: 15_000 })));
  check("andTurnsTheStepOnAgain", !/turned off/.test((await chart.getByRole("button", { name: /^Step Measure it,/ }).getAttribute("aria-label")) ?? ""), await chart.getByRole("button", { name: /^Step Measure it,/ }).getAttribute("aria-label"));
  await tool.getByRole("button", { name: "Versions", exact: true }).click();
  check("afterSavingTheRoomAsItWas", await ok(versions.getByRole("button", { name: /^Before restoring Send big changes/ }).first().waitFor({ timeout: 15_000 })));
  await versions.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  check("soNowItsTheSame", await ok(versions.getByRole("status").filter({ hasText: "It's the same as now." }).waitFor({ timeout: 15_000 })));
  check("andThereIsNothingToRestore", (await versions.getByRole("button", { name: "Restore this version" }).count()) === 0);
  await tool.getByRole("button", { name: "Versions", exact: true }).click();

} catch (error) {
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  if (await page.evaluate(() => document.documentElement.classList.contains("dark")).catch(() => false)) await fromMore(page, "Light theme").catch(() => {});
  if (saved) {
    await panels.getByRole("button", { name: "History" }).click().catch(() => {});
    const named = history.getByRole("list", { name: "Checkpoints" }).getByRole("button", { name: new RegExp(`^${name}`) });
    if ((await named.count().catch(() => 0)) > 0) {
      if ((await named.getAttribute("aria-pressed").catch(() => null)) !== "true") await named.click().catch(() => {});
      await history.getByRole("button", { name: "Delete the checkpoint" }).click().catch(() => {});
      await named.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
    }
    check("itsCheckpointIsRemoved", (await named.count().catch(() => 1)) === 0);
    await panels.getByRole("button", { name: "Files", exact: true }).click().catch(() => {});
  }
  if (made) {
    await tool.getByRole("button", { name: "Insights" }).click().catch(() => {});
    const item = files.getByRole("treeitem", { name: made, exact: true });
    if (!(await item.isVisible().catch(() => false))) await files.getByRole("treeitem", { name: "automations", exact: true }).click().catch(() => {});
    await item.click().catch(() => {});
    await item.press("Delete").catch(() => {});
    await sleep(800);
    check("itsFlowIsRemoved", (await item.count()) === 0);
  }
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
  finish();
}
