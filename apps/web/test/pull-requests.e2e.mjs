// Pull requests in the room (roadmap §14 E). First real GitHub, through the API: octocat/Spoon-Knife's open pull
// requests list, and one opens with its files' patches. Then the review UI, with the room's pull request routes
// answered by the browser (page.route) so nothing is written to GitHub: the list, a pull request's diff with line
// numbers and its comment thread, a new comment on a line and a reply (checked as sent), and opening a pull request
// from the room's branch. The API side of commenting and opening is covered against a mock GitHub by
// apps/api/test/source-control.e2e.mjs. The room is deleted at the end.
//   node test/pull-requests.e2e.mjs        (from apps/web, with the dev stack running and internet access)
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

const head = "c".repeat(40);
const detail = {
  number: 7,
  title: "Brighter heading",
  author: "octo-friend",
  head: "feature/brighter",
  base: "main",
  draft: false,
  url: "https://github.com/octocat/Spoon-Knife/pull/7",
  updatedAt: "2026-10-20T10:00:00Z",
  body: "Makes the heading stand out.",
  state: "open",
  merged: false,
  headSha: head,
  files: [
    { path: "index.html", previousPath: null, status: "modified", additions: 2, deletions: 1, patch: "@@ -1,3 +1,4 @@\n <html>\n-<h1>Hi</h1>\n+<h1 class=\"big\">Hi</h1>\n+<p>New</p>\n </html>" },
    { path: "logo.png", previousPath: null, status: "added", additions: 0, deletions: 0, patch: null },
  ],
  comments: [{ id: 501, path: "index.html", line: 2, side: "RIGHT", body: "Why big?", author: "reviewer", createdAt: "2026-10-20T11:00:00Z", inReplyTo: null, url: "https://github.com/x" }],
};

