// The AI reviewing a whole batch, from the results page: one at a time, with progress, most to check first, stoppable,
// and stopping when the AI refuses. The model's answers are stood in for here, since what's under test is the page:
// apps/api/test/interview-ai-review.e2e.mjs tests what the review itself does.
//   node test/interview-ai-batch.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const TAG = `ab${stamp}`;
const NAMES = ["Asha", "Bo", "Cy"];
const TO_CHECK = { Asha: 0, Bo: 2, Cy: 5 };
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
const headers = { origin: BASE };
let questionId;
let batchId;

try {
  const question = await page.request.post(`${BASE}/api/interview-questions`, { headers, data: { kind: "short", title: `Why ${TAG}`, tags: [TAG], marks: 5 } });
  questionId = (await question.json()).id;
  const made = await page.request.post(`${BASE}/api/interview-batches`, { headers, data: { mode: "assessment", title: `Batch ${TAG}`, durationMinutes: 30, paper: { random: [{ count: 1, tag: TAG }] }, candidates: NAMES.map((name) => ({ name })) } });
  check("schedules", made.status() === 201);
  const batch = await made.json();
  batchId = batch.id;

  // Everyone has started, and what's been reviewed so far.
  const nameOf = new Map();
  let reviewed = new Set();
  await page.route(`**/api/interview-batches/${batchId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    for (const row of body.rows) {
      nameOf.set(row.interviewId, row.candidateName);
      row.startedAt = new Date().toISOString();
      row.aiToCheck = reviewed.has(row.interviewId) ? TO_CHECK[row.candidateName] : null;
    }
    return route.fulfill({ response, json: body });
  });

  // The review itself: what each call did is set by the part of the test running.
  let answer = async () => ({ status: 200, json: {} });
  const calls = [];
  await page.route("**/api/interviews/*/ai-review", async (route) => {
    const id = route.request().url().split("/").at(-2);
    calls.push({ id, body: route.request().postDataJSON() });
    const result = await answer(id, calls.length);
    return route.fulfill(result);
  });

  const open = async () => {
    await page.goto(`${BASE}/interviews/batches/${batchId}`);
    await page.getByRole("button", { name: "Ask the AI about all" }).waitFor();
  };
  const firstRow = () => page.locator("tbody tr").first();

  // All of them.
  await open();
  check("nobodyHasACountYet", (await page.getByText(/to check$/).count()) === 0);
  answer = async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    reviewed.add(id);
    return { status: 200, json: {} };
  };
  await page.getByRole("button", { name: "Ask the AI about all" }).click();
  check("itSaysHowFarItsGot", await ok(page.getByRole("status").filter({ hasText: /has reviewed \d of 3/ }).waitFor({ timeout: 5000 })));
  check("andOffersToStop", await page.getByRole("button", { name: "Stop the AI" }).isVisible());
  check("thenItFinishes", await ok(page.getByText("The AI has looked at everyone.").waitFor({ timeout: 20_000 })));
  check("oneCallForEach", calls.length === 3 && new Set(calls.map((call) => call.id)).size === 3, String(calls.length));
  check("sendingWhatTheyWrote", calls.every((call) => Array.isArray(call.body.files)));
  check("butNoRecording", calls.every((call) => !call.body.webcam && !call.body.screen));
  check("mostToCheckComesFirst", (await firstRow().innerText()).includes("Cy"), await firstRow().innerText());
  check("withItsCount", await page.getByText("5 to check").isVisible());
  check("andNothingToCheckSaysSo", await page.getByText("Nothing to check").isVisible());
  check("thereIsNobodyLeftToAskAbout", await page.getByRole("button", { name: "Ask the AI about all" }).isDisabled());

  // Stopping keeps what's done.
  reviewed = new Set();
  calls.length = 0;
  await open();
  answer = async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    reviewed.add(id);
    return { status: 200, json: {} };
  };
  await page.getByRole("button", { name: "Ask the AI about all" }).click();
  await page.getByRole("button", { name: "Stop the AI" }).click();
  check("stoppingStops", await ok(page.getByRole("button", { name: "Ask the AI about all" }).waitFor({ timeout: 10_000 })));
  check("afterTheOneItWasOn", calls.length === 1, String(calls.length));
  check("whichIsKept", (await page.getByText(/to check$/).count()) === 1 && reviewed.size === 1 && nameOf.has(calls[0].id));
  check("andItCanPickUpTheRest", await page.getByRole("button", { name: "Ask the AI about all" }).isEnabled());

  // The AI saying no to one says no to all.
  reviewed = new Set();
  calls.length = 0;
  await open();
  answer = async () => ({ status: 429, contentType: "application/problem+json", json: { detail: "You've used the AI a lot just now.", status: 429, title: "Too many" } });
  await page.getByRole("button", { name: "Ask the AI about all" }).click();
  check("aRefusalIsShown", await ok(page.getByText("You've used the AI a lot just now.").waitFor({ timeout: 8000 })));
  check("andEndsTheRound", calls.length === 1, String(calls.length));

  // One that fails doesn't stop the others.
  calls.length = 0;
  await open();
  answer = async (id, n) => {
    if (n === 2) return { status: 502, contentType: "application/problem+json", json: { detail: "Unreadable", status: 502, title: "Bad" } };
    reviewed.add(id);
    return { status: 200, json: {} };
  };
  await page.getByRole("button", { name: "Ask the AI about all" }).click();
  check("oneFailureIsCounted", await ok(page.getByText("1 couldn't be reviewed. Ask again to try those.").waitFor({ timeout: 10_000 })));
  check("andTheOthersGoAhead", calls.length === 3 && reviewed.size === 2, `${calls.length} ${reviewed.size}`);
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 300));
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  if (batchId) await page.request.delete(`${BASE}/api/interview-batches/${batchId}`, { headers }).catch(() => {});
  if (questionId) await page.request.delete(`${BASE}/api/interview-questions/${questionId}`, { headers }).catch(() => {});
  await browser.close();
}
finish();
