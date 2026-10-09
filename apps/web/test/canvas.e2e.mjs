// Design and Whiteboard, two people: a design one person makes and draws in shows up, shape and all,
// for the other; a sticky note's text on a whiteboard reaches both.
//   node test/canvas.e2e.mjs        (from apps/web, with the dev stack running)
import { readFileSync } from "node:fs";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const ok = (promise) => promise.then(() => true, () => false);
const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;

const canvasBox = async (page) => (await page.locator("[data-canvas]").first().boundingBox());
async function drag(page, from, to) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
  await page.mouse.up();
}
async function createNamed(page, noun, name) {
  await page.getByRole("button", { name: `New ${noun}` }).first().click();
  await page.locator("[data-canvas]").first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: `Rename ${noun}` }).click();
  const field = page.getByRole("textbox", { name: `${noun} name` });
  await field.fill(name);
  await field.press("Enter");
}

// Design: test1 draws a rectangle; test2 opens the same design and finds it in the layers.
for (const page of [a, b]) await page.getByRole("button", { name: "Design", exact: true }).click();
await createNamed(a, "design", `Logo ${stamp}`);
await a.getByRole("button", { name: /^Rectangle/ }).first().click();
await drag(a, [220, 160], [380, 270]);
check("rectangleDrawn", await ok(a.getByLabel("Layers").getByText(/Rectangle/).first().waitFor({ timeout: 10_000 })));
const listed = b.getByText(`Logo ${stamp}`, { exact: true }).first();
check("designListedForOthers", await ok(listed.waitFor({ timeout: 15_000 })));
await listed.click().catch(() => {});
check("shapeReachesOthers", await ok(b.getByLabel("Layers").getByText(/Rectangle/).first().waitFor({ timeout: 15_000 })));

// Whiteboard: a sticky note's text reaches the other person.
for (const page of [a, b]) await page.getByRole("button", { name: "Whiteboard", exact: true }).click();
await createNamed(a, "whiteboard", `Plan ${stamp}`);
await a.getByRole("button", { name: /^Sticky note/ }).first().click();
const box = await canvasBox(a);
await a.mouse.click(box.x + 260, box.y + 200);
await a.keyboard.type(`Ship ${stamp}`);
await a.keyboard.press("Escape");
check("stickyHasText", await ok(a.locator("[data-canvas]").getByText(`Ship ${stamp}`).first().waitFor({ timeout: 10_000 })));
const board = b.getByText(`Plan ${stamp}`, { exact: true }).first();
await board.waitFor({ timeout: 15_000 }).catch(() => {});
await board.click().catch(() => {});
check("stickyReachesOthers", await ok(b.locator("[data-canvas]").getByText(`Ship ${stamp}`).first().waitFor({ timeout: 15_000 })));

// Double-clicking empty board space starts a text box (notes have their own tool).
const shapes = (page) => page.locator("[data-canvas] [data-shape-id]").count();
await a.getByRole("button", { name: /^Select/ }).first().click();
const before = await shapes(a);
await a.mouse.dblclick(box.x + 520, box.y + 330);
await a.keyboard.type(`Note ${stamp}`);
await a.keyboard.press("Escape");
const typed = a.locator("[data-canvas]").getByText(`Note ${stamp}`).first();
check("doubleClickMakesText", (await ok(typed.waitFor({ timeout: 5_000 }))) && (await shapes(a)) === before + 1);

// The eraser takes a pen stroke away when dragged across it; one undo brings it back.
await a.getByRole("button", { name: /^Pen/ }).first().click();
await drag(a, [560, 120], [700, 160]);
const withStroke = await shapes(a);
await a.getByRole("button", { name: /^Eraser/ }).first().click();
await drag(a, [630, 90], [630, 200]);
const afterErase = await shapes(a);
await a.keyboard.press("Control+z");
await a.waitForTimeout(300);
const afterUndo = await shapes(a);
check("eraserRemovesStroke", afterErase === withStroke - 1, `${withStroke} → ${afterErase}`);
check("undoBringsItBack", afterUndo === withStroke, `${afterErase} → ${afterUndo}`);

// Export asks first, then downloads a real file.
async function exportAs(page, choose) {
  await page.getByRole("button", { name: "Export", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await choose(dialog);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), dialog.getByRole("button", { name: "Export" }).click()]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}
const pdf = await exportAs(a, async (dialog) => {
  await dialog.getByRole("radio", { name: "PDF" }).or(dialog.getByRole("button", { name: "PDF", exact: true })).first().click();
  await dialog.getByRole("combobox", { name: "Page" }).click();
  await a.getByRole("option", { name: "A4" }).click();
});
const pdfText = pdf.bytes.toString("latin1");
check("exportsPdf", pdfText.startsWith("%PDF-") && pdf.name.endsWith(".pdf") && /\/MediaBox \[0 0 841\.89 595\.28\]/.test(pdfText), `${pdf.name} ${pdf.bytes.length} bytes`);
const png = await exportAs(a, async () => {});
check("exportsPng", png.bytes.subarray(1, 4).toString() === "PNG" && png.name.endsWith(".png"), `${png.name} ${png.bytes.length} bytes`);

// A design's PDF gives each top-level frame its own page.
await a.getByRole("button", { name: "Design", exact: true }).click();
// The tool reopens the last design itself; only from the list does the name need a click (in the header it renames).
if (!(await a.locator("[data-canvas]").first().isVisible().catch(() => false))) await a.getByText(`Logo ${stamp}`, { exact: true }).first().click();
await a.locator("[data-canvas]").first().waitFor({ timeout: 20_000 });
await a.getByRole("button", { name: /^Frame/ }).first().click();
await drag(a, [30, 320], [200, 440]); // the design canvas sits between the Layers and properties panels
await a.keyboard.press("Escape");
let framesPdf = null;
try {
  framesPdf = await exportAs(a, async (dialog) => {
    await dialog.getByRole("radio", { name: "PDF" }).or(dialog.getByRole("button", { name: "PDF", exact: true })).first().click();
    await dialog.getByRole("radio", { name: /Each frame as a page/ }).click({ timeout: 5_000 });
  });
} catch {
  await a.screenshot({ path: `${process.env.TEMP ?? "/tmp"}/canvas-frames.png` });
  console.log("dialog:", ((await a.getByRole("dialog").textContent().catch(() => "")) ?? "").slice(0, 300));
}
check("designPdfPagePerFrame", Boolean(framesPdf) && /\/Count 1 /.test(framesPdf.bytes.toString("latin1")), framesPdf?.name ?? "no frames option");

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/canvas.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
