// The Lakehouse tool in a browser, for real, with nothing stood in for but one failure: its example notebook runs Spark, Delta Lake and
// MLflow in the room's kernel, and the tool shows the tables, reads an old version, and lists the runs. Its files and tables are removed.
//   node test/lakehouse.e2e.mjs        (from apps/web, with the dev stack running on the full sandbox image)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOTEBOOK = "lakehouse-example.ipynb";
const cleanupName = () => `lh_clean_${Date.now().toString(36)}.sh`;

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const files = a.getByRole("tree", { name: "Files" });
const row = (name) => files.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
const apps = a.getByRole("group", { name: "Apps" });

/** Runs a shell line in the room, through its own Run button. */
async function runInRoom(line) {
  const name = cleanupName();
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  await sleep(500);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(`${line}\n`);
  await sleep(1500);
  await a.getByRole("button", { name: "Run", exact: true }).first().click();
  await sleep(4000);
  await row(name).focus();
  await a.keyboard.press("Delete");
  await sleep(800);
}
const CLEAN = 'rm -rf "$HOME/lakehouse" /tmp/spark';

try {
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/lakehouse`, { headers: { origin: BASE }, data: { op: "overview" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  // From a clean start: what an earlier run left is in the room's home, not its files.
  await runInRoom(CLEAN);

  // A room without it says what to do.
  await a.route("**/api/rooms/*/lakehouse", (route) => route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ detail: "This room's sandbox doesn't have Spark, Delta Lake and MLflow. They come with the full image: its owner can choose that in the Ports panel." }) }));
  await apps.getByRole("button", { name: "Lakehouse", exact: true }).click();
  const tool = a.getByRole("region", { name: "Lakehouse" });
  await tool.waitFor({ timeout: 20_000 });
  check("aRoomWithoutItSaysWhatToDo", await ok(tool.getByRole("alert").getByText(/full image.*Ports panel/).waitFor({ timeout: 15_000 })));
  await a.unroute("**/api/rooms/*/lakehouse");
  await tool.getByRole("button", { name: "Look again" }).click();

  // Empty, it explains itself and offers the example.
  check("itExplainsItselfWhenEmpty", await ok(tool.getByText(/the open-source tools Databricks is built on/).waitFor({ timeout: 30_000 })), await tool.innerText());
  await tool.getByRole("button", { name: "Experiments" }).click();
  check("experimentsSayHowToStart", await ok(tool.getByText(/Whatever code in this room logs with MLflow/).waitFor({ timeout: 30_000 })));
  await tool.getByRole("button", { name: "Tables" }).click();
  await tool.getByRole("button", { name: "Open an example notebook" }).click();

  // The example, for real.
  const notebook = a.getByRole("region", { name: `Notebook ${NOTEBOOK}` });
  check("theExampleOpensAsANotebook", await ok(notebook.waitFor({ timeout: 20_000 })));
  const cells = notebook.getByRole("list", { name: "Cells" }).locator(":scope > li");
  check("itHasItsCells", (await cells.count()) >= 10, await cells.count());
  const started = Date.now();
  await a.getByRole("button", { name: "Run all", exact: true }).click();
  // In the last cell's output: these words are in its source too.
  const done = cells.last().getByRole("group", { name: "Output" }).getByText("Logged 3 runs.");
  check("everyCellRuns", await ok(done.waitFor({ timeout: 400_000 })), await notebook.innerText().then((text) => text.slice(-600)));
  console.log(`      the notebook took ${Math.round((Date.now() - started) / 1000)} s`);
  check("noCellFailed", (await notebook.getByRole("alert").count()) === 0, await notebook.getByRole("alert").first().innerText().catch(() => ""));
  const outputs = notebook.getByRole("group", { name: "Output" });
  check("itShowsTheOldVersionAndTheNew", await outputs.getByText(/As it was, at version 0:/).first().isVisible());
  check("aTableOffersAnExplanation", (await notebook.getByRole("button", { name: "Explain this data" }).count()) >= 3);

  // What it made, in the tool.
  await apps.getByRole("button", { name: "Lakehouse", exact: true }).click();
  await tool.waitFor({ timeout: 20_000 });
  const tables = tool.getByRole("navigation", { name: "Tables in this room" });
  check("itsTablesAreListed", await ok(tables.getByRole("button", { name: "gold_city_totals" }).waitFor({ timeout: 30_000 })));
  check("allThree", (await tables.getByRole("button", { name: "bronze_orders" }).isVisible()) && (await tables.getByRole("button", { name: "silver_orders" }).isVisible()));
  await tables.getByRole("button", { name: "gold_city_totals" }).click();
  const gold = tool.getByRole("region", { name: "Table gold_city_totals" });
  const rows = gold.getByRole("group", { name: "Rows of gold_city_totals" });
  await rows.waitFor({ timeout: 30_000 });
  const pune = () => rows.getByRole("row", { name: /Pune/ }).innerText();
  check("theLatestShowsTheChange", /\b0(\.0)?\b/.test(await pune()), await pune());
  const versions = gold.getByRole("group", { name: "Versions of gold_city_totals" });
  check("itsVersionsAreListed", (await versions.getByRole("row").count()) >= 3, await versions.getByRole("row").count());
  check("sayingWhatHappened", await versions.getByRole("cell", { name: "UPDATE" }).first().isVisible());
  // Rerunning the notebook adds versions, so the one before the update is the second row.
  await versions.getByRole("button", { name: /^Open version/ }).nth(1).click();
  check("anOldVersionOpens", await ok(gold.getByText(/As it was at version \d+\./).waitFor({ timeout: 30_000 })));
  await sleep(1000);
  check("withTheValueItHadThen", /165\.5/.test(await pune()), await pune());
  check("itCanBeExplainedToo", await gold.getByRole("button", { name: "Explain this data" }).isVisible());

  // Experiments.
  await tool.getByRole("button", { name: "Experiments" }).click();
  const runs = tool.getByRole("group", { name: "MLflow runs" });
  check("runsAreListed", await ok(runs.waitFor({ timeout: 30_000 })));
  check("sideBySide", (await runs.getByRole("columnheader", { name: "threshold" }).isVisible()) && (await runs.getByRole("columnheader", { name: "big_orders" }).isVisible()));
  const over100 = runs.getByRole("row", { name: /over 100/ }).first();
  check("withWhatEachGot", /big orders/.test(await over100.innerText()) && /Finished/.test(await over100.innerText()), await over100.innerText());
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  await apps.getByRole("button", { name: "Lakehouse", exact: true }).click().catch(() => {});
  await sleep(500);
  if (await row(NOTEBOOK).count().catch(() => 0)) {
    await row(NOTEBOOK).focus().catch(() => {});
    await a.keyboard.press("Delete").catch(() => {});
    await sleep(1500);
  }
  await runInRoom(CLEAN).catch(() => {});
  check("itsFilesAreRemoved", (await row(NOTEBOOK).count()) + (await files.getByRole("treeitem", { name: /^lh_clean_/ }).count()) === 0);
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
