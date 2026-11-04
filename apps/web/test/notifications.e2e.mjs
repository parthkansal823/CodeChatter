// Notifications and activity (roadmap §5), with two people in E2ETST. test1 mentions "@test2" in chat: test2's bell
// counts it and a message says so; opening it marks it read. test2 replies on test1's code comment: test1 hears of it,
// with the file and line. The Activity panel shows who edited what. Both inboxes end read; the test's file and thread go.
//   node test/notifications.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const file = `ntf_${stamp}.py`;
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
const readAll = (page) => page.evaluate(() => fetch("/api/me/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) }));
const bell = (page) => page.getByRole("button", { name: /^Notifications/ }).first();
const inbox = (page) => page.getByRole("list", { name: "Notifications" });
const code = (page) => page.locator(".monaco-editor .view-lines:visible").first();
const thread = (page) => page.getByRole("group", { name: /^Comment thread on line/ }).first();
let created = false;

try {
  await readAll(a);
  await readAll(b);
  await a.reload();
  await b.reload();
  await a.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await b.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  check("startsRead", (await bell(b).getAttribute("aria-label")) === "Notifications", await bell(b).getAttribute("aria-label"));

  // A mention in chat.
  await a.getByRole("button", { name: "Chat", exact: true }).click();
  await a.getByRole("textbox", { name: "Message", exact: true }).fill(`@test2 can you look at this? ${stamp}`);
  await a.getByRole("button", { name: "Send message" }).click();
  check("bellCounts", await ok(b.getByRole("button", { name: "Notifications, 1 unread" }).first().waitFor({ timeout: 15_000 })));
  check("liveMessage", await ok(b.getByText(`test1 mentioned you in Automated tests: “@test2 can you look at this? ${stamp}”`).first().waitFor({ timeout: 5_000 })));
  await bell(b).click();
  const mention = inbox(b).getByRole("button", { name: new RegExp(`mentioned you.*${stamp}`) });
  check("listed", await ok(mention.waitFor({ timeout: 5_000 })));
  await b.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "notifications.png") });
  await mention.click();
  check("openingMarksRead", await ok(b.getByRole("button", { name: "Notifications", exact: true }).first().waitFor({ timeout: 10_000 })));

  // A reply on test1's code comment.
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  created = true;
  await code(a).click();
  await a.evaluate((text) => navigator.clipboard.writeText(text), "answer = 42\n");
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await code(a).getByText("answer").waitFor({ timeout: 10_000 });
  await a.keyboard.press("Control+Home");
  await a.keyboard.press("Control+Alt+m");
  const draft = a.getByRole("group", { name: "New comment on line 1" });
  await draft.getByLabel("Comment").fill("Is 42 right?");
  await draft.getByLabel("Comment").press("Control+Enter");
  await thread(a).waitFor({ timeout: 10_000 });
  await b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) }).click();
  await thread(b).getByLabel("Reply").fill(`Yes ${stamp}`);
  await thread(b).getByLabel("Reply").press("Control+Enter");
  check("replyNotified", await ok(a.getByRole("button", { name: "Notifications, 1 unread" }).first().waitFor({ timeout: 15_000 })));
  await bell(a).click();
  check("replyNamesFileAndLine", await ok(inbox(a).getByText(`test2 replied on ${file}:1 in Automated tests: “Yes ${stamp}”`).waitFor({ timeout: 5_000 })));
  await a.keyboard.press("Escape");

  // The Activity panel.
  await a.getByRole("button", { name: "Activity", exact: true }).click();
  const activity = a.getByRole("region", { name: "Activity" });
  check("activityShowsEdits", await ok(activity.getByText(/edited the code/).first().waitFor({ timeout: 15_000 })), await activity.innerText().catch(() => ""));
} catch (error) {
  const shot = join(tmpdir(), "notifications-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    // The file, then its thread (under Deleted files in Comments).
    if (created) {
      const tree = a.getByRole("tree", { name: "Files" });
      if (!(await tree.isVisible())) await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
      const item = tree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) });
      await item.focus();
      await item.press("Delete");
      await item.waitFor({ state: "detached", timeout: 10_000 });
    }
    await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Comments" }).click();
    const comments = a.getByRole("region", { name: "Comments" });
    const remove = comments.getByRole("group", { name: "Deleted files" }).getByRole("button", { name: /^Remove the thread/ });
    await remove.first().waitFor({ timeout: 10_000 });
    while (await remove.count()) {
      const left = await remove.count();
      await remove.first().click({ force: true });
      await a.waitForFunction((n) => document.querySelectorAll('[aria-label^="Remove the thread"]').length < n, left, { timeout: 5_000 });
    }
    await readAll(a);
    await readAll(b);
    check("cleanedUp", true, file);
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
