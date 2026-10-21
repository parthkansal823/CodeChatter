// The Source Control view (roadmap §14 E) in a room made from octocat/Spoon-Knife, against real GitHub and without
// a token: the room's changes (changed, added, deleted) appear as they're made, each opens as a diff with GitHub's
// version, Discard puts a file back, Pull says it's up to date, Commit needs a token, branches can't be switched
// with changes, and switching to test-branch brings in its file and reaches a second tab of the room too.
// Commits and merges are covered against a mock GitHub by apps/api/test/source-control.e2e.mjs. The room is
// deleted at the end.
//   node test/source-control.e2e.mjs        (from apps/web, with the dev stack running and internet access)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let roomId = null;

try {
  const created = await a.evaluate(() =>
    fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Source control check", repo: { owner: "octocat", name: "Spoon-Knife" } }),
    }).then((r) => r.json()),
  );
  roomId = created.id;
  const commit = created.imported.commit.slice(0, 7);
  await a.goto(`${BASE}/rooms/${roomId}`);
  const tree = a.getByRole("tree", { name: "Files" });
  await tree.getByRole("treeitem", { name: /^index\.html/ }).waitFor({ timeout: 30_000 });

  await a.getByRole("button", { name: "Source control" }).click();
  const view = a.getByRole("region", { name: "Source control" });
  check("viewShowsRepo", await ok(view.getByText("octocat/Spoon-Knife").waitFor({ timeout: 10_000 })));
  check("noChangesYet", await ok(view.getByText(`No changes since ${commit}.`).waitFor({ timeout: 15_000 })));
  check("commitNeedsToken", await ok(view.getByText(/To commit, add a GitHub token/).waitFor({ timeout: 2_000 })) && (await view.getByRole("button", { name: /^Commit and push/ }).isDisabled()));

  // Change a file, add one and delete one: all three are listed.
  const filesButton = a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true });
  await filesButton.click();
  await tree.getByRole("treeitem", { name: /^index\.html/ }).click();
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Home");
  await a.keyboard.insertText("<!-- edited in the room -->\n");
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill("notes.txt");
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: /notes\.txt/ }).waitFor({ timeout: 10_000 });
  const readme = tree.getByRole("treeitem", { name: /^README\.md/ });
  await readme.focus();
  await readme.press("Delete");
  await readme.waitFor({ state: "detached", timeout: 10_000 });

  await a.getByRole("button", { name: "Source control" }).click();
  const changes = view.getByRole("list", { name: "Changes" });
  const row = (label) => changes.getByRole("button", { name: label, exact: true });
  const listed = await Promise.all(
    ["index.html, changed", "notes.txt, added", "README.md, deleted"].map((label) => ok(row(label).waitFor({ timeout: 10_000 }))),
  );
  check("changesListed", listed.every(Boolean), listed.join(","));
  check("commitCount", await ok(view.getByRole("button", { name: "Commit and push (3)" }).waitFor({ timeout: 3_000 })));

  await row("index.html, changed").click();
  const diff = a.getByRole("region", { name: "Changes to index.html" });
  check("diffOpens", await ok(diff.locator(".monaco-diff-editor").waitFor({ timeout: 10_000 })));
  check("diffShowsEdit", await ok(diff.locator(".monaco-diff-editor .modified .view-lines", { hasText: "edited in the room" }).waitFor({ timeout: 10_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "source-control.png") });
  await diff.getByRole("button", { name: "Close the comparison" }).click();

  // Switching branches waits for the changes to be committed or discarded.
  check("switchBlockedWithChanges", await view.getByRole("combobox", { name: "Branch" }).isDisabled());
  await a.getByRole("button", { name: "Pull from GitHub" }).click();
  check("pullUpToDate", await ok(a.getByText("Up to date with main on GitHub").waitFor({ timeout: 20_000 })));

  for (const path of ["index.html", "notes.txt", "README.md"]) {
    const item = changes.getByRole("listitem").filter({ has: a.getByRole("button", { name: new RegExp(`^${path.replace(".", "\\.")}, `) }) });
    await item.hover();
    await item.getByRole("button", { name: `Discard changes to ${path}` }).click();
  }
  check("discarded", await ok(view.getByText(`No changes since ${commit}.`).waitFor({ timeout: 10_000 })));
  await filesButton.click();
  check("readmeBack", await ok(tree.getByRole("treeitem", { name: /^README\.md/ }).waitFor({ timeout: 5_000 })) && (await tree.getByRole("treeitem", { name: /^notes\.txt/ }).count()) === 0);
  await a.getByRole("button", { name: "Source control" }).click();

  // A second tab of the room, as someone else in it would be.
  const b = await a.context().newPage();
  await b.goto(`${BASE}/rooms/${roomId}`);
  await b.getByRole("tree", { name: "Files" }).waitFor({ timeout: 30_000 });
  await b.keyboard.press("Control+Shift+G");
  const viewB = b.getByRole("region", { name: "Source control" });
  check("ctrlShiftG", await ok(viewB.getByText("octocat/Spoon-Knife").waitFor({ timeout: 10_000 })));

  await view.getByRole("combobox", { name: "Branch" }).click();
  await a.getByRole("option", { name: "test-branch" }).click();
  check("switched", await ok(a.getByText(/^Switched to test-branch/).waitFor({ timeout: 30_000 })));
  check("noChangesAfterSwitch", await ok(view.getByText(/^No changes since [0-9a-f]{7}\.$/).waitFor({ timeout: 10_000 })));
  check("otherTabFollows", await ok(viewB.getByRole("combobox", { name: "Branch" }).filter({ hasText: "test-branch" }).waitFor({ timeout: 10_000 })));
  check("otherTabNoChanges", await ok(viewB.getByText(/^No changes since [0-9a-f]{7}\.$/).waitFor({ timeout: 10_000 })));
  await filesButton.click();
  check("branchFileArrived", await ok(tree.getByRole("treeitem", { name: /^test\.md/ }).waitFor({ timeout: 10_000 })));
  await b.close();
} catch (error) {
  const shot = join(tmpdir(), "source-control-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (roomId) {
    const status = await a.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }).then((r) => r.status), roomId);
    check("roomDeleted", status === 204, String(status));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
