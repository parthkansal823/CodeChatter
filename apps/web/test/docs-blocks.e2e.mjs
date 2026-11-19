/** Verify local toggles and shared block moves on one owned Docs page, then remove its content and index entry even on failure. */
// From apps/web with the shared stack running: node test/docs-blocks.e2e.mjs
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";

import { BASE, ROOM, check, finish, launch, openApp, sleep } from "./browser.mjs";

if (ROOM !== "E2ETST") throw new Error("This suite only changes the seeded E2ETST room");
const WebSocket = createRequire(new URL("../../collab/package.json", import.meta.url))("ws");
const store = new URL("../../../node_modules/.pnpm/", import.meta.url);
const axe = readFileSync(new URL(`${readdirSync(store).find((name) => name.startsWith("axe-core@"))}/node_modules/axe-core/axe.min.js`, store), "utf8");
const stamp = Date.now().toString(36);
const title = `Docs blocks ${stamp}`;
const firstText = `First paragraph ${stamp}`;
const secondText = `Second paragraph ${stamp}`;
const summary = `Toggle summary ${stamp}`;
const insideOne = `Inside one ${stamp}`;
const insideTwo = `Inside two ${stamp}`;
const retained = `Retained body ${stamp}`;
const peers = [];
const initialPageIds = new Set();
let a, b, index, pageId, stage = "sign in";
const { browser, errors, signIn } = await launch();
const content = (page) => page.locator('.cc-doc-content[contenteditable="true"]');
const rootParagraph = (page, text) => content(page).locator(":scope > p").filter({ hasText: text });
const toggle = (page) => content(page).locator(".cc-doc-toggle").filter({ has: page.getByText(summary, { exact: true }) });

async function until(probe, timeout = 15_000) {
  const end = Date.now() + timeout;
  do { if (await probe()) return; await sleep(50); } while (Date.now() < end);
  throw new Error("Docs did not reach the expected state");
}

/** Read and clean only this fixture through ordinary cookie-authenticated collab peers. */
async function connect(kind) {
  const cookie = (await a.context.cookies(BASE)).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  class CookieSocket extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: new URL(BASE).origin } }); }
  }
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: `${BASE.replace(/^http/, "ws")}/collab`, WebSocketPolyfill: CookieSocket, maxAttempts: 2 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `room:${ROOM}:${kind}`, document: doc, token: "session" });
  const peer = { doc, provider, close: () => { provider.destroy(); socket.destroy(); doc.destroy(); } };
  peers.push(peer);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Docs fixture did not sync")), 20_000);
    provider.on("synced", () => { clearTimeout(timer); resolve(); });
    provider.on("authenticationFailed", () => { clearTimeout(timer); reject(new Error("Docs fixture was refused")); });
    provider.attach();
  });
  return peer;
}

async function acknowledged(peer) {
  await until(() => !peer.provider.hasUnsyncedChanges);
}

async function openDocs(page) {
  if (!await page.getByRole("complementary", { name: "Pages", exact: true }).isVisible().catch(() => false)) await openApp(page, "Docs");
  await page.getByRole("complementary", { name: "Pages", exact: true }).waitFor();
}

async function paragraphOrder(page) {
  return content(page).locator(":scope > p").allTextContents();
}

