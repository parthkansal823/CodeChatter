// Interview mode in the browser, in a disposable interview room: an interviewer writes a question, schedules it and
// starts it; a candidate with no account joins from the link and waits; the question, tests and timer appear for them,
// with no AI and nothing hidden on the page; the interviewer scores, finishes, replays and reads the report. The API's
// rules are tested in apps/collab/test/interviews.e2e.mjs. SHOTS=<folder> saves screenshots.
//   node test/interviews.e2e.mjs        (from apps/web, with the dev stack running)
import { join } from "node:path";

import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const stamp = Date.now().toString(36);
const TITLE = `Add two numbers ${stamp}`;
const PROMPT = "Read two numbers and print their sum.";
const SOLUTION = "a, b = input().split()\nprint(int(a) + int(b))\n";
const HIDDEN_INPUT = "7001 7002";
const HIDDEN_OUTPUT = "14003";
const shot = async (page, name) => {
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`) });
};

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
let interviewId = null;
let questionId = null;

try {
  // The question.
  await a.goto(`${BASE}/interviews`);
  await a.getByRole("heading", { name: "Interviews", exact: true }).waitFor({ timeout: 30_000 });
  check("the nav link goes to a real page", await a.getByRole("tab", { name: "Question bank" }).isVisible());
  await a.getByRole("link", { name: "New question" }).first().click();
  await a.getByLabel("Title").waitFor({ timeout: 30_000 });
  await a.getByLabel("Title").fill(TITLE);
  await a.getByLabel("What the candidate reads").fill(PROMPT);
  await a.getByLabel("Contents of main.py").fill(SOLUTION);
  await a.getByLabel("Input", { exact: true }).nth(0).fill("1 2\n");
  await a.getByLabel("Expected output").nth(0).fill("3\n");
  await a.getByLabel("Input", { exact: true }).nth(1).fill(`${HIDDEN_INPUT}\n`);
  await a.getByLabel("Expected output").nth(1).fill(`${HIDDEN_OUTPUT}\n`);
  await shot(a, "question-form");
  await a.getByRole("button", { name: "Add question" }).click();
  await a.getByRole("link", { name: TITLE, exact: true }).waitFor({ timeout: 15_000 });
  check("a question is added to the bank", true);
  questionId = await a.evaluate((title) => fetch("/api/interview-questions").then((r) => r.json()).then((list) => list.find((q) => q.title === title)?.id), TITLE);

  // Scheduling.
  await a.getByRole("button", { name: "Schedule an interview" }).first().click();
  await a.getByLabel("Candidate's name").fill("Ana Candidate");
  await a.getByRole("button", { name: "Schedule", exact: true }).click();
  const linkField = a.getByRole("textbox", { name: "The candidate's link" });
  await linkField.waitFor({ timeout: 15_000 });
  const link = await linkField.inputValue();
  check("scheduling shows the candidate's link", link.includes("/interview/"), link.slice(0, 40));
  await shot(a, "link-dialog");
  await a.getByRole("button", { name: "Open the interview" }).click();
  await a.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  interviewId = a.url().split("/").at(-1);
  await a.getByText("The candidate hasn't used their link yet.").waitFor({ timeout: 15_000 });
  check("the interview's page says the link is unused", true);

  // The candidate, with no account.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const c = await context.newPage();
  c.on("pageerror", (error) => errors.push(`candidate: ${error.message.split("\n")[0]}`));
  await c.goto(link);
  await c.getByRole("button", { name: "Join as Ana Candidate" }).waitFor({ timeout: 30_000 });
  const landing = await c.locator("main").innerText();
  check("the landing page has none of the question", !landing.includes(stamp) && !landing.includes(PROMPT), landing);
  check("it says AI is off", landing.includes("AI help is off"));
  await shot(c, "landing");
  await c.getByRole("button", { name: "Join as Ana Candidate" }).click();
  await c.getByRole("heading", { name: "You're in the waiting room" }).waitFor({ timeout: 15_000 });
  check("a guest joins, and waits", true);
  await shot(c, "waiting");

  await a.getByText("Ana Candidate is in the waiting room.").waitFor({ timeout: 15_000 });
  check("the interviewer sees them waiting", true);

  // It starts: the waiting page opens the room by itself.
  await a.getByRole("button", { name: "Start", exact: true }).click();
  await c.waitForURL(/\/rooms\/[A-Z0-9]{6}/, { timeout: 20_000 });
  check("the room opens by itself when it starts", true);
  const panel = c.getByRole("region", { name: "The question" });
  await panel.getByText(PROMPT).waitFor({ timeout: 60_000 });
  check("the candidate sees the question", true);
  check("the timer runs, from the server", await ok(c.getByRole("timer").filter({ hasText: /\d+:\d\d left/ }).waitFor({ timeout: 10_000 })));
  await c.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^main\.py/ }).waitFor({ timeout: 30_000 });
  check("the starter file is there", true);
  // Monaco writes spaces as non-breaking ones.
  const lines = c.locator(".monaco-editor .view-lines");
  check("the candidate's editor shows it", await ok(lines.filter({ hasText: /input\(\)\.split\(\)/ }).waitFor({ timeout: 60_000 })));
  check("there's no AI tab for them", (await c.getByRole("tab", { name: "AI", exact: true }).count()) === 0);
  await shot(c, "candidate-room");

  await c.getByRole("button", { name: "Run tests" }).click();
  await c.getByRole("region", { name: "Test runs" }).getByText("2 of 2 passed").waitFor({ timeout: 90_000 });
  check("the tests run and pass", true);
  check("hidden tests are only counted", await c.getByText("Hidden tests: 1 of 1 passed").isVisible());
  const seen = await c.locator("body").innerText();
  check("no hidden input or output anywhere on the page", !seen.includes(HIDDEN_INPUT) && !seen.includes(HIDDEN_OUTPUT));

  // The interviewer's side.
  await a.getByRole("tab", { name: /Test runs/ }).click();
  await a.getByText("2 of 2 passed").waitFor({ timeout: 15_000 });
  await a.getByText("Hidden test 1").first().click();
  check("the interviewer sees the hidden case", await ok(a.getByText(HIDDEN_INPUT).first().waitFor({ timeout: 5000 })));
  await shot(a, "runs");

  await a.getByRole("tab", { name: "Scorecard" }).click();
  await a.getByRole("radiogroup", { name: "Problem solving" }).getByRole("radio", { name: "4 out of 5" }).click();
  await a.getByRole("radiogroup", { name: "Overall" }).getByRole("radio", { name: "4 out of 5" }).click();
  await a.getByRole("radiogroup", { name: "Recommendation" }).getByRole("radio", { name: "Yes" }).click();
  await a.getByLabel("Notes", { exact: true }).fill("Clear thinking.");
  await a.getByRole("button", { name: "Save scorecard" }).click();
  await a.getByRole("button", { name: "Saved" }).waitFor({ timeout: 15_000 });
  check("the scorecard saves", true);
  await shot(a, "scorecard");

  // Finishing takes the candidate's rights.
  await a.getByRole("button", { name: "Finish" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Finish" }).click();
  await a.getByText("Finished", { exact: true }).first().waitFor({ timeout: 15_000 });
  check("the interviewer finishes it", true);
  await c.getByText("This interview has finished.").waitFor({ timeout: 30_000 });
  await c.getByRole("region", { name: "The question" }).getByText(PROMPT).waitFor({ timeout: 60_000 });
  check("the candidate's page shows it finished, and they can still read it", true);
  const after = c.locator(".monaco-editor .view-lines");
  check("their code is still in the editor", await ok(after.filter({ hasText: /input\(\)\.split\(\)/ }).waitFor({ timeout: 60_000 })));
  check("the editor says it's read-only", await c.getByText("Read only").first().isVisible());
  check("Run tests is gone for them", (await c.getByRole("button", { name: "Run tests" }).count()) === 0);
  check("the candidate is a viewer now", (await c.evaluate((url) => fetch(url).then((r) => r.json()).then((room) => room.role), `/api/rooms/${c.url().split("/rooms/")[1].slice(0, 6)}`)) === "viewer");
  await shot(c, "candidate-finished");

  // Replay and report.
  await a.getByRole("tab", { name: "Replay" }).click();
  const slider = a.getByRole("slider", { name: "Moment in the interview" });
  await slider.waitFor({ timeout: 30_000 });
  const code = a.getByLabel(/^main\.py at /);
  check("the replay ends on their answer", (await code.innerText()).includes("print(int(a) + int(b))"));
  check("it lists the test run", await a.getByRole("button", { name: /2 of 2 passed/ }).isVisible());
  await shot(a, "replay");
  await a.getByRole("tab", { name: "Report" }).click();
  const report = await a.getByLabel("The report").innerText();
  check("the report has the result", report.includes("Interview report: Ana Candidate") && report.includes("**Recommendation:** Yes") && report.includes("2 of 2 passed") && report.includes("Clear thinking."), report.slice(0, 80));
  await shot(a, "report");

  // Phone width: nothing runs off the side.
  await a.setViewportSize({ width: 390, height: 800 });
  await a.getByRole("tab", { name: "Scorecard" }).click();
  check("the interview's page fits a phone", await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(a, "detail-phone");
  await a.goto(`${BASE}/interviews`);
  await a.getByRole("tab", { name: "Question bank" }).waitFor({ timeout: 15_000 });
  await a.getByRole("link", { name: "Ana Candidate" }).first().waitFor({ timeout: 15_000 });
  check("the list fits a phone", await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(a, "list-phone");
  await a.setViewportSize({ width: 1440, height: 900 });
  await shot(a, "list");
  await context.close();

  // Deleting.
  await a.goto(`${BASE}/interviews/${interviewId}`);
  await a.getByRole("button", { name: "Delete" }).click();
  await a.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await a.waitForURL(/\/interviews$/, { timeout: 15_000 });
  check("an interview can be deleted", true);
  interviewId = null;
} catch (error) {
  check("the flow completes", false, error instanceof Error ? error.message : String(error));
  await shot(a, "failure").catch(() => {});
} finally {
  await a.evaluate(async ([interview, question]) => {
    if (interview) await fetch(`/api/interviews/${interview}`, { method: "DELETE" });
    if (question) await fetch(`/api/interview-questions/${question}`, { method: "DELETE" });
  }, [interviewId, questionId]).catch(() => {});
}

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
finish();
