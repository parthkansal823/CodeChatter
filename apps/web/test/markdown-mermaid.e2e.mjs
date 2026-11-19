/** Verify lazy Mermaid fences, live errors, theme changes and hostile Markdown safely; always remove this suite's README. */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOM, check, finish, fromMore, launch } from "./browser.mjs";

if (ROOM !== "E2ETST") throw new Error("This suite only changes seeded E2ETST files");
const name = `markdown_mermaid_${Date.now().toString(36)}.md`;
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const code = (page) => page.locator(".monaco-editor .view-lines:visible").first();
const preview = (page) => page.getByRole("region", { name: `Preview of ${name}`, exact: true });
const row = (page) => page.getByRole("tree", { name: "Files", exact: true }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
const block = (page, number) => preview(page).getByRole("region", { name: `Mermaid diagram ${number}`, exact: true });
const image = (page, number) => block(page, number).getByRole("img");
const original = "graph TD\n  A[Start] --> B[Done]";
const broken = "graph TD\n  A[Unclosed";
const fence = (source, language = "mermaid") => `\`\`\`${language}\n${source}\n\`\`\``;
const source = (first = original) => [
  "# Markdown diagrams",
  fence(first),
  fence(original),
  fence(broken),
  fence("const untouched = 42;", "javascript"),
  fence('graph TD\n  A[Callback] --> B[Safe]\n  click A call alert(1)'),
  fence('graph TD\n  A[Label] --> B["<img src=x onerror=window.top.__markdownMermaidInjected=1>"]'),
  ...Array.from({ length: 35 }, (_, index) => `A distant section ${index}. Diagrams below this text should wait until the reader reaches them.`),
  fence("graph TD\n  A[Lazy] --> B[Visible later]"),
  fence('graph LR\n  A["A deliberately wide first step in a long diagram"] --> B["A deliberately wide second step in a long diagram"] --> C["A deliberately wide third step in a long diagram"] --> D["A deliberately wide final step in a long diagram"]'),
  "> A quoted diagram\n>\n> ```mermaid\n> graph TD\n> A[Quoted] --> B[Done]\n> ```",
  "- A list diagram\n\n  ```mermaid\n  graph TD\n  A[List] --> B[Done]\n  ```",
  fence(""),
  fence(" \n \t"),
  fence("\n%% A comment\n\ngraph TD\n  A[Unclosed"),
  fence('graph TD\n A["#lt;img src=x onerror=window.top.__markdownMermaidInjected=1#gt;"]'),
].join("\n\n");

const { browser, errors, signIn } = await launch();
let owner;
let page;
let created = false;
let dialogs = 0;
let stage = "sign in";
let initialTheme;

async function replaceSource(text) {
  await code(page).click();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+v");
}

async function ready(number, includes) {
  await block(page, number).scrollIntoViewIfNeeded();
  await image(page, number).waitFor({ timeout: 30_000 });
  await image(page, number).evaluate((img, needle) => {
    const matches = () => {
      if (!img.complete || img.naturalWidth <= 0) return false;
      if (!needle) return true;
      const svg = new DOMParser().parseFromString(decodeURIComponent(img.src.split(",").slice(1).join(",")), "image/svg+xml");
      const labels = Array.from(svg.querySelectorAll("text")).map((node) => node.textContent).join(" ").replace(/\s+/gu, " ");
      return labels.includes(needle);
    };
    if (matches()) return;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        if (matches()) resolve();
        else if (Date.now() - start > 25_000) reject(new Error("Diagram image did not settle"));
        else setTimeout(poll, 60);
      };
      poll();
    });
  }, includes);
}

async function waitForSourceChange(number, previous, needle) {
  await page.waitForFunction(({ label, previous, needle }) => {
    const img = Array.from(document.querySelectorAll("img")).find((candidate) => candidate.alt === label);
    return img?.complete && img.naturalWidth > 0 && img.src !== previous && (!needle || decodeURIComponent(img.src).includes(needle));
  }, { label: await image(page, number).getAttribute("alt"), previous, needle }, { timeout: 30_000 });
}