try {
  a = await signIn("test1@codechatter.local");
  b = await signIn("test2@codechatter.local");
  for (const [number, user] of [a, b].entries()) { stage = `open Docs for person ${number + 1}`; user.page.setDefaultTimeout(15_000); await openDocs(user.page); }
  index = await connect("pages");
  for (const id of index.doc.getMap("pages").keys()) initialPageIds.add(id);
  stage = "create owned page";
  await a.page.getByRole("button", { name: "New page", exact: true }).first().click();
  await a.page.getByRole("menuitem", { name: /Empty page/ }).click();
  await until(async () => {
    const id = await a.page.evaluate((room) => JSON.parse(localStorage.getItem("cc-docs") ?? "null")?.state?.byRoom?.[room]?.current, ROOM);
    if (typeof id !== "string" || initialPageIds.has(id)) return false;
    pageId = id;
    return true;
  });
  const titleBox = a.page.getByRole("textbox", { name: "Page title", exact: true });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  await until(() => {
    for (const [id, entry] of index.doc.getMap("pages")) if (entry instanceof Y.Map && entry.get("title") === title) { pageId = id; return true; }
    return false;
  });
  await a.page.keyboard.type(firstText);
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.type(secondText);
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.type("/toggle");
  await a.page.getByRole("option", { name: /^Toggle/ }).click();
  await a.page.keyboard.type(summary);
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.type(insideOne);
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.type(insideTwo);
  const listed = b.page.getByRole("navigation", { name: "Page list", exact: true }).getByText(title, { exact: true });
  await listed.waitFor();
  await listed.click();
  await toggle(b.page).getByText(insideTwo, { exact: true }).waitFor();
  check("a slash toggle contains two shared paragraphs", await toggle(b.page).locator(".cc-doc-toggle-body p").count() === 2);
  await a.page.evaluate(axe);
  const violations = await a.page.evaluate(async () => (await window.axe.run({ include: [[".cc-doc-block-host"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] })).violations.map((rule) => rule.id));
  check("populated toggle and block controls have no accessibility violations", violations.length === 0, violations.join(", "));

  stage = "local open state and reload";
  const arrowA = toggle(a.page).getByRole("button", { name: /toggle/i }).first();
  const arrowB = toggle(b.page).getByRole("button", { name: /toggle/i }).first();
  await arrowA.click();
  await toggle(a.page).getByText(insideOne, { exact: true }).waitFor({ state: "hidden" });
  check("closing a toggle leaves the other person's toggle open", await arrowB.getAttribute("aria-expanded") === "true" && await toggle(b.page).getByText(insideOne, { exact: true }).isVisible());
  await arrowB.click();
  check("the second person can close their own toggle", await arrowB.getAttribute("aria-expanded") === "false");
  await a.page.reload();
  await openDocs(a.page);
  await a.page.getByRole("navigation", { name: "Page list", exact: true }).getByText(title, { exact: true }).click();
  await toggle(a.page).waitFor();
  check("local collapse survives a page reload", await toggle(a.page).getByRole("button", { name: /toggle/i }).first().getAttribute("aria-expanded") === "false");
  const keyboardArrow = toggle(a.page).getByRole("button", { name: /toggle/i }).first();
  await keyboardArrow.focus();
  await keyboardArrow.press("Space");
  await toggle(a.page).getByText(insideOne, { exact: true }).waitFor();
  check("the toggle arrow works from the keyboard", await keyboardArrow.getAttribute("aria-expanded") === "true");

  stage = "drag and keyboard block moves";
  await rootParagraph(a.page, secondText).hover();
  const handle = a.page.locator(".cc-doc-block-handle");
  await handle.waitFor({ state: "visible" });
  const sourceBox = await handle.boundingBox();
  const targetBox = await rootParagraph(a.page, firstText).boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Block drag positions were unavailable");
  await a.page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await a.page.mouse.down();
  await a.page.mouse.move(targetBox.x + 12, targetBox.y + 1, { steps: 15 });
  await a.page.locator(".cc-doc-drop-line").waitFor({ state: "visible" });
  check("dragging shows a drop line", true);
  await a.page.mouse.up();
  await until(async () => (await paragraphOrder(b.page))[0] === secondText);
  check("drag moves a whole paragraph live for the other person", (await paragraphOrder(b.page)).slice(0, 2).join("|") === `${secondText}|${firstText}`);
  await rootParagraph(a.page, firstText).click();
  await a.page.keyboard.press("Alt+Shift+ArrowUp");
  await until(async () => (await paragraphOrder(b.page))[0] === firstText);
  check("Alt Shift Up moves past the whole preceding block", (await paragraphOrder(b.page))[1] === secondText);
  await a.page.keyboard.press("Control+z");
  await until(async () => (await paragraphOrder(b.page))[0] === secondText);
  check("Undo reverses exactly one move without removing content", (await paragraphOrder(b.page))[1] === firstText && await toggle(b.page).count() === 1);

  stage = "input shortcut and empty-summary Backspace";
  await rootParagraph(a.page, secondText).click();
  await a.page.keyboard.press("Home");
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.press("ArrowUp");
  await a.page.keyboard.type("> ");
  await until(async () => await content(a.page).locator(".cc-doc-toggle").count() === 2);
  check("typing greater-than space inserts a toggle", true);
  await a.page.keyboard.press("Enter");
  await a.page.keyboard.type(retained);
  const extra = content(a.page).locator(".cc-doc-toggle").filter({ has: a.page.getByText(retained, { exact: true }) });
  await extra.locator(".cc-doc-toggle-summary").click();
  await a.page.keyboard.press("Home");
  await a.page.keyboard.press("Backspace");
  await until(async () => await content(b.page).locator(".cc-doc-toggle").count() === 1);
  check("Backspace unwraps an empty summary and preserves its body", await rootParagraph(b.page, retained).count() === 1);

  stage = "nested HTML details paste";
  await rootParagraph(a.page, firstText).click();
  await a.page.keyboard.press("End");
  await a.page.keyboard.press("Enter");
  await content(a.page).evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", "<details><summary>Imported outer</summary><p>Imported body</p><details><summary>Imported inner</summary><p>Nested body</p></details></details>");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  await content(b.page).getByText("Nested body", { exact: true }).waitFor();
  check("HTML details paste preserves nested toggle blocks", await content(b.page).locator(".cc-doc-toggle").count() === 3);

  stage = "Markdown export";
  // The room header also has Share; the page's control follows it in the Docs header.
  await a.page.getByRole("button", { name: "Share", exact: true }).last().click();
  await a.page.getByRole("switch", { name: "Publish to the web", exact: true }).click();
  const published = await connect(`page:${pageId}-pub`);
  await until(() => typeof published.doc.getMap("public").get("markdown") === "string");
  const markdown = published.doc.getMap("public").get("markdown");
  check("the production Markdown export contains details and both body paragraphs", markdown.includes(`<summary>${summary}</summary>`) && markdown.includes("<details>") && markdown.includes("</details>") && markdown.includes(insideOne) && markdown.includes(insideTwo));
  await a.page.getByRole("switch", { name: "Publish to the web", exact: true }).click();
  await until(() => published.doc.getMap("public").size === 0);
} catch (error) {
  check("Docs blocks completes", false, `${stage}: ${error?.name ?? "Error"}: ${String(error?.message ?? "").split("\n")[0]}`);
} finally {
  try {
    if (index && !pageId && a && !a.page.isClosed()) {
      const current = await a.page.evaluate((room) => JSON.parse(localStorage.getItem("cc-docs") ?? "null")?.state?.byRoom?.[room]?.current, ROOM).catch(() => null);
      if (typeof current === "string" && !initialPageIds.has(current)) pageId = current;
    }
    // Unmount editors first so their delayed summaries/snapshots cannot recreate fixture state after cleanup.
    for (const user of [a, b]) if (user && !user.page.isClosed()) await user.page.getByRole("button", { name: "Close docs", exact: true }).click().catch(() => {});
    await sleep(1_000);
    for (const user of [a, b]) if (user && !user.page.isClosed()) await user.page.goto("about:blank");
    if (a) {
      const freshIndex = await connect("pages");
      const owned = [];
      for (const [id, entry] of freshIndex.doc.getMap("pages")) if (id === pageId || entry instanceof Y.Map && entry.get("title") === title) owned.push(id);
      for (const id of owned) {
        const body = await connect(`page:${id}`);
        body.doc.transact(() => {
          const fragment = body.doc.getXmlFragment("content");
          if (fragment.length) fragment.delete(0, fragment.length);
        });
        await acknowledged(body);
        const history = await connect(`page:${id}-history`);
        const versions = history.doc.getArray("snapshots");
        if (versions.length) versions.delete(0, versions.length);
        await acknowledged(history);
        const published = await connect(`page:${id}-pub`);
        published.doc.getMap("public").clear();
        await acknowledged(published);
        freshIndex.doc.getMap("pages").delete(id);
      }
      await acknowledged(freshIndex);
      const confirm = await connect("pages");
      check("the owned page is removed even after a failure", owned.every((id) => !confirm.doc.getMap("pages").has(id)));
    }
  } catch (error) { check("Docs blocks fixture cleanup completes", false, error?.name ?? "Error"); }
  for (const peer of peers.reverse()) peer.close();
  await browser.close();
  check("no page errors", errors.length === 0, errors.join(" | "));
}
finish();
