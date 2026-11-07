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
    if (await openPanel.count()) await openPanel.click();
    await page.getByRole("button", { name: "Hide output and terminals" }).waitFor({ timeout: 10_000 });
    for (const tab of ["Output", "Problems", "Tests", "Ports"]) {
      await step(page, `${theme} room, ${tab} tab`, () => panelTabs.getByRole("tab", { name: new RegExp(`^${tab}`) }).click());
    }
    await step(page, `${theme} room, a terminal`, () => page.getByRole("button", { name: "New terminal" }).click());
    for (const app of ["Docs", "API", "Databases", "Design", "Whiteboard", "Diagrams"]) {
      await step(page, `${theme} room, ${app}`, () => page.getByRole("group", { name: "Apps" }).getByRole("button", { name: app, exact: true }).click());
    }
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
