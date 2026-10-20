// Notebooks (roadmap §2), two people in one .ipynb: cells typed by either person run in the room's kernel
// and both see the outputs arrive (printed text, a returned value, a plot, a pandas table, errors).
// Shift+Enter runs and moves on, Ctrl+Enter runs in place; variables carry between people's cells; text
// cells render; Interrupt, Run all and Restart work; outputs survive a reload. The test's notebook has a
// stamp in its name and is deleted at the end.
//   node test/notebook.e2e.mjs        (from apps/web, with the dev stack running and the sandbox image built)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const name = `nb_${stamp}.ipynb`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;
let created = false;

const notebook = (page) => page.getByRole("region", { name: `Notebook ${name}` });
const cells = (page) => notebook(page).getByRole("list", { name: "Cells" }).locator(":scope > li");
const cell = (page, n) => cells(page).nth(n - 1);
const output = (page, n) => cell(page, n).getByRole("group", { name: "Output" });

/** Type into cell `n` (1-based), replacing what's there. */
async function type(page, n, text) {
  await cell(page, n).locator(".monaco-editor .view-lines").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape"); // any suggestion list
}

async function openInTree(page) {
  const row = page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
  await row.waitFor({ timeout: 15_000 });
  await row.click();
  await notebook(page).waitFor({ timeout: 20_000 });
}

