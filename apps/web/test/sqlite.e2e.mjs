// SQLite files in the Databases tool, as people would use them: the owner makes a database from a terminal in
// E2ETST (as an app would), finds it under SQLite files, opens it, previews a table (NULLs shown), and runs
// statements in the console; a backup downloads as SQL and a file from this computer loads into it (no Reset, as
// for the servers); the editor finds and browses it too. The test's file is deleted from the terminal.
//   node test/sqlite.e2e.mjs      (from apps/web, with the dev stack running)
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const file = `sqb_${Date.now().toString(36)}.db`;
const make = `python3 -c "import sqlite3; d = sqlite3.connect('${file}'); d.execute('create table pets (name text, age int)'); d.executemany('insert into pets values (?, ?)', [('Rex', 3), ('Tom', None)]); d.commit()"`;

const { browser, errors, signIn } = await launch();
const owner = await signIn("test1@codechatter.local");
const editor = await signIn("test2@codechatter.local");
const a = owner.page;

/** Open the Databases tool and the file's console, looking again until the sandbox has it. */
async function openFile(page) {
  await page.getByRole("button", { name: "Databases", exact: true }).click();
  const section = page.getByRole("region", { name: "Database files" });
  const row = section.getByRole("listitem", { name: file });
  for (let i = 0; i < 10 && !(await row.isVisible()); i++) {
    await section.getByRole("button", { name: "Look for database files again" }).click();
    await row.waitFor({ timeout: 3_000 }).catch(() => {});
  }
  await row.getByRole("button", { name: "Open" }).click();
}

let made = false;
try {
  // An app's database, made in a terminal.
  await a.keyboard.press("Control+`");
  const screen = a.locator(".xterm-rows").last();
  await screen.waitFor({ timeout: 30_000 });
  await a.locator(".xterm").last().click();
  // The shell works the marker out, so only its output has it (the command line shows the sum).
  await a.keyboard.type(`${make} && echo made-$((40+2))\n`);
  check("madeInATerminal", await ok(screen.getByText("made-42").waitFor({ timeout: 30_000 })));
  made = true;

  await openFile(a);
  check("foundAndOpened", await ok(a.getByRole("heading", { name: file }).waitFor({ timeout: 15_000 })));
  const tables = a.getByRole("complementary", { name: "Tables" });
  await tables.getByRole("button", { name: "pets" }).click();
  const results = a.getByRole("region", { name: "Results" });
  check("previewsATable", await ok(results.getByText("2 rows", { exact: true }).waitFor({ timeout: 30_000 })));
  check("showsNulls", (await results.getByRole("cell", { name: "Rex" }).isVisible()) && (await results.getByText("NULL", { exact: true }).isVisible()));
  const box = a.getByRole("textbox", { name: "Query" });
  check("previewQueryToEdit", (await box.inputValue()) === 'select * from "pets" limit 100;', await box.inputValue());

  await box.fill("insert into pets values ('Max', 5);\nselect count(*) as n from pets;");
  await box.press("Control+Enter");
  check("consoleRunsStatements", await ok(results.getByText("1 row changed.").waitFor({ timeout: 30_000 })));
  check("consoleShowsRows", await results.getByRole("cell", { name: "3", exact: true }).isVisible());
  check("noReset", (await a.getByRole("button", { name: "Reset" }).count()) === 0);

  // A backup downloads as SQL; a file from this computer loads into it.
  const [download] = await Promise.all([a.waitForEvent("download"), a.getByRole("link", { name: "Backup" }).click()]);
  const dumped = await readFile(await download.path(), "utf8");
  check("backupDownloads", /\.sql$/.test(download.suggestedFilename()) && dumped.includes("CREATE TABLE pets") && dumped.includes('DROP TABLE IF EXISTS "pets";'), download.suggestedFilename());
  await a.getByLabel("File to load").setInputFiles({ name: "more.sql", mimeType: "application/sql", buffer: Buffer.from("insert into pets values ('Ivy', 2);\n") });
  check("loadsAFile", await ok(results.getByText("Loaded: 1 row changed.").waitFor({ timeout: 30_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "sqlite.png") });

  // The editor finds it and looks inside.
  const b = editor.page;
  await openFile(b);
  await b.getByRole("complementary", { name: "Tables" }).getByRole("button", { name: "pets" }).click();
  check("editorBrowses", await ok(b.getByRole("region", { name: "Results" }).getByText("4 rows", { exact: true }).waitFor({ timeout: 30_000 })));
} catch (error) {
  const shot = join(tmpdir(), "sqlite-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (made) {
    await a.getByRole("button", { name: "Back to databases" }).click().catch(() => {});
    await a.locator(".xterm").last().click();
    await a.keyboard.type(`rm -f ${file} && echo gone-$((40+2))\n`);
    check("testFileDeleted", await ok(a.locator(".xterm-rows").last().getByText("gone-42").waitFor({ timeout: 15_000 })));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
