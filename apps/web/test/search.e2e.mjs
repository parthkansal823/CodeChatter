// Search and replace across the room's files (Ctrl+Shift+F), two people: results and counts across two
// files, the three options, include and exclude globs, opening a result with the match selected, and
// Replace all, which the other person sees live, then Undo and replacing in one file. The test's own
// files have a stamp in their names and contents, and are deleted at the end.
//   node test/search.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const token = `needle${stamp}`;
const swap = `pin${stamp}`;
const txt = `srch_${stamp}.txt`;
const md = `srch_${stamp}.md`;
const many = `srch_${stamp}_many.txt`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Polls until `test` passes, for state that settles a moment after an action. */
async function eventually(test, timeout = 10_000) {
  for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 200))) {
    if (await test()) return true;
  }
  return false;
}

const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;
const created = [];

/** A new file at the top of the tree, with `text` in it (and nothing else), open in the editor. */
async function newFile(page, name, text) {
  await page.getByRole("button", { name: "New file" }).click();
  await page.getByPlaceholder("name.ext").fill(name);
  await page.getByPlaceholder("name.ext").press("Enter");
  await page.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await page.locator(".monaco-editor .view-lines").first().click();
  // The Enter that named the file can reach the editor as a blank first line: replace everything.
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
}

const view = (page) => page.getByRole("region", { name: "Search" });
const summary = (page, text) => view(page).getByText(text, { exact: true }).waitFor({ timeout: 10_000 });

/** The whole window, and a close-up of the sidebar, to look at by eye. */
async function shoot(page, name) {
  const path = join(process.env.SHOT_DIR ?? tmpdir(), name);
  await page.screenshot({ path });
  await page.screenshot({
    path: path.replace(/\.png$/, "-sidebar.png"),
    clip: { x: 0, y: 0, width: 560, height: 520 },
  });
  console.log(`      screenshots: ${path} (and -sidebar)`);
}

