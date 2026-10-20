// Snippets (roadmap §14 A): typing a prefix offers the snippet among the completions, accepting it fills in
// the code with Tab moving through the placeholders, and Insert snippet… in the palette lists the file's
// language's snippets. Python and C++ (the competitive-programming template). The test's files have a
// stamp in their names and are deleted at the end.
//   node test/snippets.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const py = `sn_${stamp}.py`;
const cpp = `sn_${stamp}.cpp`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const created = [];

async function newFile(name) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Delete");
}
/** The editor's text, as Monaco shows it (no non-breaking spaces). */
const code = async () => (await a.locator(".monaco-editor .view-lines").first().innerText()).replace(/ /g, " ");

try {
  await newFile(py);
  await a.keyboard.type("forr");
  const suggestion = a.locator(".suggest-widget .monaco-list-row", { hasText: "forr" }).first();
  check("prefixOffersSnippet", await ok(suggestion.waitFor({ timeout: 10_000 })) && (await suggestion.innerText()).includes("for over a range"));
  await a.locator(".suggest-widget .monaco-list-row.focused", { hasText: "forr" }).waitFor({ timeout: 5_000 }).catch(() => suggestion.click());
  await a.keyboard.press("Enter");
  await a.waitForTimeout(300);
  check("snippetExpands", (await code()).replace(/\s+$/, "") === "for i in range(n):\n    pass", JSON.stringify(await code()));
  // The first placeholder is selected: typing replaces it, Tab goes to the next.
  await a.keyboard.type("k");
  await a.keyboard.press("Tab");
  await a.keyboard.type("10");
  await a.keyboard.press("Tab");
  await a.keyboard.type("print(k)");
  check("tabMovesThroughPlaceholders", (await code()).replace(/\s+$/, "") === "for k in range(10):\n    print(k)", JSON.stringify(await code()));

  // Insert snippet… from the palette.
  await a.keyboard.press("Escape");
  await a.keyboard.press("Control+End");
  await a.keyboard.press("Enter");
  await a.keyboard.press("F1");
  await a.getByRole("dialog", { name: "Command palette" }).waitFor({ timeout: 5_000 });
  await a.keyboard.type("Insert snippet");
  await a.keyboard.press("Enter");
  const dialog = a.getByRole("dialog", { name: "Insert snippet" });
  check("paletteListsSnippets", await ok(dialog.waitFor({ timeout: 5_000 })) && (await dialog.getByRole("option").count()) >= 10);
  await a.keyboard.type("dataclass");
  await a.keyboard.press("Enter");
  await a.waitForTimeout(400);
  check("paletteInserts", (await code()).includes("@dataclass") && (await code()).includes("class Name:"), JSON.stringify(await code()));
  // Its first placeholder ("Name") is selected in the code, ready to type over.
  check(
    "insertedPlaceholderSelected",
    (await ok(a.getByText("4 selected", { exact: true }).waitFor({ timeout: 3_000 }))) && (await a.evaluate(() => Boolean(document.activeElement?.closest(".monaco-editor")))),
  );

  // C++: the competitive-programming template.
  await newFile(cpp);
  await a.keyboard.type("cp");
  await a.locator(".suggest-widget .monaco-list-row", { hasText: "Competitive programming" }).first().waitFor({ timeout: 10_000 });
  await a.locator(".suggest-widget .monaco-list-row", { hasText: "Competitive programming" }).first().click();
  await a.waitForTimeout(300);
  check("cppTemplate", (await code()).includes("#include <bits/stdc++.h>") && (await code()).includes("while (t--)"), JSON.stringify((await code()).slice(0, 80)));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "snippets.png") });
} catch (error) {
  const shot = join(tmpdir(), "snippets-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    await a.keyboard.press("Escape");
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
