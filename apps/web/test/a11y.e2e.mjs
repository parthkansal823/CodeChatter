// Accessibility: axe's WCAG 2.2 AA rules on every kind of page, in light and dark, on a desktop and a phone. Monaco, xterm and
// draw.io are other people's, with their own accessibility work, so what's inside them is left out; everything around them isn't.
//   node test/a11y.e2e.mjs                 (from apps/web, with the dev stack running)
//   A11Y_OUT=path.json keeps every finding in full.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

// axe-core comes with eslint-plugin-jsx-a11y: read from where pnpm keeps it, rather than adding a package for a test.
const STORE = new URL("../../../node_modules/.pnpm/", import.meta.url);
const AXE = readFileSync(new URL(`${readdirSync(STORE).find((name) => name.startsWith("axe-core@"))}/node_modules/axe-core/axe.min.js`, STORE), "utf8");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEIRS = [".monaco-editor", ".xterm", "iframe", "nextjs-portal"];
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const report = [];

async function audit(page, name) {
  await page.evaluate(AXE);
  const found = await page.evaluate(
    async ({ tags, theirs }) => {
      const present = theirs.filter((selector) => document.querySelector(selector));
      const result = await window.axe.run({ include: [document], exclude: present.map((selector) => [selector]) }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      return result.violations.map((rule) => ({
        id: rule.id,
        impact: rule.impact,
        help: rule.help,
        nodes: rule.nodes.map((node) => ({ target: node.target.join(" "), html: node.html.slice(0, 220), why: (node.failureSummary ?? "").split("\n").slice(1, 3).join(" ").trim().slice(0, 260) })),
      }));
    },
    { tags: TAGS, theirs: THEIRS },
  );
  report.push({ name, violations: found });
  check(name, found.length === 0, found.map((rule) => `${rule.id}×${rule.nodes.length}`).join(", "));
}

// Down the page and back, so what fades in as it's scrolled to has finished: halfway through a fade, text is paler than it ends up.
async function settle(page) {
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await sleep(1500);
}

async function visit(page, path, name) {
  try {
    await page.goto(`${BASE}${path}`);
    await settle(page);
    await audit(page, name);
  } catch (error) {
    check(name, false, `couldn't open: ${String(error).slice(0, 160)}`);
  }
}

async function step(page, name, act) {
  try {
    await act();
    await sleep(900);
    await audit(page, name);
  } catch (error) {
    check(name, false, `couldn't open: ${String(error).slice(0, 160)}`);
  }
}

const { browser, signIn } = await launch();
const themed = (context, theme) => context.addInitScript((value) => localStorage.setItem("theme", value), theme);
const PUBLIC = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password?token=none", "/verify-email", "/two-factor", "/invite/none", "/interview/none"];
const SIGNED_IN = ["/dashboard", "/explore", "/new", "/interviews", "/interviews?tab=assessments", "/interviews/new", "/interviews/questions/new", "/orgs/new", "/settings", "/settings/account", "/settings/members", "/settings/audit", "/settings/webhooks"];

try {
  for (const theme of ["light", "dark"]) {
    const outside = await browser.newContext({ viewport: DESKTOP, colorScheme: theme });
    await themed(outside, theme);
    const out = await outside.newPage();
    for (const path of PUBLIC) await visit(out, path, `${theme} ${path}`);
    await outside.close();

    const { context, page } = await signIn("test1@codechatter.local", DESKTOP);
    await themed(context, theme);
    for (const path of SIGNED_IN) await visit(page, path, `${theme} ${path}`);
    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    await step(page, `${theme} /dashboard, Join`, () => page.getByRole("button", { name: "Join", exact: true }).click());
    await page.keyboard.press("Escape");

    // The room: the parts people live in.
    await page.goto(`${BASE}/rooms/${ROOM}`);
    await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
    await settle(page);
    await audit(page, `${theme} room`);
    if (theme === "light") {
      // What axe can't check: open files can be reached and closed from the keyboard.
      const files = page.getByRole("tree", { name: "Files" }).locator('[role="treeitem"]:not([aria-expanded])');
      await files.nth(0).click();
      await files.nth(1).click();
      const openFiles = page.getByRole("tablist", { name: "Open files" }).getByRole("tab");
      const before = await openFiles.count();
      const selected = () => page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { selected: true }).getAttribute("title");
      const from = await selected();
      await page.getByRole("tablist", { name: "Open files" }).getByRole("tab", { selected: true }).focus();
      await page.keyboard.press("ArrowLeft");
      await sleep(300);
      check("arrowKeysMoveBetweenOpenFiles", (await selected()) !== from, from);
      check("focusMovesWithThem", await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement?.getAttribute("aria-selected") === "true"));
      await page.keyboard.press("Delete");
      await sleep(300);
      check("deleteClosesAnOpenFile", (await openFiles.count()) === before - 1, `${before} then ${await openFiles.count()}`);
    }
    await step(page, `${theme} room, Share`, () => page.getByRole("button", { name: "Share" }).click());
    await page.keyboard.press("Escape");
    const sidePanel = page.getByRole("tablist", { name: "Side panel" });
    if (!(await sidePanel.isVisible().catch(() => false))) await page.getByRole("button", { name: /side panel|chat/i }).first().click().catch(() => {});
    for (const tab of await sidePanel.getByRole("tab").allInnerTexts()) {
      const label = tab.trim().replace(/\d+$/, "").trim();
      await step(page, `${theme} room, ${label} panel`, () => sidePanel.getByRole("tab", { name: new RegExp(`^${label}`) }).click());
    }
    const panelTabs = page.getByRole("tablist", { name: "Panel" });
    const openPanel = page.getByRole("button", { name: "Output and terminals", exact: true });
    // Not a click: in development, Next's own badge sits on top of this button.
    if (await openPanel.count()) await openPanel.dispatchEvent("click");
    await page.getByRole("button", { name: "Hide output and terminals" }).waitFor({ timeout: 10_000 });
    for (const tab of ["Output", "Problems", "Tests", "Ports"]) {
      await step(page, `${theme} room, ${tab} tab`, () => panelTabs.getByRole("tab", { name: new RegExp(`^${tab}`) }).click());
    }
    await step(page, `${theme} room, a terminal`, () => page.getByRole("button", { name: "New terminal" }).click());
    for (const app of ["Docs", "API", "Analysis", "Prompts", "MCP", "Databases", "Lakehouse", "Flow", "Design", "Whiteboard", "Diagrams"]) {
      await step(page, `${theme} room, ${app}`, () => page.getByRole("group", { name: "Apps" }).getByRole("button", { name: app, exact: true }).click());
    }
    // A prompt with its answers: the tool's empty screen says little. The model is stood in for, and the prompt is deleted.
    await page.route("**/api/rooms/*/ai/prompt", (route) => {
      const events = [{ type: "delta", text: "An answer." }, { type: "done", stop: "end", usage: { inputTokens: 5, outputTokens: 5, estimated: true }, timing: { firstMs: 200, totalMs: 900 } }];
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    });
    await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Prompts", exact: true }).click();
    const prompts = page.getByRole("region", { name: "Prompts" });
    await prompts.getByRole("button", { name: "New prompt" }).first().click();
    await prompts.getByRole("button", { name: "Run", exact: true }).click();
    await step(page, `${theme} room, a prompt and its answers`, () => prompts.getByRole("region", { name: "Runs" }).waitFor({ timeout: 15_000 }));
    // Its evals, with a result open. promptfoo is stood in for too.
    await page.route("**/api/rooms/*/evals", (route) => {
      const body = route.request().postDataJSON();
      const cell = { caseId: body.cases[0].id, columnId: body.columns[0].id, pass: false, error: null, output: "An answer.", failed: [{ type: "contains", value: "Paris", reason: "Expected output to contain Paris" }], latencyMs: 900, inputTokens: 5, outputTokens: 5 };
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${JSON.stringify({ type: "done", report: { cells: [cell], passed: 0, failed: 1, errors: 0, inputTokens: 5, outputTokens: 5, ms: 900 } })}\n` });
    });
    await prompts.getByRole("button", { name: "Test it" }).click();
    await prompts.getByRole("button", { name: "Add a test case" }).click();
    await prompts.getByLabel("What check 1 in Case 1 looks for").fill("Paris");
    await prompts.getByRole("button", { name: "Run evals" }).click();
    await prompts.getByRole("region", { name: "Results" }).getByRole("button", { name: "Fail", exact: true }).click();
    await step(page, `${theme} room, a prompt's evals and a result`, () => prompts.getByRole("region", { name: "This result" }).waitFor({ timeout: 15_000 }));
    await prompts.getByRole("button", { name: "Delete this prompt" }).click();
    await prompts.getByRole("button", { name: "Delete", exact: true }).click();
    // The room's AI calls, with one open. The list is stood in for.
    const call = (over) => ({ id: "a", at: "2026-11-07T10:00:00.000Z", source: "chat", mode: "tutor", by: "Test", mine: true, model: "m", status: "ok", error: null, inputTokens: 5, outputTokens: 5, estimated: true, firstMs: 100, totalMs: 900, input: [{ role: "user", content: "Hi" }], output: "Hello", hidden: false, ...over });
    await page.route("**/api/rooms/*/ai/traces", (route) => route.fulfill({ json: [call({}), call({ id: "b", status: "error", error: "It broke." })] }));
    await prompts.getByRole("button", { name: "AI calls" }).click();
    await prompts.getByRole("group", { name: "The calls" }).getByRole("row").nth(1).getByRole("button").click();
    await step(page, `${theme} room, the AI calls and one open`, () => prompts.getByRole("region", { name: "This call" }).waitFor({ timeout: 15_000 }));
    // Ask the codebase, with what it read showing. The search and the model are stood in for.
    await page.route("**/api/rooms/*/ai/retrieve", (route) => route.fulfill({ json: { passages: [{ path: "README.md", start: 1, end: 2, name: "", text: "# Hello", score: 0.03, found: "both" }], index: { files: 1, chunks: 1, changed: 0, embedded: 0, waiting: 0, ms: 1, model: null }, note: "Searched by words only: this server has no embedding model." } }));
    await page.route("**/api/rooms/*/ai/chat", (route) => {
      const events = [{ type: "delta", text: "See `README.md:1` and `README.md:50`." }, { type: "done", stop: "end", usage: { inputTokens: 5, outputTokens: 5, estimated: false } }];
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
    });
    await sidePanel.getByRole("tab", { name: /^AI/ }).click();
    await page.getByRole("combobox", { name: "AI mode" }).click();
    await page.getByRole("option", { name: "Ask the codebase" }).click();
    const question = page.getByPlaceholder("Where do we handle failed logins?");
    await question.fill("Where is it?");
    await question.press("Enter");
    await page.getByText(/What it read/).waitFor({ timeout: 15_000 });
    await step(page, `${theme} room, what the AI read`, () => page.getByText(/What it read/).click());
    await page.getByRole("button", { name: "New conversation" }).click();
    // The Lakehouse tool with a table and its versions, and runs. What it reads is stood in for.
    await page.route("**/api/rooms/*/lakehouse", (route) => {
      const { op } = route.request().postDataJSON();
      const answers = {
        overview: { tables: [{ name: "gold", version: 1, versions: 2, rows: 2, columns: [{ name: "city", type: "VARCHAR" }, { name: "total", type: "DOUBLE" }], bytes: 4096, at: 1794037625000, problem: null }] },
        history: { commits: [{ version: 1, at: 1794037625000, operation: "UPDATE", rowsWritten: null, rowsChanged: 1, engine: "Spark" }, { version: 0, at: 1794037600000, operation: "WRITE", rowsWritten: 2, rowsChanged: null, engine: "Spark" }] },
        preview: { table: "gold", version: null, columns: ["city", "total"], rows: [["Pune", "10"], ["Agra", null]], truncated: false },
        runs: { runs: [{ id: "r", name: "first", experiment: "e", status: "FINISHED", at: 1794037625000, ms: 10, params: { alpha: "0.5" }, metrics: { rmse: 0.1 } }] },
      };
      return route.fulfill({ json: answers[op] });
    });
    await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Lakehouse", exact: true }).click();
    const lakehouse = page.getByRole("region", { name: "Lakehouse" });
    await step(page, `${theme} room, a lakehouse table and its versions`, () => lakehouse.getByRole("group", { name: "Versions of gold" }).waitFor({ timeout: 15_000 }));
    await lakehouse.getByRole("button", { name: "Experiments" }).click();
    await step(page, `${theme} room, a lakehouse's runs`, () => lakehouse.getByRole("group", { name: "MLflow runs" }).waitFor({ timeout: 15_000 }));
    // The Flow tool: its chart with each kind of result, a dataset's rows, profile and checks, a recipe, a new recipe and a failed build. What dbt says is stood in for.
    const ran = (status, failures = null, message = null) => ({ status, at: 1794037625000, ms: 12, failures, message });
    const flowDataset = (name, over) => ({ id: `model.p.${name}`, kind: "model", name, language: "sql", file: `flow/models/${name}.sql`, description: "", materialized: "table", dependsOn: [], result: ran("success"), changed: false, ...over });
    const flowLive = { state: "failed", id: "20261107-1", by: "Test One", startedAt: 1794037625000, finishedAt: 1794037630000, nodes: {}, counts: { done: 3, warned: 1, failed: 1, skipped: 1 }, message: "It stopped.", log: ["1 of 2 OK", "2 of 2 ERROR"] };
    await page.route("**/api/rooms/*/flow", (route) => {
      const { op } = route.request().postDataJSON();
      const answers = {
        graph: {
          project: { path: "flow", name: "orders", others: 1 },
          problem: "Parsing Error in schema.yml",
          live: flowLive,
          datasets: [
            flowDataset("raw", { id: "seed.p.raw", kind: "seed", language: null, file: "flow/seeds/raw.csv", materialized: "seed" }),
            flowDataset("clean", { dependsOn: ["seed.p.raw"], description: "One row for each order." }),
            flowDataset("totals", { dependsOn: ["model.p.clean"], language: "python", result: ran("error", null, "It went wrong.") }),
            flowDataset("after", { dependsOn: ["model.p.totals"], result: ran("skipped") }),
            flowDataset("unbuilt", { dependsOn: ["model.p.clean"], result: null }),
            flowDataset("shop.orders", { id: "source.p.shop.orders", kind: "source", language: null, materialized: null, result: null }),
          ],
          checks: [
            { id: "test.p.a", name: "a", rule: "not_null", column: "amount", values: null, severity: "warn", of: "model.p.clean", file: "flow/models/schema.yml", result: ran("warn", 1) },
            { id: "test.p.b", name: "clean__city__unique", rule: null, column: null, values: null, severity: "error", of: "model.p.clean", file: "flow/tests/clean__city__unique.sql", result: ran("pass", 0) },
            { id: "test.p.c", name: "never_run", rule: null, column: null, values: null, severity: "error", of: "model.p.clean", file: "flow/tests/never_run.sql", result: null },
          ],
        },
        status: flowLive,
        runs: { runs: [{ ...flowLive, log: undefined }] },
        run: flowLive,
        preview: { name: "clean", columns: ["city", "amount"], types: ["VARCHAR", "DOUBLE"], rows: [["Pune", "10"], ["Agra", null]], truncated: false, built: true },
        failures: { name: "test.p.a", columns: ["city", "amount"], types: ["VARCHAR", "DOUBLE"], rows: [["Agra", null]], truncated: false, built: true },
        profile: { name: "clean", built: true, rows: 2, columns: [{ name: "city", type: "VARCHAR", nulls: 0, distinct: 2, min: "Agra", max: "Pune", mean: null, std: null, q25: null, q50: null, q75: null, top: [{ value: "Pune", count: 1 }] }, { name: "amount", type: "DOUBLE", nulls: 50, distinct: 1, min: "10", max: "10", mean: "10", std: null, q25: "10", q50: "10", q75: "10", top: [] }] },
      };
      return route.fulfill({ json: answers[op] });
    });
    await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Flow", exact: true }).click();
    const flow = page.getByRole("region", { name: "Flow" });
    const flowDetails = flow.getByRole("complementary", { name: "Details" });
    await step(page, `${theme} room, the Flow chart and a failed build`, () => flow.getByRole("button", { name: /^Dataset clean,/ }).waitFor({ timeout: 20_000 }));
    await flow.getByRole("button", { name: /^Dataset clean,/ }).click();
    await step(page, `${theme} room, a dataset's rows`, () => flowDetails.getByRole("group", { name: "Rows of clean" }).waitFor({ timeout: 15_000 }));
    await flowDetails.getByRole("button", { name: "Profile" }).click();
    await step(page, `${theme} room, a dataset's profile`, () => flowDetails.getByRole("region", { name: "Its profile" }).waitFor({ timeout: 15_000 }));
    await flowDetails.getByRole("button", { name: /^Checks/ }).click();
    await flowDetails.getByRole("button", { name: /^The rows that broke/ }).click();
    await step(page, `${theme} room, a dataset's checks and the rows that broke one`, () => flowDetails.getByRole("group", { name: /^Rows of amount/ }).waitFor({ timeout: 15_000 }));
    await flowDetails.getByRole("button", { name: "Add a check" }).click();
    await step(page, `${theme} room, adding a check`, () => flowDetails.getByRole("form", { name: "Add a check" }).waitFor({ timeout: 5000 }));
    await flowDetails.getByRole("button", { name: "Cancel" }).click();
    await flow.getByRole("button", { name: /^Python recipe that makes totals/ }).click();
    await step(page, `${theme} room, a recipe that failed`, () => flowDetails.getByRole("region", { name: "The recipe for totals" }).waitFor({ timeout: 5000 }));
    await flow.getByRole("button", { name: /^Dataset clean,/ }).click();
    await flowDetails.getByRole("button", { name: "New recipe from this" }).click();
    await step(page, `${theme} room, a new recipe`, () => flowDetails.getByRole("form", { name: "New recipe" }).getByLabel("Column", { exact: true }).waitFor({ timeout: 15_000 }));
    await flowDetails.getByRole("form", { name: "New recipe" }).getByLabel("What it does").selectOption("automl");
    await step(page, `${theme} room, an AutoML recipe`, () => flowDetails.getByRole("form", { name: "New recipe" }).getByLabel("Column to predict").waitFor({ timeout: 5000 }));
    await page.unroute("**/api/rooms/*/flow");
    // The numbers under an Explain this data answer, from a conversation already in this browser.
    const numbers = { engine: "DuckDB 1.5.6", rows: 3, duplicates: 1, columns: [{ name: "age", type: "BIGINT", nullPercent: 0, unique: 3, min: "1", max: "9", mean: "4", std: "2", q25: "2", q50: "3", q75: "6", outliers: 0, top: [] }], correlations: [{ a: "age", b: "pay", r: 0.9 }] };
    await page.evaluate(([room, summary]) => sessionStorage.setItem(`cc-ai:${room}`, JSON.stringify({ mode: "data", entries: [{ id: "q", role: "user", content: "Explain this data.", mode: "data" }, { id: "a", role: "assistant", content: "An answer.", mode: "data", status: "done", numbers: summary }] })), [ROOM, numbers]);
    await page.reload();
    await settle(page);
    if (!(await sidePanel.isVisible().catch(() => false))) await page.getByRole("button", { name: "AI", exact: true }).click();
    await sidePanel.getByRole("tab", { name: /^AI/ }).click();
    await step(page, `${theme} room, the numbers an answer was given`, () => page.getByText(/The numbers it was given/).click());
    await context.close();
  }

  // Phones: where layouts hide things, in one theme.
  const outside = await browser.newContext({ viewport: PHONE, colorScheme: "light" });
  await themed(outside, "light");
  const out = await outside.newPage();
  for (const path of ["/", "/sign-in", "/sign-up"]) await visit(out, path, `phone ${path}`);
  await outside.close();
  const { context, page } = await signIn("test1@codechatter.local", PHONE);
  await themed(context, "light");
  for (const path of ["/dashboard", "/interviews", "/settings", "/settings/account", "/settings/members"]) await visit(page, path, `phone ${path}`);
  await page.goto(`${BASE}/rooms/${ROOM}`);
  await settle(page);
  await sleep(2000);
  await audit(page, "phone room");
  await context.close();
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 300));
} finally {
  if (process.env.A11Y_OUT) writeFileSync(process.env.A11Y_OUT, JSON.stringify(report, null, 1));
  await browser.close();
}
finish();
