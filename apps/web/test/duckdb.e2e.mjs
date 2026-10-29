// DuckDB over the room's data files, as people would use it: the owner writes a CSV file in E2ETST's editor, opens
// the room's data files from the Databases tool, finds the CSV among them, previews it, and groups it with SQL; a
// mistake shows DuckDB's words. Backup and Load aren't offered there. The test's file is deleted.
//   node test/duckdb.e2e.mjs      (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const file = `sales_${Date.now().toString(36)}.csv`;

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let created = false;

try {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText("region,amount\nnorth,10\nsouth,5\nnorth,7\n");

  await a.getByRole("button", { name: "Databases", exact: true }).click();
  const row = a.getByRole("region", { name: "Database files" }).getByRole("listitem", { name: "The room's data files" });
  await row.getByRole("button", { name: "Open" }).click({ timeout: 30_000 });
  check("opened", await ok(a.getByRole("heading", { name: "The room's data files" }).waitFor({ timeout: 15_000 })));

  // The file reaches the sandbox a moment after it's written: look again until it's listed.
  const list = a.getByRole("complementary", { name: "Data files" });
  const entry = list.getByRole("button", { name: new RegExp(escape(file)) });
  for (let i = 0; i < 15 && !(await entry.isVisible()); i++) {
    await list.getByRole("button", { name: "Refresh data files" }).click();
    await entry.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await entry.click();
  const results = a.getByRole("region", { name: "Results" });
  check("previewsTheCsv", await ok(results.getByText("3 rows", { exact: true }).waitFor({ timeout: 30_000 })));
  const box = a.getByRole("textbox", { name: "Query" });
  check("previewQueryByPath", (await box.inputValue()) === `select * from '${file}' limit 100;`, await box.inputValue());

  await box.fill(`select region, sum(amount) as total from '${file}' group by region order by region;`);
  await box.press("Control+Enter");
  check("groupsWithSql", await ok(results.getByRole("cell", { name: "17", exact: true }).waitFor({ timeout: 30_000 })));
  check("twoGroups", (await results.getByText("2 rows", { exact: true }).isVisible()) && (await results.getByRole("cell", { name: "south" }).isVisible()));
  await box.fill(`select nope from '${file}';`);
  await box.press("Control+Enter");
  check("mistakesExplained", await ok(results.getByText(/Binder Error/).waitFor({ timeout: 30_000 })));
  check("noBackupOrLoad", (await a.getByRole("link", { name: "Backup" }).count()) === 0 && (await a.getByRole("button", { name: "Load a file" }).count()) === 0);
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "duckdb.png") });
} catch (error) {
  const shot = join(tmpdir(), "duckdb-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      // The Files view is already showing (the button would hide it), unless something else is.
      const tree = a.getByRole("tree", { name: "Files" });
      if (!(await tree.isVisible())) await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
      const node = tree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) });
      await node.focus();
      await node.press("Delete");
      await node.waitFor({ state: "detached", timeout: 10_000 });
      check("testFileDeleted", true);
    } catch (error) {
      check("testFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
