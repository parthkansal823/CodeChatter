// Diagrams (draw.io), two people: a new diagram shows up for the other person, edits in draw.io reach
// each other live (draw.io's own patches over the room document), someone opening it later loads
// everything, and the diagram downloads as a .drawio file.
//
// embed.diagrams.net answers automated browsers with a 403, so the real draw.io comes from a throwaway
// container instead. The app still asks for embed.diagrams.net, under its real security policy; only the
// answer comes from here. The first run downloads the image (400 MB).
//   node test/diagrams.e2e.mjs        (from apps/web, with the dev stack running)
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { check, finish, launch, sleep } from "./browser.mjs";

const stamp = Date.now().toString(36);
const ok = (promise) => promise.then(() => true, () => false);
const DRAWIO = "https://embed.diagrams.net";
const IMAGE = "jgraph/drawio:32.6.10";
const CONTAINER = `cc-drawio-test-${stamp}`;

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 600_000 }).trim();
process.on("exit", () => spawnSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" }));
docker("run", "-d", "--rm", "--name", CONTAINER, "-p", "127.0.0.1::8080", IMAGE);
const localDrawio = `http://${docker("port", CONTAINER, "8080/tcp").split("\n")[0]}`;
for (let tries = 0; !(await fetch(localDrawio).then((response) => response.ok, () => false)); tries++) {
  if (tries === 90) throw new Error("draw.io's container didn't start");
  await sleep(1000);
}
const answerFromLocalDrawio = (context) =>
  context.route(`${DRAWIO}/**`, async (route) => {
    const { pathname, search } = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${localDrawio}${pathname}${search}` }) });
  });

const frameOf = (page) => page.frameLocator('iframe[title^="Diagram"]');
const texts = (page) => frameOf(page).locator(".geDiagramContainer").getByText("Text", { exact: true }).count();
// draw.io's own Insert > Text, as its menu runs it; then finish editing so the change is committed.
async function insertText(page, at) {
  await page.evaluate((origin) => {
    const frame = document.querySelector('iframe[title^="Diagram"]');
    frame.contentWindow.postMessage(JSON.stringify({ action: "invokeAction", actionName: "insertText" }), origin);
  }, DRAWIO);
  await page.waitForTimeout(600);
  await frameOf(page).locator(".geDiagramContainer").first().click({ position: at });
  await page.keyboard.press("Escape");
}
async function waitForTexts(page, n) {
  for (let i = 0; i < 30; i++) {
    if ((await texts(page)) >= n) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

const { browser, errors, signIn } = await launch();
const one = await signIn("test1@codechatter.local");
const a = one.page;
const two = await signIn("test2@codechatter.local");
const b = two.page;
await answerFromLocalDrawio(one.context);
await answerFromLocalDrawio(two.context);
for (const page of [a, b]) await page.getByRole("button", { name: "Diagrams", exact: true }).click();

await a.getByRole("button", { name: "New diagram" }).first().click();
await a.getByRole("button", { name: "Rename diagram" }).click();
await a.getByRole("textbox", { name: "diagram name" }).fill(`Flow ${stamp}`);
await a.getByRole("textbox", { name: "diagram name" }).press("Enter");
check("drawioLoads", await ok(frameOf(a).locator(".geDiagramContainer").first().waitFor({ timeout: 60_000 })));

const listed = b.getByText(`Flow ${stamp}`, { exact: true }).first();
check("listedForOthers", await ok(listed.waitFor({ timeout: 20_000 })));
await listed.click();
await frameOf(b).locator(".geDiagramContainer").first().waitFor({ timeout: 60_000 });
await a.waitForTimeout(2000);

await insertText(a, { x: 20, y: 20 });
check("editReachesOthers", await waitForTexts(b, 1));
await insertText(b, { x: 30, y: 300 });
check("editsGoBothWays", await waitForTexts(a, 2));

// Someone opening it later loads the saved diagram (saved every couple of seconds).
await a.waitForTimeout(3000);
const late = await one.context.newPage();
await late.goto(a.url());
await late.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
await late.getByRole("button", { name: "Diagrams", exact: true }).click();
await late.getByText(`Flow ${stamp}`, { exact: true }).first().click().catch(() => {});
await frameOf(late).locator(".geDiagramContainer").first().waitFor({ timeout: 60_000 });
check("newcomerLoadsEverything", await waitForTexts(late, 2));

// The diagram itself downloads as a .drawio file.
await a.getByRole("button", { name: "Export" }).click();
const [download] = await Promise.all([a.waitForEvent("download", { timeout: 20_000 }), a.getByRole("menuitem", { name: /draw\.io file/ }).click()]);
const file = readFileSync(await download.path(), "utf8");
check("downloadsDrawioFile", download.suggestedFilename().endsWith(".drawio") && file.startsWith("<mxfile"), download.suggestedFilename());

await b.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/diagrams.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
