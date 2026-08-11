/**
 * Route smoke test.
 *
 * Loads every top-level route in a real browser and fails on any page error,
 * console error, or route that renders nothing. This exists because lint, unit
 * tests, and `vite build` can all pass while the app is a blank page — exactly
 * what a bad `manualChunks` split once caused here (a chunk init-order
 * ReferenceError that only appeared in a production build).
 *
 * Usage:
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Requires playwright-core plus a local Chromium/Edge/Chrome. Set
 * SMOKE_BROWSER to override the executable path.
 */
import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

const BASE = process.argv[2] || process.env.SMOKE_URL || "http://localhost:8000";

const ROUTES = ["/", "/auth", "/home", "/settings", "/profile", "/room"];

// Console noise that is expected and not a failure.
const IGNORED = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\] connect/i,
];

function findBrowser() {
  if (process.env.SMOKE_BROWSER) return process.env.SMOKE_BROWSER;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p) => existsSync(p));
}

const executablePath = findBrowser();
if (!executablePath) {
  console.error("No Chromium-based browser found. Set SMOKE_BROWSER to its path.");
  process.exit(2);
}

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
let failures = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  const problems = [];

  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED.some((r) => r.test(text))) return;
    problems.push(`console: ${text}`);
  });
  page.on("requestfailed", (r) => {
    if (IGNORED.some((rx) => rx.test(r.url()))) return;
    problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  });

  let rendered = 0;
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    rendered = await page.evaluate(() => document.getElementById("root")?.innerHTML.length ?? 0);
  } catch (error) {
    problems.push(`navigation: ${error.message}`);
  }

  if (rendered < 200) problems.push(`rendered only ${rendered} chars (blank page?)`);

  if (problems.length) {
    failures += 1;
    console.log(`FAIL ${route}`);
    for (const p of problems.slice(0, 5)) console.log(`     ${p}`);
  } else {
    console.log(`ok   ${route}  (${rendered} chars)`);
  }

  await page.close();
}

await browser.close();

console.log(failures ? `\n${failures} route(s) failed` : "\nall routes ok");
process.exit(failures ? 1 : 0);
