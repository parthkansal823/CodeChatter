// Git in the sandbox (roadmap step 7), in the Source Control view of a disposable room (so no `.git` stays in a
// room tests share): initialise a repository, commit everything, see a new file as untracked, stage it, compare a
// file with the last commit, make a branch, read the history. The room is deleted at the end.
//   node test/sandbox-git.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const stamp = Date.now().toString(36);
const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let roomId = null;

try {
  const created = await a.evaluate((name) =>
    fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json()),
  `Sandbox git ${stamp}`);
  roomId = created.id;
  await a.goto(`${BASE}/rooms/${roomId}`);
  const tree = a.getByRole("tree", { name: "Files" });
  await tree.getByRole("treeitem", { name: /^README\.md/ }).waitFor({ timeout: 30_000 });

  await a.getByRole("button", { name: "Source control" }).click();
  const git = a.getByRole("region", { name: "Git in the sandbox" });
  // A room that isn't on GitHub opens the section by itself; the sandbox may need a moment to start.
  const init = git.getByRole("button", { name: "Initialise a repository" });
  check("offersToInitialise", await ok(init.waitFor({ timeout: 60_000 })));
  await init.click();
  const changes = git.getByRole("list", { name: "Sandbox changes" });
  check("templateFilesListedAsNew", await ok(changes.getByRole("button", { name: "README.md, new" }).waitFor({ timeout: 30_000 })));

  await git.getByLabel("Commit message for the sandbox repository").fill("Start the project");
  await git.getByRole("button", { name: /^Commit all/ }).click();
  check("commitAll", await ok(git.getByText(/^Nothing changed since [0-9a-f]{7}\.$/).waitFor({ timeout: 30_000 })));

  // A new file shows up as untracked a moment later, and stages.
  await a.getByRole("navigation", { name: "Panels" }).getByRole("button", { name: "Files", exact: true }).click();
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(`notes_${stamp}.txt`);
  await a.getByPlaceholder("name.ext").press("Enter");
  await tree.getByRole("treeitem", { name: new RegExp(`^notes_${stamp}\\.txt`) }).waitFor({ timeout: 15_000 });
  await a.getByRole("button", { name: "Source control" }).click();
  const newRow = changes.getByRole("button", { name: `notes_${stamp}.txt, new` });
  const waited = Date.now();
  const appeared = await ok(newRow.waitFor({ timeout: 30_000 }));
  check("newFileAppears", appeared, `after ${Date.now() - waited} ms`);
  await git.getByRole("button", { name: `Stage notes_${stamp}.txt` }).click();
  const staged = git.getByRole("list", { name: "Sandbox staged" });
  check("stageMovesIt", await ok(staged.getByRole("button", { name: `notes_${stamp}.txt, added` }).waitFor({ timeout: 20_000 })));

  // Compare a file with the last commit.
  await staged.getByRole("button", { name: `notes_${stamp}.txt, added` }).click();
  check("diffOpens", await ok(a.getByText(/at [0-9a-f]{7} \(git in the sandbox\)/).first().waitFor({ timeout: 20_000 })));
  await a.getByRole("button", { name: "Close the comparison" }).click();

  // A branch from here.
  await git.getByRole("button", { name: "New branch" }).click();
  await git.getByLabel("New branch name").fill("feature/notes");
  await git.getByRole("button", { name: "Make" }).click();
  check("branchMade", await ok(git.getByRole("combobox", { name: "Sandbox branch" }).getByText("feature/notes").waitFor({ timeout: 20_000 })));

  // The history has the commit, by the signed-in person.
  await git.getByRole("button", { name: "History" }).click();
  const history = git.getByRole("list", { name: "Sandbox commits" });
  check("historyShowsCommit", await ok(history.getByText("Start the project").waitFor({ timeout: 15_000 })) && (await ok(history.getByText(/^test1, /).waitFor({ timeout: 5_000 }))));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "sandbox-git.png") });
} catch (error) {
  const shot = join(tmpdir(), "sandbox-git-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (roomId) {
    const status = await a.evaluate((id) => fetch(`/api/rooms/${id}`, { method: "DELETE" }).then((r) => r.status), roomId).catch(() => 0);
    check("roomDeleted", status === 204, status);
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
