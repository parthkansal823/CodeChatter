// Breadcrumbs and the Outline view (roadmap §14 A): a folder of Python, Markdown, TypeScript and plain text
// files. Breadcrumbs show the folder, the file and the symbols the cursor is in, and their menus jump to
// another symbol or open a file from the folder. The Outline view lists the open file's symbols (Python and
// Markdown from the text, TypeScript from its worker), marks where the cursor is, filters, and jumps on a
// click or Enter. Breadcrumbs can be hidden from the palette. The test's folder is deleted at the end.
//   node test/outline.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const folder = `ol_${stamp}`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const PYTHON = `class Shape:
    def area(self):
        return 0

    def name(self):
        return "shape"


class Circle(Shape):
    def area(self):
        return 3.14


def main():
    print(Circle().area())
`;
const MARKDOWN = "# Notes\n\n## Todo\n\nWrite the tests.\n\n## Done\n\nNothing yet.\n";
const TYPESCRIPT = "export class Greeter {\n  hello(name: string) {\n    return `hi ${name}`;\n  }\n}\n\nexport function shout(text: string) {\n  return text.toUpperCase();\n}\n";

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
let created = false;

const tree = a.getByRole("tree", { name: "Files" });
const crumbs = a.getByRole("navigation", { name: "Breadcrumbs" }).first();
const outline = a.getByRole("region", { name: "Outline" });
const palette = a.getByRole("dialog", { name: "Command palette" });

async function command(name) {
  await a.keyboard.press("F1");
  await palette.waitFor({ timeout: 5_000 });
  await a.keyboard.type(name);
  await a.keyboard.press("Enter");
}

/** A new file in the test's folder with `text` pasted in (pasting keeps Python's indentation as written). */
async function newFile(name, text) {
  const row = tree.getByRole("treeitem", { name: new RegExp(`^${folder}`) });
  // The new name's box shows inside the folder, so it has to be open.
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await row.click({ button: "right" });
  await a.getByRole("menuitem", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(400);
}

async function goToLine(n) {
  await a.keyboard.press("Control+g");
  await a.getByRole("dialog", { name: "Go to line" }).waitFor({ timeout: 5_000 });
  await a.keyboard.type(String(n));
  await a.keyboard.press("Enter");
}

try {
  await a.getByRole("button", { name: "New folder" }).click();
  await a.getByPlaceholder("folder").fill(folder);
  await a.getByPlaceholder("folder").press("Enter");
  created = true;
  await newFile("notes.md", MARKDOWN);
  await newFile("app.ts", TYPESCRIPT);
  await newFile("plain.txt", "just words\n");
  await newFile("shapes.py", PYTHON);

  // Breadcrumbs: the folder, the file, then the symbols around the cursor.
  await goToLine(11);
  check("crumbsShowFolderAndFile", (await crumbs.getByRole("button", { name: `Folder ${folder}` }).isVisible()) && (await crumbs.getByRole("button", { name: "Outline of shapes.py" }).isVisible()));
  const method = crumbs.getByRole("button", { name: "method area" });
  check("crumbsShowSymbolChain", await ok(method.waitFor({ timeout: 5_000 })) && (await crumbs.getByRole("button", { name: "class Circle" }).isVisible()));
  check("deepestIsCurrent", (await method.getAttribute("aria-current")) === "location");

  // A symbol's menu: the ones beside it. Picking one moves the cursor there.
  await crumbs.getByRole("button", { name: "class Circle" }).click();
  const menu = a.getByRole("menu");
  check("siblingsListed", (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0]).join(",") === "Shape,Circle,main", (await menu.getByRole("menuitem").allInnerTexts()).join(" | "));
  await menu.getByRole("menuitem", { name: /^main/ }).click();
  check("pickMovesCursor", await ok(crumbs.getByRole("button", { name: "function main" }).waitFor({ timeout: 5_000 })) && (await a.getByText("Ln 14, Col 1").isVisible()));
  check("focusBackInCode", await a.evaluate(() => Boolean(document.activeElement?.closest(".monaco-editor"))));

  // The file's menu: its whole outline.
  await crumbs.getByRole("button", { name: "Outline of shapes.py" }).click();
  check("fileMenuIsOutline", (await a.getByRole("menu").getByRole("menuitem").count()) === 6);
  await a.keyboard.press("Escape");

  // The folder's menu opens another of its files in this pane.
  await crumbs.getByRole("button", { name: `Folder ${folder}` }).click();
  check("folderMenuListsFiles", (await a.getByRole("menu").getByRole("menuitem").count()) === 4);
  await a.getByRole("menu").getByRole("menuitem", { name: "notes.md" }).click();
  check("folderMenuOpensFile", await ok(crumbs.getByRole("button", { name: "Outline of notes.md" }).waitFor({ timeout: 5_000 })));

  // The Outline view follows the open file: Markdown headings, nested by level.
  await a.getByRole("button", { name: "Outline", exact: true }).click();
  await outline.waitFor({ timeout: 5_000 });
  const rows = outline.getByRole("list").getByRole("button");
  await outline.getByRole("button", { name: /^Done/ }).waitFor({ timeout: 5_000 });
  check("outlineShowsHeadings", (await rows.allInnerTexts()).map((t) => t.split("\n")[0]).join(",") === "Notes,Todo,Done", (await rows.allInnerTexts()).join(" | "));

  // TypeScript, from its worker.
  await a.getByRole("tab", { name: /app\.ts/ }).click();
  await outline.getByRole("button", { name: /^shout/ }).waitFor({ timeout: 15_000 });
  check("outlineShowsTypeScript", (await rows.allInnerTexts()).map((t) => t.split("\n")[0]).join(",") === "Greeter,hello,shout", (await rows.allInnerTexts()).join(" | "));

  // A language without an outline says so.
  await a.getByRole("tab", { name: /plain\.txt/ }).click();
  check("unsupportedSaysSo", await ok(outline.getByText(/No outline for this language yet/).waitFor({ timeout: 5_000 })));

  // Python: where the cursor is, a filter, and a click to jump.
  await a.getByRole("tab", { name: /shapes\.py/ }).click();
  await outline.getByRole("button", { name: /^main/ }).waitFor({ timeout: 5_000 });
  check("outlineMarksCursor", (await outline.locator("[aria-current=location]").innerText()).startsWith("main"));
  await outline.getByLabel("Filter symbols").fill("area");
  check("filterNarrows", (await rows.count()) === 2);
  await rows.nth(1).click();
  check("clickJumps", await ok(a.getByText("Ln 10, Col 5").waitFor({ timeout: 5_000 })) && (await crumbs.getByRole("button", { name: "class Circle" }).isVisible()));
  // From the filter box, Down then Enter.
  await outline.getByLabel("Filter symbols").fill("name");
  await outline.getByLabel("Filter symbols").press("ArrowDown");
  await a.keyboard.press("Enter");
  check("keyboardJumps", await ok(a.getByText("Ln 5, Col 5").waitFor({ timeout: 5_000 })));
  // Typing updates the outline (a new function at the end).
  await a.keyboard.press("Control+End");
  await a.keyboard.insertText("\ndef extra():\n");
  await outline.getByLabel("Filter symbols").fill("");
  check("outlineFollowsEdits", await ok(outline.getByRole("button", { name: /^extra/ }).waitFor({ timeout: 5_000 })));

  // Breadcrumbs can be hidden and shown again from the palette.
  await a.locator(".monaco-editor .view-lines").first().click();
  await command("Hide breadcrumbs");
  check("hideBreadcrumbs", await ok(crumbs.waitFor({ state: "detached", timeout: 5_000 })));
  await command("Show breadcrumbs");
  check("showBreadcrumbs", await ok(crumbs.waitFor({ timeout: 5_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "outline.png") });
} catch (error) {
  const shot = join(tmpdir(), "outline-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      await a.keyboard.press("Escape");
      const filesButton = a.getByRole("button", { name: "Files", exact: true });
      if ((await filesButton.getAttribute("aria-pressed")) !== "true") await filesButton.click();
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${folder}`) });
      a.on("dialog", (dialog) => void dialog.accept());
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
      check("testFolderDeleted", true);
    } catch (error) {
      check("testFolderDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
