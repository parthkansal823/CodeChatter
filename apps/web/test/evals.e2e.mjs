// Evals in a browser, two people: test cases written together, checks that say what's missing, a run with its progress, passes and
// failures per column, what failed and why, what changed from the last run, and Stop. promptfoo is stood in for, so this is the page:
// apps/runner/test/evals.e2e.mjs runs the real thing. The prompt is deleted at the end.
//   node test/evals.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const { page: b } = await signIn("test2@codechatter.local");

const sent = [];
let answer = null;
let holdFor = 0;
const MODELS = { models: ["first", "second"], default: "first", temperature: true, json: true, oneAtATime: false, contextChars: 32000, gateway: { on: true, requests: 120, windowSeconds: 600 } };
const cell = (body, testIndex, columnIndex, pass, extra = {}) => ({ caseId: body.cases[testIndex].id, columnId: body.columns[columnIndex].id, pass, error: null, output: pass ? "Paris is the capital." : "I do not know.", failed: pass ? [] : [{ type: "contains", value: "Paris", reason: 'Expected output to contain "Paris"' }], latencyMs: 1500, inputTokens: 10, outputTokens: 5, ...extra });
const report = (cells) => ({ cells, passed: cells.filter((item) => item.pass).length, failed: cells.filter((item) => !item.pass && !item.error).length, errors: cells.filter((item) => item.error).length, inputTokens: cells.length * 10, outputTokens: cells.length * 5, ms: 4000 });

for (const page of [a, b]) {
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, provider: "openai", model: "first", vision: false, problem: null, limit: { requests: 30, windowSeconds: 600 }, ollama: null } }));
  await page.route("**/api/rooms/*/ai/models", (route) => route.fulfill({ json: MODELS }));
  await page.route("**/api/rooms/*/evals", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (holdFor) await sleep(holdFor);
    const lines = [{ type: "progress", calls: 1 }, answer ? answer(body) : { type: "error", message: "No answer set." }];
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((line) => JSON.stringify(line)).join("\n") + "\n" }).catch(() => {});
  });
}

const open = async (page) => {
  await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Prompts", exact: true }).click();
  const tool = page.getByRole("region", { name: "Prompts" });
  await tool.waitFor({ timeout: 20_000 });
  return tool;
};

