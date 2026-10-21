// Importing a GitHub repository into a new room (roadmap §14 E), against real GitHub: the /new?repo= link opens
// New room on GitHub with the repository filled in, the room is named after it and starts with its files (and the
// sandbox gets them), a repository that doesn't exist and text that isn't one are refused without making a room,
// and Settings refuses a token GitHub doesn't accept. Uses octocat/Spoon-Knife (three small files); the room it
// makes is deleted at the end.
//   node test/github-import.e2e.mjs        (from apps/web, with the dev stack running and internet access)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
let roomId = null;
const roomCount = () => page.evaluate(() => fetch("/api/rooms").then((r) => r.json()).then((rooms) => rooms.length));

try {
  // The "Open in CodeChatter" link.
  await page.goto(`${BASE}/new?repo=${encodeURIComponent("https://github.com/octocat/Spoon-Knife")}`);
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.waitFor({ timeout: 15_000 });
  check("linkOpensNewRoom", page.url().includes("/dashboard?repo="), page.url());
  check("githubChosen", (await dialog.getByRole("radio", { name: "GitHub" }).getAttribute("aria-checked")) === "true");
  check("repoFilledIn", (await dialog.getByLabel("Repository").inputValue()).includes("octocat/Spoon-Knife"));
  check("repoRead", await ok(dialog.getByText("github.com/octocat/Spoon-Knife, its default branch").waitFor({ timeout: 3_000 })));

  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "github-form.png") });
  const before = await roomCount();
  await dialog.getByRole("button", { name: "Import and create" }).click();
  await page.getByRole("heading", { name: "Spoon-Knife is ready" }).waitFor({ timeout: 90_000 });
  roomId = /Room code (\w{6})/.exec(await page.getByRole("dialog").innerText())?.[1] ?? null;
  const note = await page.getByRole("dialog").getByRole("status").innerText();
  check("importedNote", /Imported 3 files from octocat\/Spoon-Knife \(main, [0-9a-f]{7}\)/.test(note), note);
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "github-imported.png") });

  // The room starts with the repository's files, and its sandbox gets them.
  await page.getByRole("button", { name: "Open room" }).click();
  const tree = page.getByRole("tree", { name: "Files" });
  await tree.waitFor({ timeout: 30_000 });
  const names = ["index.html", "styles.css", "README.md"];
  const shown = await Promise.all(names.map((name) => ok(tree.getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) }).waitFor({ timeout: 15_000 }))));
  check("filesInRoom", shown.every(Boolean), names.filter((_, i) => !shown[i]).join(", "));
  await tree.getByRole("treeitem", { name: /^index\.html/ }).click();
  check("fileText", await ok(page.locator(".monaco-editor .view-lines", { hasText: "Spoon-Knife" }).first().waitFor({ timeout: 15_000 })));

  // Refused: a repository that isn't there, and text that isn't one. Neither makes a room.
  await page.goto(`${BASE}/dashboard`);
  check("listedWithRepo", await ok(page.getByRole("row", { name: new RegExp(`${roomId}.*octocat/Spoon-Knife`) }).waitFor({ timeout: 10_000 })));
  await page.getByRole("button", { name: "New room" }).first().click();
  const form = page.getByRole("dialog", { name: "New room" });
  await form.getByRole("radio", { name: "GitHub" }).click();
  await form.getByLabel("Repository").fill("not a repository");
  await form.getByRole("button", { name: "Import and create" }).click();
  check("refusesText", await ok(form.getByText("Enter a repository as owner/name, or paste its GitHub link.").waitFor({ timeout: 3_000 })));
  await form.getByLabel("Repository").fill(`octocat/no-such-repo-${Date.now().toString(36)}`);
  await form.getByRole("button", { name: "Import and create" }).click();
  check("refusesMissing", await ok(form.getByText(/^No public repository octocat\/no-such-repo-\w+\. For a private one, add a GitHub token in Settings first\.$/).waitFor({ timeout: 30_000 })));
  check("noRoomMade", (await roomCount()) === before + 1, `${before} then ${await roomCount()}`);
  await page.keyboard.press("Escape");

  // Settings: GitHub checks a token before it's kept.
  await page.goto(`${BASE}/settings`);
  await page.getByRole("heading", { name: "GitHub" }).waitFor({ timeout: 15_000 });
  await page.getByLabel("Personal access token").fill(`ghp_${"x".repeat(36)}`);
  await page.getByRole("button", { name: "Save" }).click();
  check("badTokenRefused", await ok(page.getByText("GitHub didn't accept that token. Check it hasn't expired, or make a new one.").waitFor({ timeout: 20_000 })));
  await page.getByLabel("Personal access token").fill("this is not a github token, it has spaces");
  await page.getByRole("button", { name: "Save" }).click();
  check("malformedTokenRefused", await ok(page.getByText("That isn't a GitHub token. Copy it again from GitHub.").waitFor({ timeout: 5_000 })));
  const connection = await page.evaluate(() => fetch("/api/me/github").then((r) => r.json()));
  check("nothingSaved", connection.login === null, JSON.stringify(connection));
} catch (error) {
  const shot = join(tmpdir(), "github-import-failed.png");
  await page.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (roomId) {
    const status = await page.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }).then((r) => r.status), roomId);
    check("roomDeleted", status === 204, String(status));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
