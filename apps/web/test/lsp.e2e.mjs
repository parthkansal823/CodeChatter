// IntelliSense for Python from the sandbox's language server (roadmap §14 A), in the browser: a type error is
// underlined with the server's message, `math.` completes the module's names, hovering a function shows its
// signature and docstring (from another file of the room), and F12 opens that file at the definition. A
// viewer gets no language server. The test's folder has a stamp in its name and is deleted at the end.
//   node test/lsp.e2e.mjs        (from apps/web, with the dev stack running and the sandbox image built)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const folder = `ls_${stamp}`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const SHAPES = 'import math\n\n\ndef area(radius: float) -> float:\n    """The area of a circle."""\n    return math.pi * radius**2\n';
const APP = 'from shapes import area\nimport math\n\ncount: int = "three"\nprint(area(2))\n';

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const consoleErrors = [];
a.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
let created = false;
const tree = a.getByRole("tree", { name: "Files" });

async function newFile(name, text) {
  const row = tree.getByRole("treeitem", { name: new RegExp(`^${folder}`) });
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
/** Put the cursor at a line and column (Ctrl+G takes line:column). */
async function goTo(line, column) {
  await a.keyboard.press("Control+g");
  await a.getByRole("dialog", { name: "Go to line" }).waitFor({ timeout: 5_000 });
  await a.keyboard.type(`${line}:${column}`);
  await a.keyboard.press("Enter");
  // Focus comes back to the code as the dialog goes (a moment later, not in the same tick).
  await a.waitForFunction(() => Boolean(document.activeElement?.closest(".monaco-editor")), null, { timeout: 5_000 });
}

try {
  await a.getByRole("button", { name: "New folder" }).click();
  await a.getByPlaceholder("folder").fill(folder);
  await a.getByPlaceholder("folder").press("Enter");
  created = true;
  await newFile("shapes.py", SHAPES);
  await newFile("app.py", APP);

  // The type error, underlined, with the server's words on hover.
  const squiggle = a.locator(".monaco-editor .squiggly-error").first();
  check("typeErrorUnderlined", await ok(squiggle.waitFor({ state: "attached", timeout: 120_000 })));
  const token = (text) => a.locator(".monaco-editor .view-lines span", { hasText: new RegExp(`^${text}$`) });
  await token('"three"').first().hover();
  const hover = a.locator(".monaco-hover").filter({ hasText: /not assignable/ }).first();
  check("errorMessageOnHover", await ok(hover.waitFor({ timeout: 15_000 })), await a.locator(".monaco-hover").first().innerText().catch(() => ""));
  await a.mouse.move(5, 5);

  // Hover on a function from another file: its signature and docstring (line 5's `area`).
  await token("area").last().hover();
  const docs = a.locator(".monaco-hover").filter({ hasText: "The area of a circle" }).first();
  check("hoverShowsDocs", await ok(docs.waitFor({ timeout: 15_000 })) && (await docs.innerText()).includes("radius: float"), await a.locator(".monaco-hover").first().innerText().catch(() => ""));
  await a.mouse.move(5, 5);

  // Completions from the module.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+End");
  await a.keyboard.insertText("\nmath.sq");
  await a.keyboard.press("Control+Space");
  const sqrt = a.locator(".suggest-widget .monaco-list-row", { hasText: "sqrt" }).first();
  check("completesModule", await ok(sqrt.waitFor({ timeout: 20_000 })));
  await a.keyboard.press("Escape");

  // F12 (after Go to line, which hands focus back to the code): the definition, in the other file.
  await goTo(5, 8);
  check("focusBackAfterGoToLine", await a.evaluate(() => Boolean(document.activeElement?.closest(".monaco-editor"))));
  await a.keyboard.press("F12");
  const shapesTab = a.getByRole("tab", { name: /shapes\.py/, selected: true });
  check("f12GoesToDefinition", await ok(shapesTab.waitFor({ timeout: 15_000 })) && (await ok(a.getByText("Ln 4, Col 5").waitFor({ timeout: 5_000 }))));

  // Ctrl+click on a name does the same.
  await a.getByRole("tab", { name: /app\.py/ }).click();
  await a.keyboard.down("Control");
  await token("area").last().hover();
  await token("area").last().click();
  await a.keyboard.up("Control");
  check("ctrlClickGoesToDefinition", await ok(shapesTab.waitFor({ timeout: 15_000 })));

  // C++ with clangd: a compile error underlined, and a vector's members completed.
  await newFile("main.cpp", "#include <bits/stdc++.h>\nint main() {\n  std::vector<int> v;\n  int n = \"x\";\n  return 0;\n}\n");
  check("cppErrorUnderlined", await ok(a.locator(".monaco-editor .squiggly-error").first().waitFor({ state: "attached", timeout: 120_000 })));
  // A new line after `std::vector<int> v;` (line 3 ends at column 22).
  await goTo(3, 22);
  await a.keyboard.insertText("\n  v.pu");
  await a.keyboard.press("Control+Space");
  const pushBack = await ok(a.locator(".suggest-widget .monaco-list-row", { hasText: "push_back" }).first().waitFor({ timeout: 30_000 }));
  check("cppCompletes", pushBack, await a.locator(".suggest-widget").innerText().catch(() => "no suggestion list"));
  await a.keyboard.press("Escape");
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "lsp.png") });
} catch (error) {
  const shot = join(tmpdir(), "lsp-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  if (created) {
    try {
      await a.keyboard.press("Escape");
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
if (consoleErrors.length) console.log(`      console errors: ${consoleErrors.slice(0, 5).join(" | ")}`);
finish();