try {
  // Nobody signed out gets anything, and it takes real rights.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/evals`, { headers: { origin: BASE }, data: {} });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  const toolA = await open(a);
  const toolB = await open(b);
  const name = `Evals test ${Date.now().toString(36)}`;
  await toolA.getByRole("button", { name: "New prompt" }).first().click();
  await toolA.getByLabel("Prompt name").fill(name);
  await toolB.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name }).click({ timeout: 15_000 });
  await toolA.getByRole("button", { name: "Add a column" }).click();

  await toolA.getByRole("button", { name: "Test it" }).click();
  await toolB.getByRole("button", { name: "Test it" }).click();
  check("itExplainsItselfFirst", await toolA.getByText(/Say what a good answer looks like/).isVisible());
  check("itSaysWhatsMissing", await toolA.getByText("Add a test case first.").isVisible());
  check("runIsOffUntilThen", await toolA.getByRole("button", { name: "Run evals" }).isDisabled());

  // Cases, together.
  await toolA.getByRole("button", { name: "Add a test case" }).click();
  const first = toolA.getByRole("region", { name: "Test case 1" });
  await first.getByLabel("Name of test case 1").fill("France");
  check("theCaseReachesTheOtherPerson", await ok(toolB.getByRole("region", { name: "Test case 1" }).waitFor({ timeout: 15_000 })));
  check("itHasAFieldForEachVariable", await first.getByLabel("Value of topic in France").isVisible());
  check("anEmptyValueShowsThePrompts", (await first.getByLabel("Value of topic in France").getAttribute("placeholder")).includes("recursion"));
  check("aCheckWithNothingInItIsFlagged", await ok(toolA.getByText(/In "France", a check is missing what to look for/).waitFor({ timeout: 5_000 })));
  await first.getByLabel("Value of topic in France").click();
  await first.getByLabel("Value of topic in France").fill("the capital of France");
  await first.getByLabel("What check 1 in France looks for").fill("Paris");
  await first.getByRole("button", { name: "Add a check" }).click();
  await first.getByLabel("Kind of check 2 in France").selectOption("is-json");
  check("aCheckThatNeedsNothingAsksForNothing", (await first.getByLabel("What check 2 in France looks for").count()) === 0);
  await first.getByLabel("Remove check 2 in France").click();
  check("theOtherPersonSeesTheCheck", await ok(b.waitForFunction(() => [...document.querySelectorAll("input")].some((field) => field.value === "Paris"), null, { timeout: 15_000 })));

  await toolB.getByRole("button", { name: "Add a test case" }).click();
  const second = toolA.getByRole("region", { name: "Test case 2" });
  await second.waitFor({ timeout: 15_000 });
  await second.getByLabel("Name of test case 2").fill("Spain");
  await second.getByLabel("What check 1 in Spain looks for").fill("Madrid");
  check("itCountsItsCalls", await ok(toolA.getByText("4 calls to the AI").waitFor({ timeout: 5_000 })));

  // A run: France passes on both, Spain fails on the first.
  holdFor = 1500;
  answer = (body) => ({ type: "done", report: report([cell(body, 0, 0, true), cell(body, 0, 1, true), cell(body, 1, 0, false), cell(body, 1, 1, true)]) });
  await toolA.getByRole("button", { name: "Run evals" }).click();
  check("itShowsItsRunning", await ok(toolA.getByRole("button", { name: "Stop" }).waitFor({ timeout: 5_000 })));
  const results = toolA.getByRole("region", { name: "Results" });
  check("itFinishes", await ok(results.waitFor({ timeout: 15_000 })));
  const body = sent.at(-1);
  check("itSendsTheCasesValues", body.cases[0].values.topic === "the capital of France", JSON.stringify(body.cases[0]));
  check("orThePromptsForACaseWithout", body.cases[1].values.topic === "recursion", JSON.stringify(body.cases[1]));
  check("andItsChecks", body.cases[0].checks[0].value === "Paris" && body.cases[1].checks[0].value === "Madrid");
  check("onEveryColumn", body.columns.length === 2);
  check("theScoreShows", await results.getByText("3 of 4 passed").isVisible());
  const scores = results.getByRole("group", { name: "Scores by column" });
  check("eachColumnHasAScore", (await scores.getByText("1 of 2 (50%)").isVisible()) && (await scores.getByText("2 of 2 (100%)").isVisible()));
  const matrix = results.getByRole("group", { name: "Results by test case" });
  const spain = matrix.getByRole("row", { name: /Spain/ });
  check("failuresAreInWordsNotJustColour", await spain.getByRole("button", { name: "Fail", exact: true }).isVisible());
  await spain.getByRole("button", { name: "Fail", exact: true }).click();
  const detail = results.getByRole("region", { name: "This result" });
  check("itSaysWhichCheckFailedAndWhy", await detail.getByText(/Contains.*Paris.*Expected output to contain/).isVisible());
  check("withTheAnswerThatFailedIt", await detail.getByText("I do not know.").isVisible());
  check("theOtherPersonSeesTheResults", await ok(toolB.getByRole("region", { name: "Results" }).getByText("3 of 4 passed").waitFor({ timeout: 15_000 })));

  // Change the prompt and run again: Spain's fixed, France breaks, and it says so.
  await toolA.getByLabel("Message 1", { exact: true }).fill("Explain {{topic}} in one line.");
  await sleep(300);
  holdFor = 0;
  answer = (next) => ({ type: "done", report: report([cell(next, 0, 0, false), cell(next, 0, 1, true), cell(next, 1, 0, true), cell(next, 1, 1, true)]) });
  await toolA.getByRole("button", { name: "Run evals" }).click();
  check("whatChangedIsSaid", await ok(results.getByText(/1 newly failing/).waitFor({ timeout: 15_000 })));
  check("whatsFixedToo", await results.getByText("1 fixed").isVisible());
  check("andThatThePromptDiffered", await results.getByText("The prompt was different.").isVisible());
  check("theCellsSaySo", (await matrix.getByRole("button", { name: "Fail, newly" }).isVisible()) && (await matrix.getByRole("button", { name: "Pass, fixed" }).isVisible()));
  const earlier = toolA.getByRole("region", { name: "Earlier runs" });
  check("bothRunsAreKept", (await earlier.getByRole("button").count()) === 2);
  await earlier.getByRole("button").nth(1).click();
  check("anEarlierRunOpens", await ok(results.getByText("3 of 4 passed").waitFor({ timeout: 5_000 })));

  // A failed run says why, and Stop stops.
  answer = () => ({ type: "error", message: "This room's sandbox doesn't have promptfoo yet: its image needs rebuilding (pnpm sandbox:build)." });
  await toolA.getByRole("button", { name: "Run evals" }).click();
  check("aFailureSaysWhy", await ok(toolA.getByRole("alert").getByText(/needs rebuilding/).waitFor({ timeout: 15_000 })));
  holdFor = 60_000;
  await toolA.getByRole("button", { name: "Run evals" }).click();
  await toolA.getByRole("button", { name: "Stop" }).click();
  check("itStops", await ok(toolA.getByRole("button", { name: "Run evals" }).waitFor({ timeout: 10_000 })));
  holdFor = 0;

  // Removing a case, and the prompt, for both.
  await toolA.getByLabel("Remove test case 2").click();
  check("aRemovedCaseGoesForBoth", await ok(toolB.getByRole("region", { name: "Test case 2" }).waitFor({ state: "detached", timeout: 15_000 })));
  await toolA.getByRole("button", { name: "Delete this prompt" }).click();
  await toolA.getByRole("button", { name: "Delete", exact: true }).click();
  check("itsGoneForTheOtherPerson", await ok(toolB.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name }).waitFor({ state: "detached", timeout: 15_000 })));
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  const left = a.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name: /^Evals test / });
  for (let tries = 0; tries < 5 && (await left.count().catch(() => 0)); tries += 1) {
    await left.first().click();
    await a.getByRole("button", { name: "Delete this prompt" }).click();
    await a.getByRole("button", { name: "Delete", exact: true }).click();
    await sleep(500);
  }
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
