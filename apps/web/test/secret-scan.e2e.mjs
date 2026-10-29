// The secret scan in the browser (roadmap §6): publishing E2ETST with a file that has an AWS key in it is refused,
// and Source control lists the finding (file and line, kind, the key's ends only); the finding opens the file at
// that line; "Publish anyway" goes past the scan, to GitHub's own refusal: test1 has no GitHub token, so nothing is
// published (the test checks that first and doesn't press it otherwise). The test's file is deleted.
// Commits and gists are covered against a mock GitHub by apps/api/test/source-control.e2e.mjs.
//   node test/secret-scan.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const file = `sec_${stamp}.py`;
const key = ["AKIA", "Z7QK2M4XW9PLR3TB"].join("");
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
let created = false;

try {
  const token = await a.evaluate(() => fetch("/api/me/github").then((r) => r.json()));
  check("noGithubToken", !token?.login, JSON.stringify(token));

  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(file)) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((text) => navigator.clipboard.writeText(text), `REGION = "eu"\nKEY = "${key}"\nprint(REGION)\n`);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(1_000);

  await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Source control" }).click();
  const view = a.getByRole("region", { name: "Source control" });
  await view.getByRole("button", { name: "Publish to GitHub" }).click();
  const notice = view.getByRole("alert", { name: "Secrets found" });
  const shown = await ok(notice.waitFor({ timeout: 20_000 }));
  const text = shown ? await notice.innerText() : "";
  check(
    "findingListed",
    shown && text.includes(`${file}:2`) && text.includes("AWS access key ID") && text.includes("AKIA…R3TB") && /has (a key or password|\d+ keys or passwords) in it/.test(text),
    text || (await view.innerText()),
  );
  check("keyNotShown", !text.includes(key));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "secret-scan.png") });

  // The finding opens the file at its line.
  await a.keyboard.press("Control+End");
  await notice.getByRole("button", { name: new RegExp(`^${escape(file)}:2`) }).click();
  const status = a.getByText(/^Ln \d+, Col \d+$/);
  check("opensAtLine", await ok(a.getByText("Ln 2, Col 1", { exact: true }).waitFor({ timeout: 10_000 })), await status.innerText().catch(() => "(no status)"));

  // Going ahead passes the scan; without a token GitHub's step refuses, so nothing is published.
  if (!token?.login) {
    await notice.getByRole("button", { name: "Publish anyway" }).click();
    const refusal = view.getByRole("alert").filter({ hasText: /GitHub token/ });
    check("goAheadPassesTheScan", await ok(refusal.waitFor({ timeout: 20_000 })), await view.innerText());
    check("noticeGone", (await notice.count()) === 0);
  }
} catch (error) {
  const shot = join(tmpdir(), "secret-scan-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      const tree = a.getByRole("tree", { name: "Files" });
      if (!(await tree.isVisible())) await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(file)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
      check("testFileDeleted", true, file);
    } catch (error) {
      check("testFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
