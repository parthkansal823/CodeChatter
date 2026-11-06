// A live interview and an assessment in a real browser. The interview: on video, nothing prepared, questions asked on the
// spot from the bank and written by hand, the AI switched on and off, marks and a scorecard there and then. The assessment:
// many candidates pasted in, a paper drawn for each, the candidate starting it themselves under its rules, full screen,
// pasting blocked and recorded, marked by itself, handed in, a results table.
//   node test/interview-modes.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const stamp = Date.now().toString(36);
const TAG = `m${stamp}`;
const SHOTS = process.env.SHOT_DIR ?? process.env.TEMP ?? "/tmp";
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/modes-${name}.png` }).catch(() => {});

const inCall = !process.env.GITHUB_ACTIONS; // WebRTC through LiveKit: see room-members.e2e.mjs
const { browser, errors, signIn } = await launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const one = await signIn("test1@codechatter.local");
const two = await signIn("test2@codechatter.local");
const a = one.page;
const b = two.page;
for (const { context } of [one, two]) await context.grantPermissions(["camera", "microphone"]);
const post = (page, path, data) => page.request.post(`${BASE}${path}`, { data, headers: { origin: BASE } });
const cleanup = { questions: [], interviews: [], batches: [] };
const panel = (page) => page.getByRole("button", { name: /Open the (interview|assessment) panel/ });
const inPaper = (page, n) => page.getByRole("region", { name: new RegExp(`^Question ${n}\\b`) });

const BO_CODE = `
def merge(left, right):
    result = []
    i = 0
    j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result
