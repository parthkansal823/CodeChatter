// Loads the built spike in headless Edge and prints window.__S1__ results.
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:4317/";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.__S1__?.done, null, { timeout: 60_000 });
const { results } = await page.evaluate(() => window.__S1__);
let failed = 0;
for (const [name, { ok, detail }] of Object.entries(results)) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
if (errors.length) console.log("\nBrowser errors:\n" + errors.slice(0, 10).join("\n"));
await browser.close();
process.exit(failed ? 1 : 0);
