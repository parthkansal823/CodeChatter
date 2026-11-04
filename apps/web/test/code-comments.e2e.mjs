// Comment threads on code (roadmap §6), with two people in E2ETST. test1 selects a line and presses Ctrl+Alt+M, writes
// a comment and sends it with Ctrl+Enter (which doesn't run the file); test2, on the same file, sees the thread under
// that line and replies. Lines added above move the thread with its code. test1 edits their own message; resolving
// folds it for test2, whose Comments view lists it under Resolved and opens it again. The mark beside the line folds
// and unfolds it. test2 deletes their reply; the file goes, and its thread is removed from Deleted files in Comments.
//   node test/code-comments.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const file = `cmt_${stamp}.py`;
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
const code = (page) => page.locator(".monaco-editor .view-lines:visible").first();
const thread = (page, line) => page.getByRole("group", { name: `Comment thread on line ${line}` });
const anyThread = (page) => page.getByRole("group", { name: /^Comment thread on line/ });
let created = false;

async function openFile(page) {
  const tree = page.getByRole("tree", { name: "Files" });
  if (!(await tree.isVisible())) await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
  await tree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) }).click();
  await page.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
}

async function deleteFile() {
  const tree = a.getByRole("tree", { name: "Files" });
  if (!(await tree.isVisible())) await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
  const item = tree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) });
  await item.focus();
  await item.press("Delete");
  await item.waitFor({ state: "detached", timeout: 10_000 });
  created = false;
}

/** Threads on files that are gone (left by a run that failed), open and resolved. */
async function removeOrphans(page) {
  const view = page.getByRole("region", { name: "Comments" });
  // The Comments button toggles the view; the room's threads arrive a moment after it opens.
  if (!(await view.isVisible())) await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Comments" }).click();
  await view.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1_500);
  for (const tab of [/^Open/, /^Resolved/]) {
    await view.getByRole("button", { name: tab }).click();
    const remove = view.getByRole("group", { name: "Deleted files" }).getByRole("button", { name: /^Remove the thread/ });
    while (await remove.count()) {
      const before = await remove.count();
      await remove.first().click({ force: true });
      await page.waitForFunction(([n]) => document.querySelectorAll('[aria-label^="Remove the thread"]').length < n, [before], { timeout: 5_000 });
    }
  }
  await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
}