try {
  await newFile(a, txt, `alpha ${token} one\nBeta N${token.slice(1)} two\ngamma ${token}x three\n`);
  await newFile(a, md, `${token} in the docs\n`);

  // Ctrl+Shift+F starts from the editor's selection: the word at the top of the Markdown file.
  await a.keyboard.press("Control+Home");
  await a.keyboard.press("Control+Shift+ArrowRight");
  await a.keyboard.press("Control+Shift+F");
  const box = view(a).getByRole("textbox", { name: "Search" });
  check("shortcutOpensSearch", await ok(box.waitFor({ timeout: 5_000 })));
  check("seedsFromSelection", (await box.inputValue()) === token, await box.inputValue());
  check(
    "focusInSearchBox",
    await eventually(() => box.evaluate((el) => el === document.activeElement), 2_000),
  );

  // Results and counts, grouped by file.
  check("resultsInTwoFiles", await ok(summary(a, "4 results in 2 files")));
  check(
    "countsPerFile",
    (await view(a)
      .getByRole("button", { name: `${txt}, 3 results` })
      .isVisible()) &&
      (await view(a)
        .getByRole("button", { name: `${md}, 1 result` })
        .isVisible()),
  );

  // The options: match case, whole word, a regex, and a regex that doesn't parse.
  const option = (name) => view(a).getByRole("button", { name, exact: true });
  await option("Match case").click();
  check(
    "matchCase",
    (await ok(summary(a, "3 results in 2 files"))) &&
      (await option("Match case").getAttribute("aria-pressed")) === "true",
  );
  await option("Whole word").click();
  check("wholeWord", await ok(summary(a, "2 results in 2 files")));
  await option("Match case").click();
  await option("Whole word").click();
  await option("Use regular expression").click();
  await box.fill(`${token}\\w`);
  check("regex", await ok(summary(a, "1 result in 1 file")));
  await box.fill(`${token}(`);
  check("badRegexExplained", await ok(view(a).getByText("Unterminated group").waitFor({ timeout: 5_000 })));
  await option("Use regular expression").click();
  await box.fill(token);
  await summary(a, "4 results in 2 files");

  // Files to include and exclude.
  await view(a).getByRole("button", { name: "Files to include and exclude" }).click();
  const include = view(a).getByRole("textbox", { name: "Files to include" });
  const exclude = view(a).getByRole("textbox", { name: "Files to exclude" });
  await include.fill("*.md");
  check("includeGlob", await ok(summary(a, "1 result in 1 file")));
  await include.fill("");
  await exclude.fill("*.md");
  check("excludeGlob", await ok(summary(a, "3 results in 1 file")));
  await exclude.fill("");
  await summary(a, "4 results in 2 files");

  // A result opens its file with the match selected, the cursor at its end (the Markdown file is open now).
  await view(a)
    .getByRole("button", { name: /^Line 2: Beta / })
    .click();
  const tab = a.getByRole("tab", { name: new RegExp(escape(txt)) });
  check(
    "resultOpensFile",
    await eventually(async () => (await tab.getAttribute("aria-selected")) === "true"),
  );
  check(
    "matchSelected",
    (await ok(a.getByText(`Ln 2, Col ${6 + token.length}`, { exact: true }).waitFor({ timeout: 5_000 }))) &&
      (await ok(a.getByText(`${token.length} selected`, { exact: true }).waitFor({ timeout: 5_000 }))),
  );

  // test2 watches for the new text in their own Search view.
  await b.getByRole("button", { name: "Search", exact: true }).click();
  await view(b).getByRole("textbox", { name: "Search" }).fill(swap);
  await summary(b, "No results found.");

  // Replace all: a preview, a question with the count, then every match for everyone.
  await view(a).getByRole("button", { name: "Toggle replace" }).click();
  await view(a).getByRole("textbox", { name: "Replace" }).fill(swap);
  check(
    "replacePreview",
    await ok(
      view(a)
        .getByRole("button", { name: `Line 1: alpha ${token} one, becomes alpha ${swap} one` })
        .waitFor({ timeout: 5_000 }),
    ),
  );
  await shoot(a, "search-light.png");
  await a.emulateMedia({ colorScheme: "dark" });
  await a.waitForTimeout(400);
  await shoot(a, "search-dark.png");
  await a.emulateMedia({ colorScheme: "light" });

  await view(a).getByRole("button", { name: "Replace all", exact: true }).click();
  const question = a.getByRole("alertdialog", { name: "Replace 4 matches in 2 files?" });
  check("asksWithCount", await ok(question.waitFor({ timeout: 5_000 })));
  await question.getByRole("button", { name: "Replace", exact: true }).click();
  check("replaceAllDone", await ok(summary(a, "No results found.")));
  check("otherPersonSeesIt", await ok(summary(b, "4 results in 2 files")));

  // Undo, from the toast, puts it back for everyone.
  await a.getByRole("button", { name: "Undo", exact: true }).first().click();
  check(
    "undoRestores",
    (await ok(summary(a, "4 results in 2 files"))) && (await ok(summary(b, "No results found."))),
  );

  // Replace in one file only, from its row.
  await view(a)
    .getByRole("button", { name: `${md}, 1 result` })
    .hover();
  await view(a)
    .getByRole("button", { name: `Replace all in ${md}` })
    .click();
  check("replaceInOneFile", await ok(summary(a, "3 results in 1 file")));

  // test2 opens the changed file from their results and reads the new text.
  await summary(b, "1 result in 1 file");
  await view(b)
    .getByRole("button", { name: /^Line 1: / })
    .click();
  await b.getByRole("tab", { name: new RegExp(escape(md)) }).waitFor({ timeout: 10_000 });
  const theirText = async () =>
    ((await b.locator(".monaco-editor .view-lines").first().textContent()) ?? "").replace(/ /g, " ");
  check(
    "otherPersonReadsNewText",
    await eventually(async () => (await theirText()).includes(`${swap} in the docs`)),
    await theirText(),
  );

  // A big search stops at 2,000 results and says so.
  await a.getByRole("button", { name: "Files", exact: true }).click();
  await newFile(a, many, Array.from({ length: 2100 }, () => `lots${stamp}`).join("\n"));
  await a.keyboard.press("Control+Shift+F");
  await box.fill(`lots${stamp}`);
  check(
    "capsAt2000",
    await ok(summary(a, "Showing the first 2,000 results, in 1 file. Narrow the search to see the rest.")),
  );
} catch (error) {
  const shot = join(tmpdir(), "search-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check(
    "flowCompletes",
    false,
    `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`,
  );
} finally {
  // Delete the test's files, whatever happened above.
  try {
    const filesButton = a.getByRole("button", { name: "Files", exact: true });
    if ((await filesButton.getAttribute("aria-pressed")) !== "true") await filesButton.click();
    const tree = a.getByRole("tree", { name: "Files" });
    for (const name of created) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFilesDeleted", true, created.join(", "));
  } catch (error) {
    check("testFilesDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
