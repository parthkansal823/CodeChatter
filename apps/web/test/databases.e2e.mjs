// One-click databases from the Databases tool, two people: the owner starts Redis and copies its URL; the
// editor sees it running and how to connect; stopping keeps the data, deleting removes it.
//   node test/databases.e2e.mjs      (from apps/web, with the dev stack running)
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const { browser, errors, signIn } = await launch();
const owner = await signIn("test1@codechatter.local");
const editor = await signIn("test2@codechatter.local");
await owner.context.grantPermissions(["clipboard-read", "clipboard-write"]);

async function openDatabases(page) {
  await page.getByRole("button", { name: "Databases", exact: true }).click();
  const row = page.getByRole("listitem", { name: "Redis (Valkey 9)" });
  await row.waitFor({ timeout: 20_000 });
  return row;
}

try {
  const mine = await openDatabases(owner.page);
  const theirs = await openDatabases(editor.page);
  check("allFiveListed", (await owner.page.getByRole("listitem").filter({ hasText: /PostgreSQL|MySQL|MariaDB|MongoDB|Redis/ }).count()) === 5);

  // Start from nothing, whatever an earlier run left.
  const remove = mine.getByRole("button", { name: /^Delete Redis/ });
  if (await remove.isVisible()) {
    owner.page.once("dialog", (dialog) => void dialog.accept());
    await remove.click();
  }
  await mine.getByText("Off", { exact: true }).waitFor({ timeout: 20_000 });

  await mine.getByRole("button", { name: "Start" }).click();
  await mine.getByText("Running", { exact: true }).waitFor({ timeout: 90_000 });
  check("ownerStartsRedis", await mine.getByText(/^redis:6379/).isVisible());
  check("showsHowToConnect", (await mine.getByText("$REDIS_URL", { exact: true }).isVisible()) && (await mine.getByText('redis-cli -u "$REDIS_URL"').isVisible()));

  await mine.getByRole("button", { name: "Copy the URL" }).click();
  const copied = await owner.page.evaluate(() => navigator.clipboard.readText());
  check("copiesTheUrl", /^redis:\/\/default:[\w-]{24}@redis:6379\/0$/.test(copied), copied.replace(/:[\w-]{24}@/, ":•••@"));
  check("urlIsMaskedOnScreen", (await mine.innerText()).includes("default:••••••@redis:6379"));

  await theirs.getByText("Running", { exact: true }).waitFor({ timeout: 15_000 });
  check("editorSeesItRunning", (await theirs.getByText(/^redis:6379/).isVisible()) && (await theirs.getByRole("button", { name: "Stop" }).isVisible()));

  await mine.getByRole("button", { name: "Stop" }).click();
  await mine.getByText("Stopped, data kept", { exact: true }).waitFor({ timeout: 30_000 });
  check("stopKeepsData", true);

  owner.page.once("dialog", (dialog) => void dialog.accept());
  await mine.getByRole("button", { name: /^Delete Redis/ }).click();
  await mine.getByText("Off", { exact: true }).waitFor({ timeout: 30_000 });
  check("deleteRemovesIt", true);

  // The console and table browser, on PostgreSQL.
  const pg = owner.page.getByRole("listitem", { name: "PostgreSQL 18" });
  if (await pg.getByRole("button", { name: "Start" }).isVisible()) await pg.getByRole("button", { name: "Start" }).click();
  await pg.getByText("Running", { exact: true }).waitFor({ timeout: 90_000 });
  await pg.getByRole("button", { name: "Open" }).click();
  const box = owner.page.getByRole("textbox", { name: "Query" });
  await box.fill("drop table if exists pets; create table pets(name text, age int); insert into pets values ('Rex', 3), ('Tom', null); select name, age from pets order by name");
  await box.press("Control+Enter");
  const results = owner.page.getByRole("region", { name: "Results" });
  await results.getByRole("cell", { name: "Rex" }).waitFor({ timeout: 30_000 });
  check("consoleRunsSql", (await results.getByText("INSERT 0 2").isVisible()) && (await results.getByText("NULL", { exact: true }).isVisible()));
  const list = owner.page.getByRole("complementary", { name: "Tables" });
  await list.getByRole("button", { name: "pets" }).click();
  await results.getByText("2 rows", { exact: true }).waitFor({ timeout: 30_000 });
  check("browserPreviewsATable", (await box.inputValue()) === 'select * from "pets" limit 100', await box.inputValue());

  // A backup downloads as SQL; a file from this computer loads into the database.
  const [download] = await Promise.all([owner.page.waitForEvent("download"), owner.page.getByRole("link", { name: "Backup" }).click()]);
  const dumped = await readFile(await download.path(), "utf8");
  check("backupDownloads", /^e2etst-postgres-\d{4}-\d\d-\d\d\.sql$/.test(download.suggestedFilename()) && dumped.includes("CREATE TABLE public.pets"), download.suggestedFilename());
  await owner.page.getByLabel("File to load").setInputFiles({ name: "more.sql", mimeType: "application/sql", buffer: Buffer.from("insert into pets values ('Max', 1);\n") });
  await results.getByText(/^Loaded \d+ bytes\.$/).waitFor({ timeout: 30_000 });
  await list.getByRole("button", { name: "pets" }).click();
  await results.getByText("3 rows", { exact: true }).waitFor({ timeout: 30_000 });
  check("uploadLoadsAFile", await results.getByRole("cell", { name: "Max" }).isVisible());

  // The editor sees the same table from their side.
  await theirs.page().getByRole("listitem", { name: "PostgreSQL 18" }).getByRole("button", { name: "Open" }).click();
  await editor.page.getByRole("complementary", { name: "Tables" }).getByRole("button", { name: "pets" }).waitFor({ timeout: 30_000 });
  check("editorSeesTheTables", true);
  // Reset wipes it: back in the list, it starts again, empty.
  owner.page.once("dialog", (dialog) => void dialog.accept());
  await owner.page.getByRole("button", { name: "Reset" }).click();
  await pg.getByText(/^Starting/).waitFor({ timeout: 15_000 }).catch(() => {});
  await pg.getByText("Running", { exact: true }).waitFor({ timeout: 90_000 });
  await pg.getByRole("button", { name: "Open" }).click();
  await list.getByText("None yet.").waitFor({ timeout: 30_000 });
  check("resetEmptiesIt", true);
  await owner.page.getByRole("button", { name: "Back to databases" }).click();
  owner.page.once("dialog", (dialog) => void dialog.accept());
  await pg.getByRole("button", { name: /^Delete PostgreSQL/ }).click();
  await pg.getByText("Off", { exact: true }).waitFor({ timeout: 30_000 });
} catch (error) {
  const shot = join(tmpdir(), "databases-failed.png");
  await owner.page.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
