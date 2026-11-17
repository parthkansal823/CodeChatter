/** Verify two interviewers' independent drafts, confirmation, blind submission, live review and report in disposable interview fixtures with no seeded role changes. */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { BASE, PASSWORD, check, finish, launch } from "./browser.mjs";

// The web package does not depend on DB tools; reuse the installed collab test dependencies.
const requireCollab = createRequire(new URL("../../collab/package.json", import.meta.url));
const { createDb, schema } = requireCollab("@codechatter/db");
const { eq } = requireCollab("drizzle-orm");
if (!process.env.DATABASE_URL) process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
const database = createDb(process.env.DATABASE_URL, { max: 1 });
const stamp = randomUUID();
const FIRST = `First private judgement ${stamp}`;
const SECOND = `Second private judgement ${stamp}`;
let browser, errors = [], one, two, questionId, interviewId, roomId, batchId;
let stage = "launch browser";

function verify(name, condition) {
  check(name, condition);
  if (!condition) throw new Error("CheckFailed");
}
async function request(profile, path, method = "GET", data) {
  const response = await profile.context.request.fetch(`${BASE}/api/${path}`, { method, headers: { origin: new URL(BASE).origin }, ...(data !== undefined && { data }) });
  return { status: response.status(), body: await response.json().catch(() => null) };
}
async function profile(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", () => errors.push("PageError"));
  page.setDefaultTimeout(30_000);
  const person = { context, page };
  const result = await request(person, "auth/sign-in/email", "POST", { email, password: PASSWORD });
  if (result.status !== 200) throw new Error("SignInFailed");
  person.user = result.body.user;
  return person;
}
async function score(page, value, recommendation, notes) {
  await page.getByRole("radiogroup", { name: "Clarity", exact: true }).getByRole("radio", { name: `${value} out of 5` }).click();
  await page.getByRole("radiogroup", { name: "Overall", exact: true }).getByRole("radio", { name: `${value} out of 5` }).click();
  await page.getByRole("radiogroup", { name: "Recommendation", exact: true }).getByRole("radio", { name: recommendation, exact: true }).click();
  await page.getByLabel("Notes", { exact: true }).fill(notes);
}
async function submit(page) {
  await page.getByRole("button", { name: "Submit scorecard", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Submit again", exact: true }).waitFor();
}
async function shot(page, name) {
  if (process.env.SHOTS) {
    const { join } = await import("node:path");
    await page.screenshot({ path: join(process.env.SHOTS, `${name}.png`), fullPage: true });
  }
}

try {
  ({ browser, errors } = await launch());
  [one, two] = await Promise.all([profile("test1@codechatter.local"), profile("test2@codechatter.local")]);
  stage = "create disposable interview";
  const question = await request(one, "interview-questions", "POST", { title: `Scorecards ${stamp}`, prompt: "Talk through your reasoning.", file: "main.py", starterFiles: [{ path: "main.py", content: "# scorecards\n" }], tests: [], rubric: [{ id: "clarity", label: "Clarity" }], durationMinutes: 30, timeLimitMs: 2000 });
  verify("a disposable rubric question is created", question.status === 201);
  questionId = question.body.id;
  const scheduled = await request(one, "interviews", "POST", { questionId, candidateName: `Scorecard candidate ${stamp}`, durationMinutes: 30 });
  verify("a disposable interview is scheduled", scheduled.status === 201);
  ({ id: interviewId, roomId } = scheduled.body);
  await database.db.insert(schema.roomMembers).values({ roomId, userId: two.user.id, role: "interviewer" });
  // Review after finish is deliberate: polling must still show a colleague's later submission.
  await database.db.update(schema.interviews).set({ status: "finished", finishedAt: new Date() }).where(eq(schema.interviews.id, interviewId));
  const [room] = await database.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId));
  const [batch] = await database.db.insert(schema.interviewBatches).values({ orgId: room.orgId, createdBy: one.user.id, mode: "interview", title: `Scorecard batch ${stamp}`, durationMinutes: 30, paper: { fixed: [], random: [] } }).returning();
  batchId = batch.id;
  await database.db.update(schema.interviews).set({ batchId }).where(eq(schema.interviews.id, interviewId));
  const url = `${BASE}/interviews/${interviewId}`;
  await Promise.all([one.page.goto(url), two.page.goto(url)]);
  await Promise.all([one.page.getByLabel("Notes", { exact: true }).waitFor(), two.page.getByLabel("Notes", { exact: true }).waitFor()]);
  stage = "save simultaneous personal drafts";
  await Promise.all([score(one.page, 4, "Yes", FIRST), score(two.page, 2, "Maybe", SECOND)]);
  await Promise.all([one.page.getByRole("button", { name: "Save scorecard", exact: true }).click(), two.page.getByRole("button", { name: "Save scorecard", exact: true }).click()]);
  await Promise.all([one.page.getByRole("button", { name: "Saved", exact: true }).waitFor(), two.page.getByRole("button", { name: "Saved", exact: true }).waitFor()]);
  await Promise.all([one.page.reload(), two.page.reload()]);
  verify("both drafts persist across reloads without overwriting each other", await one.page.getByLabel("Notes", { exact: true }).inputValue() === FIRST && await two.page.getByLabel("Notes", { exact: true }).inputValue() === SECOND);
  verify("neither draft author sees the other's notes", !(await one.page.locator("body").innerText()).includes(SECOND) && !(await two.page.locator("body").innerText()).includes(FIRST));
  stage = "confirmation and first submission";
  await one.page.getByRole("button", { name: "Submit scorecard", exact: true }).click();
  await one.page.getByRole("alertdialog").getByRole("button", { name: "Go back", exact: true }).click();
  verify("cancelling the confirmation keeps the scorecard a private draft", (await request(one, `interviews/${interviewId}`)).body.scorecards.own.submittedAt === null);
  await submit(one.page);
  await two.page.getByText("1 other scorecard submitted.", { exact: true }).waitFor();
  verify("the other interviewer sees the count without the submitted judgement", !(await two.page.locator("body").innerText()).includes(FIRST) && await two.page.getByRole("region", { name: "Scorecard summary", exact: true }).count() === 0);
  await shot(two.page, "scorecards-blind");
  stage = "second submission and live review";
  await submit(two.page);
  const otherForOne = one.page.getByRole("article", { name: `Submitted scorecard by ${two.user.name}`, exact: true });
  const otherForTwo = two.page.getByRole("article", { name: `Submitted scorecard by ${one.user.name}`, exact: true });
  await Promise.all([otherForOne.getByText(SECOND, { exact: true }).waitFor(), otherForTwo.getByText(FIRST, { exact: true }).waitFor()]);
  verify("both submitted judgements appear read-only without reloading", await otherForOne.locator("textarea,input,button").count() === 0 && await otherForTwo.locator("textarea,input,button").count() === 0);
  const summary = one.page.getByRole("region", { name: "Scorecard summary", exact: true });
  verify("the summary has criterion averages and recommendation spread", (await summary.innerText()).includes("Clarity: 3 / 5") && (await summary.innerText()).includes("1 yes, 1 maybe"));
  await shot(one.page, "scorecards-submitted");
  stage = "phone and dark theme";
  await two.page.setViewportSize({ width: 390, height: 844 });
  await two.page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.classList.remove("light"); });
  verify("the scorecard form and review fit a phone", await two.page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth));
  await shot(two.page, "scorecards-phone-dark");
  stage = "report and download";
  await one.page.getByRole("tab", { name: "Report", exact: true }).click();
  const report = await one.page.getByLabel("The report").innerText();
  verify("the report includes both submitted authors, notes and summary", report.includes(FIRST) && report.includes(SECOND) && report.includes("1 yes, 1 maybe") && report.includes("| Clarity | 3 / 5 | 2 |"));
  const downloadPromise = one.page.waitForEvent("download");
  await one.page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let downloaded = "";
  for await (const chunk of stream) downloaded += chunk.toString();
  verify("the downloaded report matches the visible permitted report", downloaded === report);
  stage = "batch results";
  await one.page.goto(`${BASE}/interviews/batches/${batchId}`);
  const details = one.page.locator("details");
  await details.locator("summary").click();
  await details.getByText(SECOND, { exact: true }).waitFor();
  verify("batch results include each submitted card and its summary", (await details.innerText()).includes(FIRST) && (await details.innerText()).includes("Clarity: 3 / 5"));
  stage = "room interview tool";
  await one.page.goto(`${BASE}/rooms/${roomId}`);
  const evaluation = one.page.getByRole("region", { name: "Your evaluation", exact: true });
  if (!await evaluation.isVisible()) await one.page.getByRole("tab", { name: "Interview", exact: true }).click();
  await evaluation.getByLabel("Notes", { exact: true }).waitFor({ timeout: 60_000 });
  verify("the room tool shows the same own card and read-only submitted review", await evaluation.getByLabel("Notes", { exact: true }).inputValue() === FIRST && (await evaluation.innerText()).includes(SECOND));
  stage = "submission failure";
  await evaluation.getByLabel("Notes", { exact: true }).fill("An unsaved revision");
  await one.page.route(`**/api/interviews/${interviewId}/scorecard`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Try again shortly." }) }));
  stage = "open failed submission confirmation";
  await evaluation.getByRole("button", { name: "Submit again", exact: true }).click();
  stage = "send failed submission";
  const failedResponse = one.page.waitForResponse((response) => response.url().endsWith(`/api/interviews/${interviewId}/scorecard`) && response.request().method() === "PUT");
  await one.page.getByRole("alertdialog").getByRole("button", { name: "Submit", exact: true }).click();
  verify("the submission failure is delivered to the form", (await failedResponse).status() === 503);
  stage = "show failed submission error";
  const failure = one.page.getByText("Couldn't save your scorecard. Your changes are still here. Try again.", { exact: true });
  await failure.waitFor();
  verify("a failed submit keeps the confirmation open with an error", await one.page.getByRole("alertdialog").isVisible());
  await one.page.unroute(`**/api/interviews/${interviewId}/scorecard`);
  await one.page.getByRole("alertdialog").getByRole("button", { name: "Go back", exact: true }).click();
  verify("a failed submit retains the unsaved notes", await evaluation.getByLabel("Notes", { exact: true }).inputValue() === "An unsaved revision");
  stage = "retry failed submission";
  await evaluation.getByRole("button", { name: "Submit again", exact: true }).click();
  await one.page.getByRole("alertdialog").getByRole("button", { name: "Submit", exact: true }).click();
  await one.page.getByRole("alertdialog").waitFor({ state: "hidden" });
  verify("retry submits the retained notes successfully", (await request(one, `interviews/${interviewId}`)).body.scorecards.own.notes === "An unsaved revision");
} catch (error) {
  check(`scorecard browser workflow completes (${stage})`, false, error?.name ?? "Error");
  if (process.env.SHOTS && one?.page) await shot(one.page, "scorecards-failure").catch(() => {});
} finally {
  // Delete only this test's fixtures, including when a browser assertion fails.
  try {
    if (roomId) await database.db.delete(schema.rooms).where(eq(schema.rooms.id, roomId));
    if (batchId) await database.db.delete(schema.interviewBatches).where(eq(schema.interviewBatches.id, batchId));
    if (questionId) await database.db.delete(schema.interviewQuestions).where(eq(schema.interviewQuestions.id, questionId));
    check("disposable interview fixtures are cleaned up", !roomId || !(await database.db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId))).length);
  } catch { check("disposable interview fixtures are cleaned up", false); }
  for (const person of [one, two]) {
    if (!person) continue;
    await request(person, "auth/sign-out", "POST", {}).catch(() => {});
    await person.context.close().catch(() => {});
  }
  await browser?.close().catch(() => {});
  await database.close();
}
check("no browser page errors", errors.length === 0);
finish();