try {
  await removeOrphans(a);

  // test1 makes a file.
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  created = true;
  await code(a).click();
  await a.evaluate((text) => navigator.clipboard.writeText(text), "def answer():\n    return 42\n\nprint(answer())\n");
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await code(a).getByText("print(answer())").waitFor({ timeout: 10_000 });

  // Line 2 selected, then Ctrl+Alt+M: a new comment under it.
  await a.keyboard.press("Control+Home");
  await a.keyboard.press("ArrowDown");
  await a.keyboard.press("Home");
  await a.keyboard.press("Shift+End");
  await a.keyboard.press("Control+Alt+m");
  const draft = a.getByRole("group", { name: "New comment on line 2" });
  check("keyStartsAComment", await ok(draft.waitFor({ timeout: 10_000 })));
  await draft.getByLabel("Comment").fill("Why 42?");
  await draft.getByLabel("Comment").press("Control+Enter");
  check("threadUnderItsLine", await ok(thread(a, 2).getByText("Why 42?", { exact: true }).waitFor({ timeout: 10_000 })));
  check("ctrlEnterDidntRun", (await a.getByRole("region", { name: "Output and terminals" }).getByText(/^python3? .*cmt_/).count()) === 0);

  // test2 sees it and replies.
  await openFile(b);
  const theirs = thread(b, 2);
  check("othersSeeIt", await ok(theirs.getByText("Why 42?", { exact: true }).waitFor({ timeout: 15_000 })));
  await theirs.getByLabel("Reply").fill("It's the answer.");
  await theirs.getByLabel("Reply").press("Control+Enter");
  check("replyReachesAuthor", await ok(thread(a, 2).getByText("It's the answer.", { exact: true }).waitFor({ timeout: 10_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "code-comments.png") });

  // Two lines above: the thread moves with its code. (A click in the middle of the editor could land on a card.)
  await code(a).getByText("def answer", { exact: false }).click();
  await a.keyboard.press("Control+Home");
  await a.keyboard.type("import os\n\n");
  check("followsItsCode", await ok(thread(a, 4).waitFor({ timeout: 10_000 })), await anyThread(a).first().getAttribute("aria-label").catch(() => "none"));
  check("othersFollowToo", await ok(thread(b, 4).waitFor({ timeout: 10_000 })));

  // test1 edits their own message (and can't edit test2's).
  const mine = thread(a, 4).getByRole("listitem").filter({ hasText: "Why 42?" });
  await mine.hover();
  await mine.getByRole("button", { name: "Edit your message" }).click();
  // Being edited, the message is a text box (its text isn't the item's any more).
  await thread(a, 4).getByLabel("Your message").fill("Why 42, exactly?");
  await thread(a, 4).getByRole("button", { name: "Save" }).click();
  check("ownMessageEdited", await ok(thread(b, 4).getByText("Why 42, exactly?", { exact: true }).waitFor({ timeout: 10_000 })));
  check("othersNotEditable", (await thread(a, 4).getByRole("listitem").filter({ hasText: "It's the answer." }).getByRole("button", { name: "Edit your message" }).count()) === 0);

  // Resolved: folded for test2, listed under Resolved, and opened again from there.
  await thread(a, 4).getByRole("button", { name: "Resolve" }).click();
  check("resolvedFoldsForOthers", await ok(thread(b, 4).waitFor({ state: "detached", timeout: 10_000 })));
  await b.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Comments" }).click();
  const view = b.getByRole("region", { name: "Comments" });
  await view.getByRole("button", { name: /^Resolved/ }).click();
  const row = view.getByRole("button", { name: /^Line 4: Why 42, exactly\?/ });
  check("listedUnderResolved", await ok(row.waitFor({ timeout: 10_000 })), await view.innerText());
  await row.click();
  check("viewOpensIt", await ok(thread(b, 4).getByText("resolved by", { exact: false }).waitFor({ timeout: 10_000 })));

  // The mark beside the line folds and unfolds it.
  const mark = a.locator(".cc-comment-glyph").first();
  await mark.click();
  check("markFolds", await ok(thread(a, 4).waitFor({ state: "detached", timeout: 5_000 })));
  await mark.click();
  check("markUnfolds", await ok(thread(a, 4).waitFor({ timeout: 5_000 })));
  // test2 deletes their reply.
  const reply = thread(b, 4).getByRole("listitem").filter({ hasText: "It's the answer." });
  await reply.hover();
  await reply.getByRole("button", { name: "Delete your message" }).click();
  check("ownMessageDeleted", await ok(thread(a, 4).getByText("It's the answer.", { exact: true }).waitFor({ state: "detached", timeout: 10_000 })));

  // The file goes; its thread stays in the Comments view under Deleted files, and can be removed there.
  await deleteFile();
  await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Comments" }).click();
  const comments = a.getByRole("region", { name: "Comments" });
  await comments.getByRole("button", { name: /^Resolved/ }).click();
  const orphan = comments.getByRole("group", { name: "Deleted files" }).getByRole("listitem").filter({ hasText: "Why 42, exactly?" });
  check("orphanListed", await ok(orphan.waitFor({ timeout: 10_000 })), await comments.innerText());
  await orphan.hover();
  await orphan.getByRole("button", { name: /^Remove the thread/ }).click();
  check("orphanRemoved", await ok(orphan.waitFor({ state: "detached", timeout: 10_000 })));
} catch (error) {
  const shot = join(tmpdir(), "code-comments-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    if (created) await deleteFile();
    await removeOrphans(a);
    check("cleanedUp", true, file);
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