try {
  // A new .ipynb opens as a notebook with one empty code cell.
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  created = true;
  check("newFileOpensAsNotebook", await ok(notebook(a).waitFor({ timeout: 20_000 })));
  check("startsWithOneCodeCell", (await cells(a).count()) === 1 && (await cell(a, 1).getAttribute("aria-label")) === "Code cell 1");
  await openInTree(b);

  // Shift+Enter: run, and a new cell below (it was the last). The first kernel start imports a lot.
  await type(a, 1, 'print("hello from the kernel")\nx = 7\nx * 6');
  await a.keyboard.press("Shift+Enter");
  await output(a, 1).getByText("hello from the kernel").waitFor({ timeout: 180_000 });
  check("printsAndReturns", (await output(a, 1).innerText()).includes("42"), await output(a, 1).innerText());
  check("shiftEnterAddsACell", await ok(cell(a, 2).waitFor({ timeout: 5_000 })));
  check("otherPersonSeesOutput", await ok(output(b, 1).getByText("hello from the kernel").waitFor({ timeout: 10_000 })));
  check("countShown", (await cell(a, 1).getByLabel("Ran as number 1").count()) === 1);

  // Ctrl+Enter runs in place: a plot and a pandas table.
  await type(a, 2, 'import pandas as pd, matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [1, 4, 9]); plt.show()\npd.DataFrame({"city": ["Pune", "Delhi"], "rooms": [3, 5]})');
  await a.keyboard.press("Control+Enter");
  await output(a, 2).getByRole("img").waitFor({ timeout: 90_000 });
  const plot = await output(a, 2).getByRole("img").evaluate((img) => ({ src: img.getAttribute("src")?.slice(0, 22), width: img.naturalWidth }));
  check("plotShown", plot.src === "data:image/png;base64," && plot.width > 100, JSON.stringify(plot));
  const table = a.frameLocator(`[title="HTML output"]`).first();
  check("tableShown", await ok(table.getByRole("cell", { name: "Pune" }).waitFor({ timeout: 10_000 })));
  check("ctrlEnterStays", (await cells(a).count()) === 2);
  check("plotReachesOthers", await ok(output(b, 2).getByRole("img").waitFor({ timeout: 10_000 })));

  // The other person adds a text cell and a code cell that uses the first person's variable.
  await notebook(b).getByRole("button", { name: "Add a text cell at the end" }).click();
  await cell(b, 3).locator(".monaco-editor").waitFor({ timeout: 10_000 });
  await b.keyboard.insertText("# Results\nSquares and *cities*.");
  await b.keyboard.press("Shift+Enter");
  check("textCellRenders", await ok(cell(b, 3).getByRole("heading", { name: "Results" }).waitFor({ timeout: 10_000 })));
  check("textCellReachesOthers", await ok(cell(a, 3).getByRole("heading", { name: "Results" }).waitFor({ timeout: 10_000 })));
  // Shift+Enter on the last (text) cell added a code cell after it.
  await cell(b, 4).locator(".monaco-editor").waitFor({ timeout: 10_000 });
  await type(b, 4, "x * 3");
  await b.keyboard.press("Shift+Enter");
  check("variablesShared", await ok(output(a, 4).getByText("21", { exact: true }).waitFor({ timeout: 30_000 })));

  // An error, shown as one.
  await type(a, 5, "1 / 0");
  await a.keyboard.press("Control+Enter");
  check("errorShown", await ok(output(a, 5).getByRole("alert").filter({ hasText: "ZeroDivisionError" }).waitFor({ timeout: 30_000 })));

  // Interrupt stops a long cell.
  await notebook(a).getByRole("button", { name: "Add a code cell at the end" }).click();
  await type(a, 6, "import time\nfor i in range(120):\n    time.sleep(0.5)");
  await a.keyboard.press("Control+Enter");
  await notebook(a).getByRole("status").getByText(/Running/).waitFor({ timeout: 30_000 });
  await a.waitForTimeout(1500);
  const t0 = Date.now();
  await notebook(a).getByRole("button", { name: "Interrupt" }).click();
  check("interruptStops", await ok(output(a, 6).getByRole("alert").filter({ hasText: "KeyboardInterrupt" }).waitFor({ timeout: 20_000 })), `${Date.now() - t0}ms`);
  check("idleAfter", await ok(notebook(a).getByRole("status").getByText(/Idle/).waitFor({ timeout: 10_000 })));

  // The title bar's Run on a notebook is Run all: cell 1 runs again, and the error stops the cells after it.
  await a.getByRole("button", { name: "Run all", exact: true }).click();
  check("runAllRunsFromTheTop", await ok(cell(a, 1).getByLabel(/^Ran as number ([2-9]|\d\d)/).waitFor({ timeout: 60_000 })));
  await notebook(a).getByRole("status").getByText(/Idle/).waitFor({ timeout: 60_000 });
  check("errorStopsRunAll", (await output(a, 6).count()) === 1 && (await output(a, 6).innerText()).includes("KeyboardInterrupt"));

  // Restart forgets every variable.
  // The answer comes once the kernel has restarted (the status on screen could still be the one from before).
  await Promise.all([
    a.waitForResponse((response) => response.url().endsWith("/restart") && response.ok(), { timeout: 60_000 }),
    notebook(a).getByRole("button", { name: /^Restart the kernel/ }).click(),
  ]);
  await notebook(a).getByRole("status").getByText(/Idle/).waitFor({ timeout: 60_000 });
  await type(a, 4, "x");
  await a.keyboard.press("Control+Enter");
  check(
    "restartForgets",
    await ok(output(a, 4).getByRole("alert").filter({ hasText: "NameError" }).waitFor({ timeout: 30_000 })),
    `${await cell(a, 4).innerText().catch(() => "")} | ${await notebook(a).getByRole("status").innerText().catch(() => "")}`,
  );

  // Outputs live in the room: a reload shows them again.
  await a.reload();
  await a.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await notebook(a).waitFor({ timeout: 30_000 });
  check("outputsSurviveReload", await ok(output(a, 1).getByText("hello from the kernel").waitFor({ timeout: 20_000 })));

  // After a reload the notebook is the page's first editor: its cells still take typing (they used to go blank).
  await type(a, 6, "y = 1");
  check("typingAfterReload", (await cell(a, 6).locator(".view-lines").innerText()).replace(/\s+/g, " ").trim() === "y = 1", await cell(a, 6).locator(".view-lines").innerText().catch(() => "no editor"));

  await notebook(a).getByRole("button", { name: "Shut the kernel down" }).click();
  check("shutsDown", await ok(notebook(a).getByRole("status").getByText(/Kernel off/).waitFor({ timeout: 15_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "notebook.png") });
} catch (error) {
  const shot = join(tmpdir(), "notebook-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      const filesButton = a.getByRole("button", { name: "Files", exact: true });
      if ((await filesButton.getAttribute("aria-pressed")) !== "true") await filesButton.click();
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
