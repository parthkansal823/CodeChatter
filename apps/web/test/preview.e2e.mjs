// File previews (roadmap §14 A): a CSV file as a table (quoted cells, sorting, a filter, the header switch,
// live edits, double-click a row to see its line in the code, preview on its own), a TSV file, and an SVG
// file as an image that runs no scripts (its size, fit or actual size, and a broken one said so). The test's
// files have a stamp in their names and are deleted at the end.
//   node test/preview.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const csv = `pv_${stamp}.csv`;
const tsv = `pv_${stamp}.tsv`;
const svg = `pv_${stamp}.svg`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CSV = 'city,rooms,notes\nPune,3,"near ""the"" river"\nDelhi,12,\nAgra,5,"two\nlines"\nMumbai,1,\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="orange"/><script>alert("ran")</script></svg>\n';

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const created = [];
const dialogs = [];
a.on("dialog", (dialog) => {
  dialogs.push(dialog.message());
  void dialog.dismiss();
});

async function newFile(name, text) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(400);
}

const preview = (name) => a.getByRole("region", { name: `Preview of ${name}` });
const table = a.getByRole("table", { name: `${csv} as a table` });
const firstColumn = async () => (await table.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.querySelector("td")?.textContent ?? "")));

try {
  await newFile(csv, CSV);
  await a.getByRole("button", { name: "Table view" }).click();
  await table.waitFor({ timeout: 5_000 });
  check("csvOpensAsTable", (await table.locator("thead th").allInnerTexts()).slice(1).join(",") === "city,rooms,notes");
  check("quotedCells", (await table.getByRole("cell", { name: 'near "the" river' }).count()) === 1 && (await table.locator("tbody tr").count()) === 4);
  check("summary", await ok(preview(csv).getByText("4 rows · 3 columns · split by commas").waitFor({ timeout: 3_000 })));
  check("numbersRightAligned", (await table.getByRole("cell", { name: "12", exact: true }).evaluate((td) => getComputedStyle(td).textAlign)) === "right");

  // Sort by a heading: up, down, then back to the file's order.
  const rooms = table.getByRole("button", { name: "rooms" });
  await rooms.click();
  check("sortsAscending", (await firstColumn()).join(",") === "Mumbai,Pune,Agra,Delhi", (await firstColumn()).join(","));
  await rooms.click();
  check("sortsDescending", (await firstColumn())[0] === "Delhi");
  await rooms.click();
  check("sortOff", (await firstColumn()).join(",") === "Pune,Delhi,Agra,Mumbai");

  await preview(csv).getByLabel("Filter rows").fill("pu");
  check("filters", await ok(preview(csv).getByText(/^1 of 4 rows/).waitFor({ timeout: 3_000 })) && (await firstColumn()).join(",") === "Pune");
  await preview(csv).getByLabel("Filter rows").fill("");

  // Edits show at once: a row typed at the end of the code.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+End");
  await a.keyboard.insertText("Chennai,7,\n");
  check("liveEdits", await ok(table.getByRole("cell", { name: "Chennai" }).waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "preview-table.png") });

  await preview(csv).getByLabel("First row is the header").click();
  check("headerSwitch", (await table.locator("thead th").nth(1).innerText()) === "Column 1" && (await table.locator("tbody tr").count()) === 6);
  await preview(csv).getByLabel("First row is the header").click();

  // Double-click a row: its line in the code.
  await table.getByRole("row", { name: /Agra/ }).dblclick();
  check("rowToLine", await ok(a.getByText("Ln 4, Col 1").waitFor({ timeout: 5_000 })));

  // On its own (Ctrl+Shift+V from the code), then back.
  await a.keyboard.press("Control+Shift+v");
  check("previewOnItsOwn", await ok(preview(csv).getByRole("button", { name: "Show the code" }).waitFor({ timeout: 5_000 })) && (await a.locator(".monaco-editor").count()) === 0);
  await preview(csv).getByRole("button", { name: "Show the code" }).click();
  await preview(csv).getByRole("button", { name: "Close the preview" }).click();

  // TSV splits by tabs.
  await newFile(tsv, "name\tscore\nana\t9\nbo\t7\n");
  await a.getByRole("button", { name: "Table view" }).click();
  check("tsvByTabs", await ok(preview(tsv).getByText("2 rows · 2 columns · split by tabs").waitFor({ timeout: 5_000 })));
  await preview(tsv).getByRole("button", { name: "Close the preview" }).click();

  // SVG as an image: drawn, sized, and its script never runs.
  await newFile(svg, SVG);
  await a.getByRole("button", { name: "Image preview" }).click();
  const img = preview(svg).getByRole("img", { name: svg });
  check("svgShown", await ok(preview(svg).getByText("120 × 80").waitFor({ timeout: 5_000 })) && (await img.isVisible()));
  await preview(svg).getByRole("button", { name: "Actual size" }).click();
  check("actualSize", (await img.evaluate((el) => el.getBoundingClientRect().width)) === 120);
  await a.waitForTimeout(500);
  check("svgScriptDoesNotRun", dialogs.length === 0, dialogs.join(" | "));
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  await a.keyboard.insertText("<svg");
  check("brokenSvgSaysSo", await ok(preview(svg).getByText(/isn't a valid SVG yet/).waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "preview.png") });
} catch (error) {
  const shot = join(tmpdir(), "preview-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    const tree = a.getByRole("tree", { name: "Files" });
    for (const name of created) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFilesDeleted", true, created.join(", "));
  } catch (error) {
    check("testFilesDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