`;
const CY_CODE = BO_CODE.replaceAll("merge", "combine").replaceAll("left", "first").replaceAll("right", "second").replaceAll("result", "out").replaceAll("i ", "x ").replaceAll("[i", "[x").replaceAll("j ", "y ").replaceAll("[j", "[y");

try {
  // A question of each kind in the bank, one through the form.
  await a.goto(`${BASE}/interviews/questions/new`);
  await a.getByLabel("Title").waitFor({ timeout: 30_000 });
  await a.getByLabel("Title").fill(`Capital ${TAG}`);
  await a.getByRole("combobox", { name: "Kind of question" }).click();
  await a.getByRole("option", { name: "Multiple choice" }).click();
  check("codingFieldsGoAwayForMultipleChoice", !(await a.getByRole("button", { name: "Add a test" }).isVisible()));
  await a.getByLabel("Tags, with commas").fill(TAG);
  await a.getByLabel("Marks").fill("3");
  await a.getByLabel("Choice 1", { exact: true }).fill("Paris");
  await a.getByLabel("Choice 2", { exact: true }).fill("Rome");
  await a.getByRole("button", { name: "Add question" }).click();
  await a.waitForURL(/tab=questions/, { timeout: 15_000 });
  await a.getByLabel("Search the bank").fill(TAG);
  check("theBankShowsItsKind", await ok(a.getByRole("row", { name: new RegExp(`Capital ${TAG}.*Multiple choice`) }).waitFor({ timeout: 15_000 })));
  const made = await (await a.request.get(`${BASE}/api/interview-questions`)).json();
  cleanup.questions.push(...made.filter((question) => question.tags.includes(TAG)).map((question) => question.id));
  const bankMcq = made.find((question) => question.title === `Capital ${TAG}`);
  check("itsSaved", Boolean(bankMcq) && bankMcq.kind === "mcq" && bankMcq.marks === 3);
  const choiceQuestion = (n) => ({ kind: "mcq", title: `Pick ${n} ${TAG}`, tags: [TAG], marks: 2, choices: [{ id: "yes", text: `Right ${n}`, correct: true }, { id: "no", text: `Wrong ${n}`, correct: false }] });
  for (let n = 1; n <= 3; n++) cleanup.questions.push((await (await post(a, "/api/interview-questions", choiceQuestion(n))).json()).id);
  const designRes = await post(a, "/api/interview-questions", { kind: "design", title: `Design a queue ${TAG}`, tags: [TAG], marks: 20, modelAnswer: "Partitions and acknowledgements." });
  cleanup.questions.push((await designRes.json()).id);

  // Filling the bank by pasting a spreadsheet.
  await a.goto(`${BASE}/interviews?tab=questions`);
  await a.getByRole("button", { name: "Import questions" }).first().click({ timeout: 30_000 });
  const pasted = a.getByLabel("Questions to import");
  await pasted.fill(`question\ta\tb\tanswer\ttags\nImported one ${TAG}\tYes\tNo\ta\timp${TAG}\nImported two ${TAG}\tYes\tNo\tz\timp${TAG}`);
  check("anImportSaysWhatsWrong", await ok(a.getByText(/Line 3: the answer "z"/).waitFor({ timeout: 5000 })));
  check("andWontGoUntilItsRight", await a.getByRole("button", { name: /^Import \d+/ }).isDisabled());
  await pasted.fill(`question\ta\tb\tanswer\ttags\nImported one ${TAG}\tYes\tNo\ta\timp${TAG}\nImported two ${TAG}\tYes\tNo\tb\timp${TAG}`);
  await a.getByRole("button", { name: "Import 2 questions" }).click();
  await a.getByLabel("Search the bank").fill(`imp${TAG}`);
  check("importedQuestionsAreInTheBank", await ok(a.getByRole("cell", { name: `Imported two ${TAG}`, exact: true }).waitFor({ timeout: 15_000 })));
  const afterImport = await (await a.request.get(`${BASE}/api/interview-questions`)).json();
  cleanup.questions.push(...afterImport.filter((question) => question.tags.includes(`imp${TAG}`)).map((question) => question.id));

  // A live interview, with nothing prepared.
  await a.goto(`${BASE}/interviews`);
  await a.getByRole("button", { name: "Schedule an interview" }).first().click({ timeout: 30_000 });
  check("itCanBeScheduledWithNoQuestion", await ok(a.getByRole("combobox", { name: "Question" }).filter({ hasText: "Choose during the interview" }).waitFor({ timeout: 10_000 })));
  await a.getByLabel("Candidate's name").fill("Ana Live");
  await a.getByRole("button", { name: "Schedule", exact: true }).click();
  const linkField = a.getByRole("textbox", { name: "The candidate's link" });
  await linkField.waitFor({ timeout: 15_000 });
  const link = await linkField.inputValue();
  await a.getByRole("button", { name: "Open the interview" }).click();
  await a.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const liveId = a.url().split("/").at(-1);
  cleanup.interviews.push(liveId);
  const live = await (await a.request.get(`${BASE}/api/interviews/${liveId}`)).json();

  // The candidate, as a guest, in the waiting room.
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guestContext.grantPermissions(["camera", "microphone"]);
  const c = await guestContext.newPage();
  c.on("pageerror", (error) => errors.push(`candidate: ${error.message.split("\n")[0]}`));
  await c.goto(link);
  await c.getByRole("button", { name: "Join as Ana Live" }).waitFor({ timeout: 30_000 });
  const landing = await c.locator("main").innerText();
  check("theyAreToldItsOnVideo", /on video/i.test(landing));
  check("theyAreToldWhatsRecorded", /go on a record/i.test(landing), landing.slice(0, 80));
  await c.getByRole("button", { name: "Join as Ana Live" }).click();
  await c.getByRole("heading", { name: "You're in the waiting room" }).waitFor({ timeout: 15_000 });

  // The interviewer runs it from the room.
  await a.goto(`${BASE}/rooms/${live.roomId}`);
  await a.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await panel(a).click();
  await a.getByRole("button", { name: "Start the interview" }).click({ timeout: 15_000 });
  check("theWaitingRoomOpensTheRoom", await ok(c.getByRole("tree", { name: "Files" }).waitFor({ timeout: 40_000 })));
  await panel(c).click();
  check("theyAreToldTheInterviewerWillAsk", await ok(c.getByText("will ask you questions here").waitFor({ timeout: 15_000 })));
  check("noAiYet", (await c.getByRole("tab", { name: "AI", exact: true }).count()) === 0);

  if (inCall) {
    await a.getByRole("button", { name: "Start the video call" }).click();
    check("theInterviewerIsOnVideo", await ok(a.getByText("You're on video, and waiting").waitFor({ timeout: 30_000 })));
    await c.getByRole("button", { name: "Join the video call" }).click({ timeout: 20_000 });
    check("theyreOnVideoTogether", await ok(a.getByText("You're on video together").waitFor({ timeout: 30_000 })));
    await shot(a, "live-video");
  }

  // Asking: their own question, on the spot.
  const ask = async (tab) => {
    await a.getByRole("button", { name: "Ask a question" }).click();
    await a.getByRole("tab", { name: tab }).click();
  };
  await ask("Write your own");
  await a.getByLabel("Title").fill(`Reverse it ${stamp}`);
  await a.getByLabel("What they read").fill(`SPOKEN ${stamp}: reverse a string.`);
  await a.getByLabel("File", { exact: true }).fill("rev.py");
  await shot(a, "ask-dialog");
  await a.getByRole("button", { name: "Ask it" }).click();
  check("theCandidateSeesItAtOnce", await ok(c.getByText(`SPOKEN ${stamp}: reverse a string.`).waitFor({ timeout: 15_000 })));
  check("itsFileAppearsInTheRoom", await ok(c.getByRole("treeitem", { name: /rev\.py/ }).or(c.getByRole("treeitem", { name: "q1" })).first().waitFor({ timeout: 15_000 })));

  // From the bank, with its right answers kept from them.
  await ask("From the bank");
  await a.getByLabel("Search questions").fill(`Capital ${TAG}`);
  await a.getByRole("button", { name: `Ask Capital ${TAG}` }).click();
  check("aBankQuestionAppears", await ok(c.getByRole("radio", { name: "Paris" }).waitFor({ timeout: 15_000 })));
  const candidateText = await c.locator("body").innerText();
  check("nothingSaysWhichIsRight", !/Right answer/.test(candidateText));
  await c.getByRole("radio", { name: "Paris" }).click();
  check("theInterviewerSeesTheirAnswerLive", await ok(inPaper(a, 2).getByText("Chosen").waitFor({ timeout: 15_000 })));
  check("itMarksItself", await ok(a.getByText(/3 of \d+ marks/).first().waitFor({ timeout: 15_000 })));

  // And a system design, at random.
  await ask("At random");
  await a.getByRole("combobox", { name: "Kind", exact: true }).click();
  await a.getByRole("option", { name: "System design" }).click();
  await a.getByLabel("Tag", { exact: true }).fill(TAG);
  await a.getByText("1 question to draw from.").waitFor({ timeout: 10_000 });
  await a.getByRole("button", { name: "Draw and ask" }).click();
  check("aDesignQuestionAppears", await ok(c.getByText(`Design a queue ${TAG}`).waitFor({ timeout: 15_000 })));
  check("theyAreToldWhereToDraw", await ok(c.getByText(/Diagrams or Board/).waitFor({ timeout: 5000 })));
  await c.getByLabel(`Your answer to Design a queue ${TAG}`).fill("Boxes and arrows.");
  check("theirWritingSavesItself", await ok(c.getByText("Saved").first().waitFor({ timeout: 10_000 })));
  check("theInterviewerReadsIt", await ok(a.getByText("Boxes and arrows.").waitFor({ timeout: 15_000 })));
  check("alongWithWhatAGoodAnswerSays", await ok(a.getByText("What a good answer says").waitFor({ timeout: 5000 })));

  // Marks and a verdict, there and then.
  await a.getByLabel(`Marks for Design a queue ${TAG}`).fill("15");
  await a.getByLabel(`Marks for Design a queue ${TAG}`).press("Enter");
  check("marksAddUp", await ok(a.getByText(/^18 of \d+ marks/).waitFor({ timeout: 15_000 })));
  await a.getByRole("radiogroup", { name: "Recommendation" }).getByRole("radio", { name: "Yes" }).click().catch(() => {});
  await shot(a, "live-panel");

  // The AI is the interviewer's call.
  await a.getByRole("switch", { name: "Let the candidate use the AI" }).click();
  check("theAiAppearsForTheCandidate", await ok(c.getByRole("tab", { name: "AI", exact: true }).waitFor({ timeout: 15_000 })));
  check("andTheyAreTold", await ok(c.getByText("Your interviewer has allowed the AI").waitFor({ timeout: 5000 })));
  await a.getByRole("switch", { name: "Let the candidate use the AI" }).click();
  check("andGoesAgainWhenTurnedOff", await ok(c.getByRole("tab", { name: "AI", exact: true }).waitFor({ state: "detached", timeout: 15_000 })));
  const onRecord = await (await a.request.get(`${BASE}/api/interviews/${liveId}`)).json();
  check("itsOnTheRecord", onRecord.integrity.counts["ai-on"] === 1 && onRecord.integrity.counts["ai-off"] === 1);
  await guestContext.close();

  // Finishing: the report has it all.
  await a.goto(`${BASE}/interviews/${liveId}`);
  await a.getByRole("tab", { name: "Answers" }).waitFor({ timeout: 30_000 });
  check("theInterviewsPageHasTheAnswers", await ok(a.getByText("Boxes and arrows.").waitFor({ timeout: 10_000 })));

  // An assessment for several people.
  await a.goto(`${BASE}/interviews/new?mode=assessment`);
  await a.getByRole("heading", { name: "New assessment" }).waitFor({ timeout: 30_000 });
  await a.getByLabel("Name of the assessment").fill(`Screening ${TAG}`);
  await a.getByLabel("Candidates, one a line").fill(`Bo Two, bo.${stamp}@example.com\nCy Three <cy.${stamp}@example.com>\nthis@@wrong`);
  check("itReadsThePastedList", await ok(a.getByText("2 candidates").waitFor({ timeout: 5000 })));
  check("itSaysWhichLineItCouldntRead", await ok(a.getByText(/1 line couldn.t be read: this@@wrong/).waitFor({ timeout: 5000 })));
  await a.getByRole("button", { name: /^Schedule/ }).click();
  check("itWontGoWithABadLine", await ok(a.getByRole("alert").filter({ hasText: "this@@wrong" }).waitFor({ timeout: 5000 })));
  await a.getByLabel("Candidates, one a line").fill(`Bo Two, bo.${stamp}@example.com\nCy Three <cy.${stamp}@example.com>`);
  await a.getByLabel("Tag", { exact: true }).fill(TAG);
  await a.getByLabel("How many").fill("50");
  check("itSaysIfTheBankIsTooSmall", await ok(a.locator("p.text-destructive").filter({ hasText: "in the bank match" }).waitFor({ timeout: 5000 })));
  await a.getByLabel("How many").fill("3");
  await a.getByRole("checkbox", { name: "Ask for full screen" }).click();
  await a.getByRole("checkbox", { name: /Block pasting/ }).click();
  await shot(a, "assessment-form");
  await a.getByRole("button", { name: /^Schedule/ }).click();
  await a.getByRole("heading", { name: /2 links ready/ }).waitFor({ timeout: 30_000 });
  const links = await a.getByRole("list", { name: "Candidates' links" }).locator("code").allInnerTexts();
  check("everyoneHasALink", links.length === 2 && new Set(links).size === 2);
  const [download] = await Promise.all([a.waitForEvent("download", { timeout: 10_000 }), a.getByRole("button", { name: "Download as CSV" }).click()]);
  check("theLinksDownload", download.suggestedFilename().endsWith("-links.csv"));
  await shot(a, "assessment-links");
  await a.getByRole("link", { name: "See the results page" }).click();
  await a.waitForURL(/\/interviews\/batches\//, { timeout: 15_000 });
  const batchId = a.url().split("/").at(-1);
  cleanup.batches.push(batchId);
  check("theResultsPageHasEveryone", await ok(a.getByRole("row", { name: /Bo Two.*Not started/ }).waitFor({ timeout: 15_000 })));

  // The candidate starts it themselves.
  await b.goto(links[0]);
  await b.getByRole("button", { name: /Continue as/ }).click({ timeout: 30_000 });
  await b.getByRole("button", { name: /Start the assessment/ }).waitFor({ timeout: 15_000 });
  const rules = await b.locator("main").innerText();
  check("theyAreToldTheRules", /full screen/i.test(rules) && /Pasting from outside and copying/i.test(rules) && /3 multiple choice/.test(rules), rules.slice(0, 200));
  check("theRulesGiveNoQuestionAway", !rules.includes("Right ") && !rules.includes("Paris"));
  await shot(b, "assessment-start");
  await b.getByRole("button", { name: /Start the assessment/ }).click();
  await b.waitForURL(/\/rooms\//, { timeout: 30_000 });
  const fullscreenAsked = await ok(b.getByRole("button", { name: "Go full screen" }).waitFor({ timeout: 40_000 }));
  check("thePanelIsCalledWhatItIs", await ok(b.getByRole("tab", { name: "Assessment", exact: true }).waitFor({ state: "attached", timeout: 20_000 })));
  check("itAsksForFullScreen", fullscreenAsked);
  await shot(b, "assessment-fullscreen");
  await b.getByRole("button", { name: "Go full screen" }).click();
  check("thenTheRoomShows", await ok(b.getByRole("button", { name: "Go full screen" }).waitFor({ state: "detached", timeout: 10_000 })));
  await panel(b).click({ timeout: 15_000 });

  // Answering, with pasting blocked.
  const first = inPaper(b, 1);
  await first.waitFor({ timeout: 15_000 });
  const firstRow = await first.innerText();
  const rightAnswer = /Right \d|Paris/.exec(firstRow)?.[0];
  check("theirPaperIsThere", Boolean(rightAnswer), firstRow.slice(0, 120));
  await first.getByRole("radio", { name: rightAnswer }).click();
  await b.getByText(/1 of 3 answered/).waitFor({ timeout: 10_000 });
  check("itCountsWhatsAnswered", true);
  await b.locator(".monaco-editor .view-lines").first().click();
  await b.keyboard.press("Control+End");
  await b.keyboard.insertText(BO_CODE);
  const blocked = await b.evaluate(() => {
    const event = new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    event.clipboardData.setData("text/plain", "pasted from somewhere else, long enough to count for sure");
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  check("pastingFromOutsideIsBlocked", blocked);
  await shot(b, "assessment-paper");

  const interviewOf = async () => {
    const results = await (await a.request.get(`${BASE}/api/interview-batches/${batchId}`)).json();
    return results.rows.find((row) => row.candidateName === "Bo Two");
  };
  check("itGoesOnTheRecord", await ok((async () => {
    for (let i = 0; i < 25; i++) {
      if ((await interviewOf()).integrity.counts["paste-blocked"] >= 1) return;
      await b.waitForTimeout(1000);
    }
    throw new Error("not recorded");
  })()));

  // Handing in.
  await b.getByRole("button", { name: "Hand in" }).click();
  await b.getByRole("alertdialog").getByRole("button", { name: "Hand in" }).click();
  check("handingInEndsIt", await ok(b.getByText(/has finished/).first().waitFor({ timeout: 30_000 })));
  await b.waitForTimeout(800);
  await b.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
  check("theyCantChangeItNow", await ok(b.getByRole("button", { name: "Hand in" }).waitFor({ state: "detached", timeout: 15_000 })));

  // The results.
  await a.reload();
  const row = a.getByRole("row", { name: /Bo Two/ });
  await row.waitFor({ timeout: 30_000 });
  const rowText = await row.innerText();
  check("theTableHasTheirScore", /Finished/.test(rowText) && /\b(2|3) \/ \d+/.test(rowText) && /1 of 3/.test(rowText), rowText);
  check("andWhatsOnTheRecord", /Worth a look|Concerning/.test(rowText), rowText);
  check("andWhoHasntStarted", await ok(a.getByRole("row", { name: /Cy Three.*Not started/ }).waitFor({ timeout: 5000 })));
  const [results] = await Promise.all([a.waitForEvent("download", { timeout: 10_000 }), a.getByRole("button", { name: "Export CSV" }).click()]);
  check("theResultsDownload", results.suggestedFilename().endsWith("-results.csv"));
  await shot(a, "assessment-results");

  // Two candidates with the same code, one with every name changed.
  await b.goto(links[1]);
  await b.getByRole("button", { name: /Continue as/ }).click({ timeout: 30_000 });
  await b.getByRole("button", { name: /Start the assessment/ }).click({ timeout: 15_000 });
  await b.waitForURL(/\/rooms\//, { timeout: 30_000 });
  const cyRoom = b.url().split("/").at(-1);
  await b.getByRole("button", { name: "Go full screen" }).click({ timeout: 40_000 });
  await b.locator(".monaco-editor .view-lines").first().click({ timeout: 30_000 });
  await b.keyboard.press("Control+End");
  await b.keyboard.insertText(CY_CODE);
  await b.waitForTimeout(4000); // the edit reaches the log
  await a.reload();
  await a.getByRole("button", { name: "Compare their code" }).click({ timeout: 30_000 });
  const alike = a.getByRole("region", { name: "Code that looks alike" });
  await alike.waitFor({ timeout: 30_000 });
  const alikeText = await alike.innerText();
  check("copiedCodeIsFoundEvenRenamed", /Bo Two and Cy Three: \d+%|Cy Three and Bo Two: \d+%/.test(alikeText), alikeText.slice(0, 160));
  await shot(a, "assessment-compare");
  await post(b, `/api/rooms/${cyRoom}/interview/submit`, {});

  await row.getByRole("link", { name: "Bo Two", exact: true }).click();
  await a.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  check("eachCandidateOpensInFull", await ok(a.getByRole("tab", { name: "Answers" }).waitFor({ timeout: 30_000 })));
  await a.getByRole("tab", { name: "The record" }).click();
  check("withTheRecord", await ok(a.getByText(/Tried to paste: 1/).waitFor({ timeout: 10_000 })));
  await a.getByRole("tab", { name: "Report" }).click();
  check("andAReport", await ok(a.getByLabel("The report").filter({ hasText: "Assessment report: Bo Two" }).waitFor({ timeout: 10_000 })));

  // Phone width: nothing runs off the side.
  await a.setViewportSize({ width: 390, height: 800 });
  for (const [name, path] of [["theResultsFitAPhone", `/interviews/batches/${batchId}`], ["theAssessmentFormFitsAPhone", "/interviews/new?mode=assessment"], ["theBankFitsAPhone", "/interviews?tab=questions"], ["aCandidatesPageFitsAPhone", `/interviews/${liveId}`]]) {
    await a.goto(`${BASE}${path}`);
    await a.waitForTimeout(1500);
    check(name, await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path);
  }
  await a.setViewportSize({ width: 1440, height: 900 });
} catch (error) {
  check("noUnexpectedError", false, String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 200));
  await shot(a, "failed-a");
  await shot(b, "failed-b");
} finally {
  const remove = (path) => a.request.delete(`${BASE}${path}`, { headers: { origin: BASE } }).catch(() => {});
  for (const id of cleanup.interviews) {
    await post(a, `/api/interviews/${id}/finish`, {}).catch(() => {});
    await remove(`/api/interviews/${id}`);
  }
  for (const id of cleanup.batches) await remove(`/api/interview-batches/${id}`);
  for (const id of cleanup.questions) await remove(`/api/interview-questions/${id}`);
}

await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
