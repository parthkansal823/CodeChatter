// The room shows each person once: your other tabs aren't "someone else",
// and no panel shows a stray scrollbar (Windows draws them with ▲▼ buttons).
//   node test/room-people.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BASE, check, finish, launch, ROOM, sleep } from "./browser.mjs";

const { browser, errors, signIn } = await launch();
const one = await signIn("test1@codechatter.local");
const secondTab = await one.context.newPage(); // test1 again, in another tab
await secondTab.goto(`${BASE}/rooms/${ROOM}`);
await secondTab.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
await signIn("test2@codechatter.local");
await sleep(2500); // presence travels over awareness

const page = one.page;
const people = await page.evaluate(() => document.body.innerText.match(/(\d+) (?:people|person)/)?.[0] ?? "");
check("countsEachPersonOnce", people === "2 people", people || "no people count found");
const group = page.locator("header [aria-label$='people here']");
const here = await group.getAttribute("aria-label");
const avatars = await group.locator(":scope > *").count();
check("titleBarShowsEachPersonOnce", here === "2 people here" && avatars === 2, `${here}; ${avatars} avatars (you + test2)`);

// Open the bottom panel with a few terminals, then look for boxes outside Monaco and xterm that would draw a stray scrollbar.
await page.keyboard.press("Control+`");
await sleep(1500);
for (let i = 0; i < 2; i++) await page.getByRole("button", { name: /new terminal/i }).click().catch(() => {});
await sleep(2500);
const bars = await page.evaluate(() => {
  const found = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".monaco-editor, .xterm")) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const style = getComputedStyle(el);
    // A box that overflows by a few pixels gets a scrollbar with nothing to scroll (Windows draws
    // ▲▼ buttons). Headless Edge hides scrollbars, so the overflow itself is what's checked.
    const overY = /(auto|scroll)/.test(style.overflowY) ? el.scrollHeight - el.clientHeight : 0;
    const overX = /(auto|scroll)/.test(style.overflowX) ? el.scrollWidth - el.clientWidth : 0;
    const accidental = (overY > 0 && overY <= 4) || (overX > 0 && overX <= 4);
    if (accidental && style.scrollbarWidth !== "none") {
      const label = el.getAttribute("aria-label") ?? el.getAttribute("role") ?? "";
      found.push(`${el.tagName.toLowerCase()}${label ? `[${label}]` : ""} ${Math.round(box.width)}x${Math.round(box.height)} over y+${el.scrollHeight - el.clientHeight} x+${el.scrollWidth - el.clientWidth} .${String(el.className).slice(0, 60)}`);
    }
  }
  return found;
});
check("noStrayScrollbars", bars.length === 0, bars.join(" | "));

// The terminal follows the theme: light page, light terminal; switch, and both are dark (it once lagged a switch behind).
const terminalMatchesPage = () =>
  page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const light = (c) => {
      const [r, g, b] = parse(c);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b > 127;
    };
    const term = [...document.querySelectorAll(".xterm")].find((el) => el.offsetParent);
    if (!term) return { ok: false, why: "no visible terminal" };
    const box = term.getBoundingClientRect();
    // The colour actually painted at the terminal's centre: the first layer down that isn't transparent.
    const painted = document
      .elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      .map((el) => getComputedStyle(el).backgroundColor)
      .find((c) => !/rgba\(.*,\s*0\)$/.test(c) && c !== "transparent");
    const pageColour = getComputedStyle(document.body).backgroundColor;
    return { ok: Boolean(painted) && light(painted) === light(pageColour.startsWith("lab(") ? (parse(pageColour)[0] > 50 ? "rgb(255,255,255)" : "rgb(0,0,0)") : pageColour), painted, pageColour };
  });
const before = await terminalMatchesPage();
await page.getByRole("button", { name: /theme|dark|light/i }).first().click();
await page.waitForTimeout(1500);
const after = await terminalMatchesPage();
check("terminalFollowsTheme", before.ok && after.ok, JSON.stringify({ before, after }));

// Following from the People panel (opened from the faces in the top bar): one click, and again to stop.
await page.getByTitle("Who's here").click();
const followTwo = page.getByRole("button", { name: "Follow test2" });
await followTwo.click();
const banner = page.getByText(/Following test2/);
check("followFromPeoplePanel", (await banner.waitFor({ timeout: 5_000 }).then(() => true, () => false)) && (await page.getByRole("button", { name: "Stop following test2" }).getAttribute("aria-pressed")) === "true");
await page.getByRole("button", { name: "Stop following test2" }).click();
check("stopFollowingFromPeoplePanel", await banner.waitFor({ state: "detached", timeout: 5_000 }).then(() => true, () => false));

await page.screenshot({ path: process.env.SHOT ?? join(tmpdir(), "room-people.png") });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
