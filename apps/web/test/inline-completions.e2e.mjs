// AI suggestions as you type (inline completions), against the dev stack's AI (normally the local
// Ollama): faint text appears after a pause in typing, Escape dismisses it, Tab puts it in the file,
// and the status bar switch turns suggestions off, remembered in this browser.
//   node test/inline-completions.e2e.mjs        (from apps/web, with the dev stack running and AI set up)
import { BASE, check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const file = `inline_${stamp}.py`;
const ok = (promise) => promise.then(() => true, () => false);
const squash = (text) => text.replace(/[\s ]+/g, "");
const editorText = async (page) => ((await page.locator(".monaco-editor .view-lines").first().textContent()) ?? "").replace(/ /g, " ");
const ghostText = async (page) => (await page.locator('.monaco-editor [class*="ghost-text"]').allTextContents()).join("").replace(/ /g, " ");

const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
const status = await (await page.request.get(`${BASE}/api/ai/status`)).json();
check("aiConfigured", status.configured, status.configured ? `${status.provider} (${status.model})` : status.problem);

// Every suggestion request, and what came back.
let requests = 0;
const answers = [];
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/ai/complete")) requests++;
});
page.on("response", async (response) => {
  if (response.request().method() !== "POST" || !response.url().includes("/ai/complete")) return;
  answers.push({ status: response.status(), text: await response.json().then((body) => body.text ?? body.detail, () => null) });
});

const toggle = page.getByRole("button", { name: /^AI suggestions/ });
check("statusBarSwitch", await ok(toggle.waitFor({ timeout: 20_000 })));
check("onByDefault", (await toggle.getAttribute("aria-pressed")) === "true");

// A new file, open in the editor.
await page.getByRole("button", { name: "New file" }).click();
await page.getByPlaceholder("name.ext").fill(file);
await page.getByPlaceholder("name.ext").press("Enter");
await page.getByRole("tab", { name: new RegExp(file.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
await page.locator(".monaco-editor .view-lines").first().click();

// A function header, then a pause: the body is suggested as faint text.
await page.keyboard.type("def add(a, b):");
await page.keyboard.press("Enter"); // Monaco indents the new line
const typedAt = Date.now();
const ghost = page.locator('.monaco-editor [class*="ghost-text"]').first();
const shown = await ok(ghost.waitFor({ state: "visible", timeout: 60_000 }));
const waited = Date.now() - typedAt;
const suggestion = answers.findLast((a) => a.status === 200 && a.text)?.text ?? "";
check("ghostTextAppears", shown && suggestion.length > 0, `${waited}ms after the pause: ${JSON.stringify(suggestion)} ${JSON.stringify(answers.slice(-3))}`);
check("oneRequestPerPause", requests <= 2, `${requests} requests while typing`);
check("ghostShowsTheSuggestion", squash(await ghostText(page)).startsWith(squash(suggestion).slice(0, 8)), JSON.stringify(await ghostText(page)));

// Escape dismisses it and leaves the file as it was.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("escapeDismisses", (await ghostText(page)).trim() === "" && squash(await editorText(page)) === squash("def add(a, b):"), await editorText(page));

// Typing on and back brings the same suggestion straight back (no new request); Tab puts it in the file.
const before = requests;
await page.keyboard.type("x");
await page.keyboard.press("Backspace");
const back = await ok(ghost.waitFor({ state: "visible", timeout: 10_000 }));
check("sameSpotShowsItAgain", back && requests === before, `${requests - before} new requests`);
await page.keyboard.press("Tab");
await page.waitForTimeout(400);
const accepted = await editorText(page);
check("tabInserts", squash(accepted) === squash(`def add(a, b):${suggestion}`), accepted);
check("noGhostAfterTab", (await ghostText(page)).trim() === "");

// The switch turns suggestions off: no faint text and no requests, and it stays off after a reload.
await toggle.click();
check("switchOff", (await toggle.getAttribute("aria-pressed")) === "false");
const whenOff = requests;
await page.locator(".monaco-editor .view-lines").first().click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await page.keyboard.type("def mul(a, b):");
await page.keyboard.press("Enter");
await page.waitForTimeout(2_500);
check("offAsksNothing", requests === whenOff && (await ghostText(page)).trim() === "", `${requests - whenOff} requests`);
await page.reload();
await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
const toggleAfter = page.getByRole("button", { name: /^AI suggestions/ });
await toggleAfter.waitFor({ timeout: 20_000 });
check("rememberedInThisBrowser", (await toggleAfter.getAttribute("aria-pressed")) === "false");

await page.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/inline-completions.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
