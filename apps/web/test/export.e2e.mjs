// Exporting a room to GitHub (roadmap §14 E). A room that isn't on GitHub shows Publish in the Source Control view,
// with a name from the room's; without a token the API says so. Then, with the room's GitHub routes answered here
// (page.route) so nothing is written to GitHub: publishing sends every file of the room, and the view becomes the
// linked repository's; a file shared as a gist sends its name and text and shows the gist's link. The API side is
// covered against a mock GitHub by apps/api/test/source-control.e2e.mjs. The room is deleted at the end.
//   node test/export.e2e.mjs        (from apps/web, with the dev stack running)
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
const stamp = Date.now().toString(36);
const commit = "e".repeat(40);

try {
  const created = await page.evaluate((name) => fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json()), `Export Check ${stamp}`);
  roomId = created.id;
  await page.goto(`${BASE}/rooms/${roomId}`);
  const tree = page.getByRole("tree", { name: "Files" });
  await tree.getByRole("treeitem", { name: /^README\.md/ }).waitFor({ timeout: 30_000 });

  await page.keyboard.press("Control+Shift+G");
  const view = page.getByRole("region", { name: "Source control" });
  check("publishOffered", await ok(view.getByRole("button", { name: "Publish to GitHub" }).waitFor({ timeout: 10_000 })));
  check("nameFromRoom", (await view.getByLabel("Repository name").inputValue()) === `export-check-${stamp}`);
  check("privateByDefault", (await view.getByRole("checkbox").getAttribute("aria-checked")) === "true");
  await view.getByRole("button", { name: "Publish to GitHub" }).click();
  check("noTokenSaysSo", await ok(view.getByRole("alert").filter({ hasText: /Add a GitHub token in Settings to publish/ }).waitFor({ timeout: 10_000 })));

  // From here GitHub's side is answered here.
  const sent = {};
  let published = false;
  await page.route(`**/api/rooms/${roomId}/repo**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(`/api/rooms/${roomId}/repo`, "");
    if (path === "/publish") {
      sent.publish = request.postDataJSON();
      published = true;
      return route.fulfill({ status: 201, json: { repo: `tester/${sent.publish.name}`, url: `https://github.com/tester/${sent.publish.name}`, branch: "main", commit } });
    }
    if (path === "/gist") {
      sent.gist = request.postDataJSON();
      return route.fulfill({ status: 201, json: { url: "https://gist.github.com/tester/abc123" } });
    }
    if (path === "" && published) {
      return route.fulfill({ json: { owner: "tester", name: sent.publish.name, branch: "main", defaultBranch: "main", commit, syncedAt: new Date().toISOString(), login: "tester", webhook: false } });
    }
    if (path === "/files" && published) return route.fulfill({ json: sent.publish.files });
    return route.fallback();
  });

  await view.getByLabel("Repository name").fill(`exported-${stamp}`);
  await view.getByRole("button", { name: "Publish to GitHub" }).click();
  check("linkedAfterPublish", await ok(view.getByText(`tester/exported-${stamp}`).waitFor({ timeout: 10_000 })));
  check("noChangesAfterPublish", await ok(view.getByText(`No changes since ${commit.slice(0, 7)}.`).waitFor({ timeout: 10_000 })));
  check(
    "sentTheRoomsFiles",
    sent.publish?.private === true && sent.publish.files.length === 1 && sent.publish.files[0].path === "README.md" && sent.publish.files[0].content.startsWith("# New room"),
    JSON.stringify(sent.publish),
  );
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "export.png") });

  // The open file as a gist, from the palette.
  await page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
  await tree.getByRole("treeitem", { name: /^README\.md/ }).click();
  await page.locator(".monaco-editor .view-lines").first().waitFor({ timeout: 10_000 });
  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Command palette" }).waitFor({ timeout: 5_000 });
  await page.keyboard.type("Share the file as a GitHub gist");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Share README.md as a gist" });
  check("gistDialog", await ok(dialog.waitFor({ timeout: 5_000 })));
  check("secretByDefault", (await dialog.getByRole("radio", { name: "Secret (link only)" }).getAttribute("aria-checked")) === "true");
  await dialog.getByLabel("Gist description").fill("Our readme");
  await dialog.getByRole("button", { name: "Make gist" }).click();
  check("gistLink", await ok(dialog.getByRole("link", { name: "https://gist.github.com/tester/abc123" }).waitFor({ timeout: 5_000 })));
  check("gistSent", sent.gist?.name === "README.md" && sent.gist.content.startsWith("# New room") && sent.gist.public === false && sent.gist.description === "Our readme", JSON.stringify(sent.gist));
  await page.keyboard.press("Escape");
} catch (error) {
  const shot = join(tmpdir(), "export-failed.png");
  await page.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (roomId) {
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    const status = await page.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }).then((r) => r.status), roomId);
    check("roomDeleted", status === 204, String(status));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
