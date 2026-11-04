// Time travel (roadmap §6), with two people in E2ETST. test1 saves a named checkpoint, then changes a file and adds
// another: History lists both as differences from now, and the changed one opens as a diff with the checkpoint's
// text. Restoring that file puts its text back (after a "Before restoring" checkpoint); Restore all takes the new file
// away. test2, with History open, sees test1's new checkpoint arrive (collab says the list changed). The test's
// files and its named checkpoint are deleted.
//   node test/history.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const changed = `hist_${stamp}.txt`;
const added = `hist2_${stamp}.txt`;
const name = `e2e ${stamp}`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const one = await signIn("test1@codechatter.local");
const a = one.page;
await one.context.grantPermissions(["clipboard-read", "clipboard-write"]);
const { page: b } = await signIn("test2@codechatter.local");
const created = [];
const tree = a.getByRole("tree", { name: "Files" });
const history = (page) => page.getByRole("region", { name: "History" });
const panels = (page) => page.getByRole("navigation", { name: "Panels" });
const code = a.locator(".monaco-editor .view-lines:visible").first();

async function newFile(fileName, text) {
  if (!(await tree.isVisible())) await panels(a).getByRole("button", { name: "Files", exact: true }).click();
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(fileName);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(fileName)) }).waitFor({ timeout: 15_000 });
  created.push(fileName);
  await setText(text);
}
async function setText(text) {
  await code.click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(800);
}
const editorText = () => code.innerText();

try {
  await newFile(changed, "one\n");

  // test2 watches History.
  await panels(b).getByRole("button", { name: "History" }).click();
  await history(b).getByRole("list", { name: "Checkpoints" }).waitFor({ timeout: 15_000 });

  // test1 saves a named checkpoint.
  await panels(a).getByRole("button", { name: "History" }).click();
  const view = history(a);
  await view.getByRole("button", { name: "Save a checkpoint" }).click();
  await view.getByLabel("New checkpoint's name").fill(name);
  await view.getByRole("button", { name: "Save checkpoint" }).click();
  const selected = view.getByRole("group", { name: "Selected checkpoint" });
  check("checkpointSaved", await ok(selected.getByText(name, { exact: true }).waitFor({ timeout: 15_000 })), await view.innerText());
  check("sameAsNow", await ok(view.getByText("The files are the same as now.").waitFor({ timeout: 10_000 })));
  check(
    "othersSeeIt",
    await ok(history(b).getByRole("list", { name: "Checkpoints" }).getByRole("button", { name: new RegExp(escape(name)) }).waitFor({ timeout: 10_000 })),
  );

  // A change and a new file: both differ from the checkpoint.
  await a.getByRole("tab", { name: new RegExp(escape(changed)) }).click();
  await setText("two\n");
  await newFile(added, "new\n");
  await panels(a).getByRole("button", { name: "History" }).click();
  const differences = view.getByRole("list", { name: "Differences from now" });
  const changedRow = differences.getByRole("button", { name: `${changed}, changed since` });
  const addedRow = differences.getByRole("button", { name: `${added}, added since` });
  check("differencesListed", (await ok(changedRow.waitFor({ timeout: 10_000 }))) && (await ok(addedRow.waitFor({ timeout: 5_000 }))), await view.innerText());

  // The changed file as a diff: the checkpoint's text on the left.
  await changedRow.click();
  const diff = a.getByRole("region", { name: `Changes to ${changed}` });
  check("diffOpens", (await ok(diff.waitFor({ timeout: 10_000 }))) && (await diff.innerText()).includes(name), await diff.innerText().catch(() => ""));
  check("diffShowsBoth", await ok(diff.locator(".original .view-lines").getByText("one").waitFor({ timeout: 10_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "history.png") });
  await diff.getByRole("button", { name: "Close the comparison" }).click();

  // Restore that file: its text comes back, after a checkpoint of the files as they were.
  await view.getByRole("button", { name: `Restore ${changed}` }).click();
  const before = view.getByRole("list", { name: "Checkpoints" }).getByRole("button", { name: new RegExp(`^Before restoring “${escape(name)}”`) });
  check("savedBeforeRestore", await ok(before.first().waitFor({ timeout: 10_000 })));
  await a.getByRole("tab", { name: new RegExp(escape(changed)) }).click();
  check("fileRestored", await ok(code.getByText("one", { exact: true }).waitFor({ timeout: 10_000 })), await editorText().catch(() => ""));
  // The room's files are read again a moment after an edit.
  check("addedStillDiffers", (await ok(changedRow.waitFor({ state: "detached", timeout: 5_000 }))) && (await addedRow.count()) === 1, await view.innerText());

  // Restore all: the new file goes.
  await view.getByRole("button", { name: /^Restore all/ }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Restore" }).click();
  check("restoreAllRemovesAdded", await ok(view.getByText("The files are the same as now.").waitFor({ timeout: 10_000 })));
  await panels(a).getByRole("button", { name: "Files", exact: true }).click();
  check("addedFileGone", await ok(tree.getByRole("treeitem", { name: new RegExp(`^${escape(added)}`) }).waitFor({ state: "detached", timeout: 10_000 })));
  created.splice(created.indexOf(added), 1);

  // The state route: the API serves the checkpoint for the browser to read.
  const listed = await a.evaluate(() => fetch(location.pathname.replace("/rooms/", "/api/rooms/") + "/checkpoints").then((r) => r.json()));
  const mine = listed.checkpoints?.find((c) => c.label === name);
  check("listedByApi", mine?.kind === "manual" && mine.by?.name && mine.size > 0, JSON.stringify(mine));
} catch (error) {
  const shot = join(tmpdir(), "history-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    // The named checkpoint, then the files.
    const view = history(a);
    if (!(await view.isVisible())) await panels(a).getByRole("button", { name: "History" }).click();
    const named = view.getByRole("list", { name: "Checkpoints" }).getByRole("button", { name: new RegExp(`^${escape(name)}`) });
    if (await named.count()) {
      if ((await named.getAttribute("aria-pressed")) !== "true") await named.click();
      await view.getByRole("button", { name: "Delete the checkpoint" }).click();
      await named.waitFor({ state: "detached", timeout: 10_000 });
    }
    await panels(a).getByRole("button", { name: "Files", exact: true }).click();
    for (const fileName of created) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(fileName)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("cleanedUp", true, [name, ...created].join(", "));
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