try {
  const created = await page.evaluate(() =>
    fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Pull requests check", repo: { owner: "octocat", name: "Spoon-Knife" } }),
    }).then((r) => r.json()),
  );
  roomId = created.id;

  // Real GitHub, through the API.
  const real = await page.evaluate(async (id) => {
    const { pulls } = await fetch(`/api/rooms/${id}/repo/pulls`).then((r) => r.json());
    const first = pulls?.[0];
    const one = first ? await fetch(`/api/rooms/${id}/repo/pulls/${first.number}`).then((r) => r.json()) : null;
    return { count: pulls?.length ?? 0, first, files: one?.files?.length ?? -1, patch: one?.files?.find((f) => f.patch)?.patch?.slice(0, 2) ?? null, base: one?.base };
  }, roomId);
  check("realPullsListed", real.count > 0 && typeof real.first?.title === "string" && real.first.base === "main", JSON.stringify(real.first));
  check("realPullDetail", real.files >= 0 && real.base === "main" && (real.files === 0 || real.patch === "@@"), JSON.stringify(real));

  // From here the room's pull request routes are answered here; the room is shown on a branch of its own.
  const sent = [];
  let opened = false;
  await page.route(`**/api/rooms/${roomId}/repo`, async (route) => {
    const response = await route.fetch();
    const info = await response.json();
    await route.fulfill({ response, json: { ...info, branch: "feature/room", defaultBranch: "main", login: "tester" } });
  });
  await page.route(`**/api/rooms/${roomId}/repo/pulls**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(`/api/rooms/${roomId}/repo`, "");
    const json = request.postDataJSON?.() ?? null;
    if (path === "/pulls" && request.method() === "GET") {
      const pulls = [detail, ...(opened ? [{ ...detail, number: 8, title: "From the room", head: "feature/room" }] : [])];
      return route.fulfill({ json: { pulls } });
    }
    if (path === "/pulls" && request.method() === "POST") {
      opened = true;
      sent.push({ path, json });
      return route.fulfill({ status: 201, json: { ...detail, number: 8, title: json.title, head: "feature/room" } });
    }
    if (path === "/pulls/7") return route.fulfill({ json: detail });
    if (path === "/pulls/8") return route.fulfill({ json: { ...detail, number: 8, title: "From the room", comments: [] } });
    if (path === "/pulls/7/comments") {
      sent.push({ path, json });
      const made = { id: 600 + sent.length, path: json.path ?? "index.html", line: json.line ?? 2, side: json.side ?? "RIGHT", body: json.body, author: "tester", createdAt: "2026-10-21T09:00:00Z", inReplyTo: json.inReplyTo ?? null, url: "https://github.com/x" };
      return route.fulfill({ status: 201, json: made });
    }
    return route.fulfill({ status: 404, json: { detail: "Not here" } });
  });

  await page.goto(`${BASE}/rooms/${roomId}`);
  await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Source control" }).click();
  const view = page.getByRole("region", { name: "Source control" });
  await view.getByRole("button", { name: /^Pull requests/ }).click();
  const list = view.getByRole("list", { name: "Pull requests" });
  check("listShown", await ok(list.getByRole("button", { name: /#7 Brighter heading/ }).waitFor({ timeout: 10_000 })));

  await list.getByRole("button", { name: /#7 Brighter heading/ }).click();
  const pr = page.getByRole("region", { name: "Pull request #7" });
  check("detailOpens", await ok(pr.getByText("octo-friend wants to merge feature/brighter into main", { exact: false }).waitFor({ timeout: 10_000 })));
  const lines = pr.getByRole("table", { name: "Lines of index.html" });
  check("rowsNumbered", await ok(lines.getByRole("row", { name: 'Added 2: <h1 class="big">Hi</h1>' }).waitFor({ timeout: 5_000 })) && (await lines.getByRole("row", { name: "Removed 2: <h1>Hi</h1>" }).count()) === 1);
  check("binaryNoted", await ok(pr.getByRole("region", { name: "Diff of logo.png" }).getByText(/No diff to show/).waitFor({ timeout: 2_000 })));
  check("threadUnderLine", await ok(pr.getByRole("group", { name: "Comments by reviewer" }).getByText("Why big?").waitFor({ timeout: 2_000 })));

  // A new comment on a removed line goes to the left side; a reply goes to its thread.
  await lines.getByRole("row", { name: "Removed 2: <h1>Hi</h1>" }).hover();
  await pr.getByRole("button", { name: "Comment on index.html line 2 (removed)" }).click();
  await pr.getByRole("textbox", { name: "Comment on line 2" }).fill("Keep the old one?");
  await pr.getByRole("button", { name: "Comment", exact: true }).click();
  check("commentShown", await ok(pr.getByRole("group", { name: "Comments by tester" }).getByText("Keep the old one?").waitFor({ timeout: 5_000 })));
  const lineComment = sent.find((s) => s.path === "/pulls/7/comments" && s.json.path);
  check("commentSent", lineComment?.json.side === "LEFT" && lineComment.json.line === 2 && lineComment.json.commitId === head, JSON.stringify(lineComment));

  const thread = pr.getByRole("group", { name: "Comments by reviewer" });
  await thread.getByRole("button", { name: "Reply" }).click();
  await thread.getByRole("textbox", { name: "Reply" }).fill("Because it's the title");
  await thread.getByRole("textbox", { name: "Reply" }).press("Control+Enter");
  check("replyShown", await ok(thread.getByText("Because it's the title").waitFor({ timeout: 5_000 })));
  check("replySent", sent.some((s) => s.json?.inReplyTo === 501 && s.json.body === "Because it's the title"));
  await page.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "pull-request.png") });

  // Opening one from the room's branch.
  await view.getByRole("button", { name: "Open a pull request" }).click();
  check("fromInto", await ok(view.getByText(/From feature\/room into main/).waitFor({ timeout: 3_000 })));
  await view.getByRole("textbox", { name: "Pull request title" }).fill("From the room");
  await view.getByRole("button", { name: "Open pull request" }).click();
  check("openedShows", await ok(page.getByRole("region", { name: "Pull request #8" }).waitFor({ timeout: 10_000 })));
  check("openedListed", await ok(list.getByRole("button", { name: /#8 From the room/ }).waitFor({ timeout: 10_000 })));
  check("openSent", sent.some((s) => s.path === "/pulls" && s.json.title === "From the room"));
  await page.getByRole("button", { name: "Close the pull request" }).click();
  check("closes", (await page.getByRole("region", { name: /^Pull request #/ }).count()) === 0);
} catch (error) {
  const shot = join(tmpdir(), "pull-requests-failed.png");
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
