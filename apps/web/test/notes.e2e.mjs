// Notes (roadmap §5), with two people in E2ETST. test1 writes in Room notes and test2 sees it; test1's My notes stay
// test1's (test2's are their own, empty of it). The focus timer is shared: test1 picks 15 minutes and starts it,
// test2 sees it counting and who started it, test2 pauses it and test1 sees it stop; Reset puts it back. What the
// test wrote is cleared and the timer goes back to 25 and 5 minutes.
//   node test/notes.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const shared = `Standup at ten ${stamp}`;
const secret = `my own note ${stamp}`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const { page: b } = await signIn("test2@codechatter.local");
const notes = (page) => page.getByRole("region", { name: "Notes" });
const timer = (page) => notes(page).getByRole("group", { name: "Focus timer" });
const tab = (page, name) => notes(page).getByRole("tab", { name });
const content = (page, label) => notes(page).getByRole("textbox", { name: label });

async function openNotes(page) {
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await notes(page).waitFor({ timeout: 15_000 });
}
async function clear(page, label) {
  await content(page, label).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
}

try {
  await openNotes(a);
  await openNotes(b);

  // Room notes: written by one, seen by the other.
  await content(a, "Room notes").click();
  await a.keyboard.type(shared);
  check("roomNotesShared", await ok(content(b, "Room notes").getByText(shared).waitFor({ timeout: 10_000 })));

  // My notes: test1's stay test1's.
  await tab(a, "My notes").click();
  await content(a, "My notes").click();
  await a.keyboard.type(secret);
  await a.waitForTimeout(1_500);
  await tab(b, "My notes").click();
  await content(b, "My notes").waitFor({ timeout: 10_000 });
  check("myNotesPrivate", (await content(b, "My notes").getByText(secret).count()) === 0 && (await content(a, "My notes").getByText(secret).count()) === 1);

  // The focus timer, shared.
  await timer(a).getByLabel("Focus minutes").selectOption("15");
  check("lengthShared", await ok(timer(b).getByText("15:00", { exact: true }).waitFor({ timeout: 10_000 })));
  await timer(a).getByRole("button", { name: "Start the timer" }).click();
  check("othersSeeItRun", await ok(timer(b).getByRole("button", { name: "Pause the timer" }).waitFor({ timeout: 10_000 })) && (await timer(b).innerText()).includes("Started by test1"));
  await a.waitForTimeout(2_200);
  const running = await timer(b).getByRole("timer").innerText();
  check("countsDown", /^14:5\d$/.test(running), running);
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "notes.png") });
  await timer(b).getByRole("button", { name: "Pause the timer" }).click();
  check("pauseReachesOthers", await ok(timer(a).getByRole("button", { name: "Start the timer" }).waitFor({ timeout: 10_000 })));
  const pausedA = await timer(a).getByRole("timer").innerText();
  await a.waitForTimeout(1_500);
  check("pausedStaysPut", (await timer(a).getByRole("timer").innerText()) === pausedA, pausedA);
  await timer(a).getByRole("button", { name: "Reset the timer" }).click();
  check("resetForEveryone", await ok(timer(b).getByText("15:00", { exact: true }).waitFor({ timeout: 10_000 })));
} catch (error) {
  const shot = join(tmpdir(), "notes-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    await timer(a).getByLabel("Focus minutes").selectOption("25");
    await timer(a).getByLabel("Break minutes").selectOption("5");
    await timer(a).getByRole("button", { name: "Reset the timer" }).click();
    await tab(a, "My notes").click();
    await clear(a, "My notes");
    await tab(a, "Room notes").click();
    await clear(a, "Room notes");
    await a.waitForTimeout(1_000);
    check("cleanedUp", (await content(b, "Room notes").getByText(shared).count()) === 0 || (await tab(b, "Room notes").click(), (await content(b, "Room notes").getByText(shared).count()) === 0));
  } catch (error) {
    check("cleanedUp", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
