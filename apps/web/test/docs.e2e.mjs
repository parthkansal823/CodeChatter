// Docs, two people: a page made by one shows up live for the other, #tags
// filter the page list, a comment on selected text reaches everyone, version
// history opens, and the calendar opens today's note.
//   node test/docs.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch, sleep } from "./browser.mjs";

const stamp = Date.now().toString(36);
const title = `Release plan ${stamp}`;
const tag = `launch${stamp}`;
const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;
for (const page of [a, b]) {
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await page.getByRole("complementary", { name: "Pages" }).waitFor({ timeout: 30_000 });
}

// test1 makes a page.
await a.getByRole("button", { name: "New page" }).first().click();
await a.getByRole("menuitem", { name: /Empty page/ }).click();
const titleBox = a.getByRole("textbox", { name: "Page title" });
await titleBox.waitFor();
await titleBox.fill(title);
await titleBox.press("Enter");
await a.keyboard.type(`Ship it on Friday. #${tag} `);
await sleep(1500);

// test2 sees it appear and opens it.
const listed = b.getByRole("navigation", { name: "Page list" }).getByText(title, { exact: true });
const appeared = await listed.waitFor({ timeout: 15_000 }).then(() => true, () => false);
check("pageAppearsForOthers", appeared);
if (appeared) await listed.click();
const content = b.locator(".cc-doc-content");
const synced = await content.getByText("Ship it on Friday.").waitFor({ timeout: 15_000 }).then(() => true, () => false);
check("contentSyncsLive", synced);

// Ctrl+clicking the #tag (a plain click places the caret) filters the page list.
await a.locator(".cc-doc-content").getByText(`#${tag}`).click({ modifiers: ["Control"] });
const tagged = a.getByRole("region", { name: `Tagged #${tag}` });
check("tagFiltersPageList", await tagged.getByText(title).waitFor({ timeout: 5_000 }).then(() => true, () => false));

// A comment on selected text: test1 writes it, test2 sees the count.
await a.locator(".cc-doc-content p").first().click({ position: { x: 4, y: 8 } });
await a.keyboard.press("Home");
for (let i = 0; i < "Ship it".length; i++) await a.keyboard.press("Shift+ArrowRight");
await a.getByRole("toolbar", { name: "Text formatting" }).getByRole("button", { name: "Comment", exact: true }).click();
const box = a.getByRole("textbox", { name: "Add a comment" });
await box.fill("Friday is tight, maybe Monday?");
await box.press("Enter");
const counted = await b.getByRole("button", { name: "Comments, 1 open" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
check("commentReachesOthers", counted);

// Version history opens beside the page.
await a.getByRole("button", { name: "Version history" }).click();
check("historyOpens", await a.getByRole("complementary", { name: "Version history" }).waitFor({ timeout: 5_000 }).then(() => true, () => false));
await a.getByRole("button", { name: "Close version history" }).click();

// The calendar opens (or starts) today's note.
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
await a.getByRole("button", { name: "Pick a day" }).click();
await a.getByRole("button", { name: new RegExp(`^${today}`) }).click();
check("calendarOpensTodaysNote", (await titleBox.inputValue().catch(() => "")) === today, await titleBox.inputValue().catch(() => "no title"));

// The graph shows the pages as nodes you can open.
await a.getByRole("button", { name: "Graph", exact: true }).click();
const graph = a.getByRole("img", { name: "Graph of pages and the files they link to" }).or(a.locator('svg[aria-label="Graph of pages and the files they link to"]'));
const shown = await graph.first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
check("graphShowsPages", shown && (await a.getByRole("button", { name: `Open page ${title}` }).count()) === 1);

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/docs.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
