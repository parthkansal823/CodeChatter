// Format document for sandbox-formatted languages (roadmap §14 A), in the browser: Shift+Alt+F formats a
// Python and a C file through the room's sandbox, the change reaches the other person, Undo puts it back,
// and code with a syntax error leaves the file as it was and says why. The test's files have a stamp in
// their names and are deleted at the end.
//   node test/format.e2e.mjs        (from apps/web, with the dev stack running and the sandbox image built)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const py = `fm_${stamp}.py`;
const c = `fm_${stamp}.c`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
const b = (await signIn("test2@codechatter.local")).page;
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const created = [];

async function newFile(name, text) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
  await a.waitForTimeout(400);
}
/** The editor's text from its rendered lines, in order (innerText would drop the blank ones). */
const code = (page) =>
  page.evaluate(() => {
    const lines = [...document.querySelectorAll(".monaco-editor .view-lines")][0]?.querySelectorAll(".view-line") ?? [];
    return [...lines]
      .sort((x, y) => parseFloat(x.style.top) - parseFloat(y.style.top))
      .map((line) => line.textContent.replace(/ /g, " "))
      .join("\n")
      .trimEnd();
  });
async function eventually(test, timeout = 30_000) {
  for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 300))) if (await test()) return true;
  return false;
}

try {
  await newFile(py, "def f(a,b):\n  return {'x':a+b}\nprint( f(1,2) )\n");
  await a.keyboard.press("Shift+Alt+f");
  const formatted = 'def f(a, b):\n    return {"x": a + b}\n\n\nprint(f(1, 2))';
  check("pythonFormatted", await eventually(async () => (await code(a)) === formatted), JSON.stringify(await code(a)));
  // The other person sees it.
  await b.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(py)}`) }).click();
  check("othersSeeIt", await eventually(async () => (await code(b)) === formatted, 10_000), JSON.stringify(await code(b)));
  // One Undo puts it back.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+z");
  check("undoRestores", await eventually(async () => (await code(a)).startsWith("def f(a,b):"), 5_000), JSON.stringify(await code(a)));

  // A syntax error: nothing changes, and a message says why.
  await a.keyboard.press("Control+a");
  await a.keyboard.insertText("def f(:\n  pass\n");
  const broken = await code(a);
  await a.keyboard.press("Shift+Alt+f");
  check("syntaxErrorToast", await ok(a.getByText(/Couldn't format: .*Expected a parameter/).waitFor({ timeout: 30_000 })));
  check("fileUnchanged", (await code(a)) === broken, JSON.stringify(await code(a)));

  await newFile(c, "int main(){int x=1;return x;}\n");
  await a.keyboard.press("Shift+Alt+f");
  check("cFormatted", await eventually(async () => (await code(a)) === "int main() {\n  int x = 1;\n  return x;\n}"), JSON.stringify(await code(a)));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "format.png") });
} catch (error) {
  const shot = join(tmpdir(), "format-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
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
