// One-click databases from the Databases tool, two people: the owner starts Redis and copies its URL; the
// editor sees it running and how to connect; stopping keeps the data, deleting removes it.
//   node test/databases.e2e.mjs      (from apps/web, with the dev stack running)
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
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
