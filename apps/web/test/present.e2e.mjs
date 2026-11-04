// Present mode (roadmap §6), with two people in E2ETST. test1 presents: test2 follows at once, their editor opens
// test1's file and keeps test1's scroll (line 150 of a long file comes into view), and test1 sees who follows. test1
// moves to another file and test2 goes too. test2 stops following and stays where they are while test1 moves; Follow
// takes them back. When test1 stops presenting, test2 stops following. The test's files are deleted.
//   node test/present.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const long = `pres_${stamp}.txt`;
const other = `pres2_${stamp}.txt`;
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
const banner = (page) => page.getByRole("status").filter({ hasText: /presenting|Following/ });
const activeTab = (page, name) => page.getByRole("tab", { name: new RegExp(escape(name)), selected: true });
const created = [];

async function newFile(name, text) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await code(a).click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(800);
}
const openTab = (page, name) => page.getByRole("tab", { name: new RegExp(escape(name)) }).click();

try {
  await newFile(other, "the other file\n");
  await newFile(long, Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");

  // test1 presents.
  const present = a.getByRole("button", { name: "Present", exact: true });
  await present.click();
  check("presentPressed", (await a.getByRole("button", { name: "Presenting", exact: true }).getAttribute("aria-pressed")) === "true");
  check("othersFollowAtOnce", await ok(banner(b).getByText("test1 is presenting: their file and scroll follow here.").waitFor({ timeout: 15_000 })), await banner(b).innerText().catch(() => "(no banner)"));
  check("presentersFileOpens", await ok(activeTab(b, long).waitFor({ timeout: 15_000 })));
  check("presenterSeesFollowers", await ok(banner(a).getByText(/test2 follows your file and scroll/).waitFor({ timeout: 10_000 })), await banner(a).innerText().catch(() => ""));

  // test1 goes to line 150: test2's editor scrolls there too.
  await code(a).click();
  await a.keyboard.press("Control+g");
  await a.keyboard.type("150");
  await a.keyboard.press("Enter");
  check("scrollFollows", await ok(code(b).getByText("line 150", { exact: true }).waitFor({ timeout: 10_000 })));
  await b.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "present.png") });

  // test1 moves to the other file: test2 goes too.
  await openTab(a, other);
  check("fileFollows", await ok(activeTab(b, other).waitFor({ timeout: 10_000 })));

  // test2 stops following: test1 moving doesn't take them along, and the same presentation doesn't pull them back.
  await banner(b).getByRole("button", { name: "Stop following" }).click();
  check("optedOut", await ok(banner(b).getByText("test1 is presenting.", { exact: true }).waitFor({ timeout: 5_000 })));
  await openTab(a, long);
  await b.waitForTimeout(2_000);
  check("staysWhenOptedOut", (await activeTab(b, other).count()) === 1 && (await activeTab(b, long).count()) === 0);

  // Follow takes them back.
  await banner(b).getByRole("button", { name: "Follow" }).click();
  check("followAgain", await ok(activeTab(b, long).waitFor({ timeout: 10_000 })));

  // test1 stops presenting: test2 stops following.
  await a.getByRole("button", { name: "Presenting", exact: true }).click();
  check("endLetsGo", await ok(banner(b).waitFor({ state: "detached", timeout: 10_000 })));
  check("presenterBannerGone", (await banner(a).count()) === 0);
} catch (error) {
  const shot = join(tmpdir(), "present-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    if (await a.getByRole("button", { name: "Presenting", exact: true }).count()) await a.getByRole("button", { name: "Presenting", exact: true }).click();
    const tree = a.getByRole("tree", { name: "Files" });
    for (const name of created) {
      const item = tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await item.focus();
      await item.press("Delete");
      await item.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("cleanedUp", true, created.join(", "));
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
