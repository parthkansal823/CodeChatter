/**
 * Check real OSV advisories from a manifest pasted through Monaco in E2ETST.
 * Needs the shared dev stack, seeded test1 and internet access to api.osv.dev.
 * From apps/web: node test/dependencies.e2e.mjs
 * Only its unique deps_<stamp> folder is changed, then deleted even on failure.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOM, check, finish, launch } from "./browser.mjs";

if (ROOM !== "E2ETST") throw new Error("This test must use the seeded E2ETST room.");
const folder = `deps_${Date.now().toString(36)}_${process.pid}`;
const path = `${folder}/package-lock.json`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lock = (version) => JSON.stringify({ name: "dependency-alert-check", lockfileVersion: 3, packages: {
  "": { name: "dependency-alert-check", version: "1.0.0" },
  "node_modules/lodash": { version },
} }, null, 2) + "\n";
const { browser, errors, signIn } = await launch();
let page;
const requests = [];
let context;

async function newFile(name) {
  const parent = page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(folder)}`) }).first();
  if (await parent.getAttribute("aria-expanded") === "false") await parent.click();
  await parent.click({ button: "right" });
  await page.getByRole("menuitem", { name: "New file", exact: true }).click();
  await page.getByPlaceholder("name.ext").fill(name.split("/").at(-1));
  await page.getByPlaceholder("name.ext").press("Enter");
  await page.getByRole("tab", { name: new RegExp(escape(name.split("/").at(-1))) }).waitFor({ timeout: 15_000 });
}
async function paste(text) {
  await page.locator(".monaco-editor .view-lines:visible").first().click();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+v");
  await page.waitForFunction((version) => [...document.querySelectorAll(".monaco-editor .view-lines")].some((node) => node.textContent.includes(version)), JSON.parse(text).packages["node_modules/lodash"].version);
}
function nextCheck(action) {
  return Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/rooms/${ROOM}/dependencies/check`) && response.request().method() === "POST", { timeout: 90_000 }),
    action(),
  ]).then(([response]) => response);
}

try {
  ({ page, context } = await signIn("test1@codechatter.local"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("request", (request) => {
    if (!request.url().endsWith(`/api/rooms/${ROOM}/dependencies/check`) || request.method() !== "POST") return;
    requests.push(request.postDataJSON());
  });
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByPlaceholder("folder").fill(folder);
  await page.getByPlaceholder("folder").press("Enter");
  await newFile(path);
  await paste(lock("4.17.20"));
  check("lock file created through Files and Monaco", true);
  const response = await nextCheck(() => page.getByRole("button", { name: "Dependencies", exact: true }).click());
  check("opening the tool checks automatically", response.status() === 200, `HTTP ${response.status()}`);
  if (response.status() !== 200) throw new Error("OSV check failed; this browser test needs internet access to api.osv.dev.");
  const panel = page.getByRole("region", { name: "Dependencies", exact: true });
  const lodash = panel.getByRole("article", { name: "lodash 4.17.20", exact: true });
  await lodash.waitFor({ timeout: 15_000 });
  const links = lodash.locator('a[href^="https://osv.dev/vulnerability/"]');
  check("lodash 4.17.20 has known advisories", await links.count() > 0);
  check("advisories include severity and a summary", /Critical|High|Moderate|Low|Unknown severity/.test(await lodash.innerText()) && (await lodash.innerText()).length > 80);
  check("fixed version or its absence is stated", /Fixed in |Fixed version not listed/.test(await lodash.innerText()));

  // A different tab makes the jump assertion meaningful, while adding no dependency.
  await newFile(`${folder}/note.txt`);
  const source = lodash.getByRole("button", { name: new RegExp(`^Open ${escape(path)}:\\d+$`) });
  const label = await source.getAttribute("aria-label");
  const line = Number(label.split(":").at(-1));
  await source.click();
  check("manifest link opens its file", await page.getByRole("tab", { name: /package-lock\.json/ }).getAttribute("aria-selected") === "true");
  await page.getByText(`Ln ${line}, Col 1`, { exact: true }).waitFor({ timeout: 5000 });
  check("manifest link reveals its line", Number.isInteger(line) && line > 0);

  await panel.getByRole("button", { name: "Copy as Markdown", exact: true }).click();
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith("# Dependency alerts"), undefined, { timeout: 5000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check("Markdown includes the package, advisory and location", copied.includes("lodash") && copied.includes("4.17.20") && copied.includes("https://osv.dev/vulnerability/") && copied.includes(path.replaceAll("_", "\\_")));
  const manual = await nextCheck(() => panel.getByRole("button", { name: "Check", exact: true }).click());
  check("Check refreshes the report", manual.status() === 200);

  const before = requests.length;
  const changed = await nextCheck(() => paste(lock("4.17.21")));
  check("manifest edit is checked after debounce", changed.status() === 200 && requests.length === before + 1 && requests.at(-1).packages.some((pkg) => pkg.name === "lodash" && pkg.version === "4.17.21"));
  await page.screenshot({ path: join(tmpdir(), `${folder}-dependencies.png`) });
} catch (error) {
  const shot = join(tmpdir(), `${folder}-failed.png`);
  const failedPage = page ?? browser.contexts().flatMap((item) => item.pages()).at(-1);
  await failedPage?.screenshot({ path: shot }).catch(() => {});
  check("flow completes", false, `${error.message.split("\n")[0]} (screenshot: ${shot})`);
} finally {
  try {
    if (page) {
      const item = page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(folder)}`) }).first();
      if (await item.count()) {
        await item.focus();
        await item.press("Delete");
        await item.waitFor({ state: "detached", timeout: 10_000 });
      }
    }
    check("temporary folder deleted", true, folder);
  } catch (error) { check("temporary folder deleted", false, error.message.split("\n")[0]); }
  await context?.close();
  await browser.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
finish();