try {
  owner = await signIn("test1@codechatter.local");
  page = owner.page;
  page.setDefaultTimeout(20_000);
  initialTheme = await page.locator("html").evaluate((html) => html.classList.contains("dark"));
  await owner.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  page.on("dialog", async (dialog) => { dialogs++; await dialog.dismiss(); });
  await page.evaluate(() => { window.__markdownMermaidInjected = 0; });

  stage = "create fixture README";
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await page.getByPlaceholder("name.ext").fill(name);
  await page.getByPlaceholder("name.ext").press("Enter");
  created = true;
  await page.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor();
  await replaceSource(source());
  await code(page).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("v");

  stage = "independent and duplicate diagrams";
  await ready(1, "Start");
  await ready(2, "Start");
  check("two identical Mermaid fences both draw", await image(page, 1).count() === 1 && await image(page, 2).count() === 1);
  const ids = await Promise.all([1, 2].map(async (number) => {
    const svg = decodeURIComponent((await image(page, number).getAttribute("src")).split(",").slice(1).join(","));
    return /<svg[^>]*\bid="([^"]+)"/.exec(svg)?.[1];
  }));
  check("identical diagrams have different SVG IDs", Boolean(ids[0] && ids[1] && ids[0] !== ids[1]));
  check("a distant Mermaid fence waits for the viewport", await image(page, 6).count() === 0);

  stage = "broken and ordinary code fences";
  await block(page, 3).scrollIntoViewIfNeeded();
  const error = block(page, 3).getByRole("alert");
  await error.waitFor();
  check("broken Mermaid shows its block-local line", /Line 2\b/.test(await error.innerText()));
  check("broken Mermaid keeps the source visible", (await block(page, 3).innerText()).includes("A[Unclosed"));
  check("JavaScript remains an ordinary code block", await preview(page).locator("pre code.language-javascript").textContent() === "const untouched = 42;\n");

  stage = "hostile Mermaid source";
  await ready(4, "Callback");
  await block(page, 5).scrollIntoViewIfNeeded();
  await block(page, 5).getByRole("alert").waitFor();
  check("HTML tags are rejected before Mermaid can insert temporary labels", /HTML tags/.test(await block(page, 5).innerText()) && await image(page, 5).count() === 0);
  check("strict Mermaid callbacks open no dialogs", dialogs === 0);
  check("HTML labels execute no script", await page.evaluate(() => window.__markdownMermaidInjected === 0));
  const unsafe = await preview(page).evaluate((root) => {
    const parser = new DOMParser();
    return Array.from(root.querySelectorAll("img")).some((img) => {
      if (!img.src.startsWith("data:image/svg+xml")) return false;
      const svg = parser.parseFromString(decodeURIComponent(img.src.split(",").slice(1).join(",")), "image/svg+xml");
      return Boolean(svg.querySelector("script, foreignObject, [onerror], [onload], a[href^='javascript:'], a[href^='data:']"));
    });
  });
  check("rendered SVG contains no active HTML or script attributes", !unsafe);
  check("Markdown inserts diagram images rather than interactive inline SVG", await preview(page).locator('[role="region"][aria-label^="Drawing for Mermaid diagram"] svg').count() === 0);

  stage = "copy and download";
  await block(page, 1).scrollIntoViewIfNeeded();
  await block(page, 1).getByRole("button", { name: "Copy code", exact: true }).click();
  await page.waitForFunction(async (expected) => (await navigator.clipboard.readText()).trim() === expected, original);
  check("Copy code copies the original Mermaid source", true);
  const downloaded = page.waitForEvent("download");
  await block(page, 1).getByRole("button", { name: "Download SVG", exact: true }).click();
  const download = await downloaded;
  check("Download SVG offers an SVG file", download.suggestedFilename().endsWith(".svg"));
  await download.delete();

  stage = "live edits and last good drawing";
  const good = await image(page, 1).getAttribute("src");
  await replaceSource(source(broken));
  await block(page, 1).scrollIntoViewIfNeeded();
  await block(page, 1).getByRole("alert").waitFor();
  check("a typing mistake preserves the last good drawing", await image(page, 1).getAttribute("src") === good);
  await replaceSource(source("graph TD\n  A[Edited] --> B[Recovered]"));
  await block(page, 1).scrollIntoViewIfNeeded();
  await waitForSourceChange(1, good, "Recovered");
  check("editing Markdown redraws its diagram", await block(page, 1).getByRole("alert").count() === 0);

  stage = "theme change";
  const beforeTheme = await image(page, 1).getAttribute("src");
  await fromMore(page, initialTheme ? "Light theme" : "Dark theme");
  await waitForSourceChange(1, beforeTheme, "Recovered");
  check("the theme switch redraws the diagram", true);

  stage = "lazy and wide diagrams";
  await ready(6, "Visible later");
  check("scrolling near a delayed fence draws it", await image(page, 6).isVisible());
  await ready(7, "deliberately wide");
  const wide = await image(page, 7).evaluate((img) => {
    const region = img.closest('[role="region"]');
    for (let parent = img.parentElement; parent && parent !== region?.parentElement; parent = parent.parentElement) {
      if (parent.scrollWidth > parent.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(parent).overflowX)) return true;
    }
    return false;
  });
  check("a wide diagram scrolls inside its own box", wide);
  check("a wide diagram does not widen the page", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check("hostile source stays inert after redraws", dialogs === 0 && await page.evaluate(() => window.__markdownMermaidInjected === 0));

  stage = "nested and empty fences";
  await ready(8, "Quoted");
  await ready(9, "List");
  check("fences inside quotes and lists draw in place", await image(page, 8).count() === 1 && await image(page, 9).count() === 1);
  check("empty and whitespace fences have a readable placeholder", /Write a Mermaid diagram/.test(await block(page, 10).innerText()) && /Write a Mermaid diagram/.test(await block(page, 11).innerText()));
  await block(page, 12).scrollIntoViewIfNeeded();
  await block(page, 12).getByRole("alert").waitFor();
  check("error lines include the block's leading blanks and comments", /Line 5\b/.test(await block(page, 12).getByRole("alert").innerText()));
  await block(page, 13).scrollIntoViewIfNeeded();
  await block(page, 13).getByRole("alert").waitFor();
  check("encoded HTML tags are also rejected before drawing", /HTML tags/.test(await block(page, 13).innerText()) && await image(page, 13).count() === 0);

  stage = "large source and closing during redraw";
  await replaceSource(`# Large diagram\n\n${fence(`graph TD\n${"A".repeat(50_001)}`)}`);
  await block(page, 1).scrollIntoViewIfNeeded();
  await block(page, 1).getByRole("alert").waitFor();
  check("oversized source fails safely with its code visible", /too large/.test(await block(page, 1).getByRole("alert").innerText()) && await block(page, 1).locator("pre code").count() === 1);
  await replaceSource(`# Closing preview\n\n${fence("graph TD\n A[Closed] --> B[Reopened]")}`);
  await preview(page).getByRole("button", { name: "Close the preview", exact: true }).click();
  await preview(page).waitFor({ state: "detached" });
  await page.waitForTimeout(350);
  await code(page).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.press("v");
  await ready(1, "Reopened");
  check("closing during a redraw leaves the next preview usable", true);
} catch (error) {
  await page?.screenshot({ path: join(tmpdir(), `markdown-mermaid-${name}-failed.png`) }).catch(() => {});
  check(`Markdown Mermaid workflow completes (${stage})`, false, error instanceof Error ? error.message.split("\n")[0] : String(error));
} finally {
  try {
    if (page && initialTheme !== undefined && !page.isClosed()) {
      const currentTheme = await page.locator("html").evaluate((html) => html.classList.contains("dark"));
      if (currentTheme !== initialTheme) await fromMore(page, initialTheme ? "Dark theme" : "Light theme");
    }
  } catch {
    check("the original theme is restored", false);
  }
  try {
    if (created && page) {
      await row(page).focus();
      await row(page).press("Delete");
      await row(page).waitFor({ state: "detached", timeout: 10_000 });
    }
    check("the fixture README is removed even after failure", true);
  } catch {
    check("the fixture README is removed even after failure", false);
  }
  await owner?.context.close().catch(() => {});
  await browser.close();
}

check("no browser page errors", errors.length === 0, errors.join(" | "));
finish();
