// The Automations tool in a browser, with Activepieces' real engine behind it: the examples, one on the chart with its branches lit up after a real run, what went in and came out
// of a step, changing a step and adding them, two people, a failing step, stopping a run, a file that isn't a flow, and a phone. Nothing is stood in for. Its files are removed.
//   node test/automations.e2e.mjs        (from apps/web, with the dev stack running and the current sandbox images)
import { BASE, check, finish, launch, sleep, openApp } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FOLDER = "automations";

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const files = a.getByRole("tree", { name: "Files" });
const tool = a.getByRole("region", { name: "Automations", exact: true });
const details = tool.getByRole("complementary", { name: "Details" });
const chart = tool.getByRole("group", { name: "The steps of this automation" });
const box = (name) => chart.getByRole("button", { name: new RegExp(`^Step ${escape(name)},`) });
/** Selects a box, bringing it into view first as focusing it does, since the chart may have moved on. */
async function select(name) {
  await box(name).focus();
  await sleep(300);
  // Clicking a selected box lets it go, so only one that isn't.
  if ((await box(name).getAttribute("aria-pressed")) !== "true") await box(name).click();
}
const openTool = async (page = a) => {
  await openApp(page, "Automations");
  await page.getByRole("region", { name: "Automations", exact: true }).waitFor({ timeout: 20_000 });
};
/** Runs what's on screen, with `payload`, and waits for its answer. */
async function run(payload) {
  await details.getByLabel("What to send, as JSON").fill(JSON.stringify(payload));
  await details.getByRole("button", { name: "Run it" }).click();
}
const finished = (words, timeout = 60_000) => details.getByRole("region", { name: "The run shown" }).getByRole("status").filter({ hasText: words }).waitFor({ timeout });
/** Runs it, and waits until this run, not an earlier one, is the one shown. */
async function runUntil(payload, words = /^Finished in/, timeout = 90_000) {
  const list = details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem");
  const before = await list.count();
  await run(payload);
  const until = Date.now() + timeout;
  while (Date.now() < until && (await list.count()) <= before) await sleep(250);
  await finished(words, 15_000);
  await sleep(300);
}

async function removeTheirFiles() {
  const folder = files.getByRole("treeitem", { name: new RegExp(`^${FOLDER}`) });
  if (await folder.count()) {
    await folder.first().focus();
    await a.keyboard.press("Delete");
    await sleep(800);
    const confirm = a.getByRole("alertdialog").getByRole("button", { name: /Delete/ });
    if (await confirm.count()) await confirm.click();
    await sleep(800);
  }
}

try {
  await removeTheirFiles();
  await openTool();
  await tool.getByRole("heading", { name: "Make things happen by themselves" }).waitFor({ timeout: 90_000 });
  check("aRoomWithNoneSaysWhatTheyAre", true);

  // ---- The examples ----
  await tool.getByRole("button", { name: "See the examples" }).click();
  const examples = tool.getByRole("list", { name: "Examples" });
  await examples.waitFor({ timeout: 10_000 });
  const allOfThem = await examples.getByRole("listitem").count();
  check("thereAreOverAHundredExamples", allOfThem >= 100, allOfThem);
  check("itSaysHowManyInWords", await tool.getByText(new RegExp(`^${allOfThem} automations for coding`)).isVisible());
  await tool.getByLabel("Search the examples").fill("second review");
  check("searchNarrowsThem", (await examples.getByRole("listitem").count()) === 1);
  check("whatRunsHereSaysSo", await examples.getByText("Runs here").isVisible());
  await tool.getByLabel("Search the examples").fill("nothing is called this");
  check("searchingForNothingSaysSo", await tool.getByText("Nothing matches that.").isVisible());
  await tool.getByLabel("Search the examples").fill("");
  await tool.getByRole("group", { name: "Kinds of example" }).getByRole("button", { name: "Notifications" }).click();
  const notifying = await examples.getByRole("listitem").count();
  check("aKindNarrowsThem", notifying > 10 && notifying < allOfThem, notifying);
  check("whatNeedsAServiceSaysWhich", await examples.getByRole("listitem").filter({ hasText: "Tell Slack when a pull request changes" }).getByText(/^Needs .*GitHub.*Slack/).isVisible());
  await tool.getByRole("group", { name: "Kinds of example" }).getByRole("button", { name: "All", exact: true }).click();

  // ---- One of them, on the chart ----
  await tool.getByLabel("Search the examples").fill("second review");
  await tool.getByRole("button", { name: "Use Send big changes for a second review" }).click();
  await chart.waitFor({ timeout: 15_000 });
  await box("Big?").waitFor({ timeout: 15_000 });
  check("itBecomesAFileInTheRoom", await ok(files.getByRole("treeitem", { name: new RegExp(`^${FOLDER}`) }).first().waitFor({ timeout: 10_000 })));
  check("itsStepsAreOnTheChart", (await chart.getByRole("button", { name: /^Step / }).count()) === 5, await chart.getByRole("button", { name: /^Step / }).count());
  check("noneHasRunYet", await details.getByText("No runs yet.").isVisible());

  // ---- A real run, lit up on the chart ----
  const { page: b } = await signIn("test2@codechatter.local");
  await openTool(b);
  const toolB = b.getByRole("region", { name: "Automations", exact: true });
  await toolB.getByRole("group", { name: "The steps of this automation" }).waitFor({ timeout: 60_000 });
  check("someoneElseSeesTheSameFlow", (await toolB.getByRole("group", { name: "The steps of this automation" }).getByRole("button", { name: /^Step / }).count()) === 5);

  await runUntil({ additions: 900, deletions: 200 }, /^Finished in/);
  check("aRunFinishes", true);
  await box("Ask for a second review").waitFor();
  const stepName = async (name) => box(name).getAttribute("aria-label");
  check("theBranchThatRanIsLit", /ran fine/i.test(await stepName("Ask for a second review")), await stepName("Ask for a second review"));
  check("theOtherBranchIsNot", !/ran fine/i.test(await stepName("One review is enough")), await stepName("One review is enough"));
  check("theRunIsListed", (await details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem").count()) === 1);

  // The other person sees it too, without being told.
  const seenByB = await ok(
    toolB
      .getByRole("complementary", { name: "Details" })
      .getByRole("list", { name: "Runs of this flow" })
      .getByRole("listitem")
      .first()
      .waitFor({ timeout: 25_000 }),
  );
  check("theOtherPersonSeesTheRun", seenByB);

  // ---- What went in and came out ----
  await box("Measure it").click();
  const step = details.getByRole("region", { name: "Step Measure it" });
  const onThisRun = step.getByRole("region", { name: "On this run" });
  await onThisRun.waitFor({ timeout: 10_000 });
  check("whatWentInIsShown", /"additions": 900/.test(await onThisRun.getByRole("region", { name: "What went in" }).textContent()));
  check("whatCameOutIsShown", /"lines": 1100/.test(await onThisRun.getByRole("region", { name: "What came out" }).textContent()));

  // ---- A small one takes the other way, and earlier runs stay ----
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 1, deletions: 2 }, /^Finished in/);
  check("theOtherBranchRunsThisTime", /ran fine/i.test(await stepName("One review is enough")), await stepName("One review is enough"));
  check("andTheFirstOneDoesnt", !/ran fine/i.test(await stepName("Ask for a second review")), await stepName("Ask for a second review"));
  const list = details.getByRole("list", { name: "Runs of this flow" });
  check("bothRunsAreListed", (await list.getByRole("listitem").count()) === 2);
  await list.getByRole("button").nth(1).click();
  await sleep(800);
  check("anEarlierRunCanBeLookedAt", /ran fine/i.test(await stepName("Ask for a second review")));
  await list.getByRole("button").first().click();
  await sleep(500);

  // ---- Changing a step: both people see it, and the engine runs the change ----
  await box("Ask for a second review").click();
  const reviewStep = details.getByRole("region", { name: "Step Ask for a second review" });
  await reviewStep.getByLabel("Name").fill("Ask for two reviews");
  await box("Ask for two reviews").waitFor({ timeout: 5000 });
  check("renamingShowsOnTheChart", true);
  const renamedForB = await ok(toolB.getByRole("button", { name: /^Step Ask for two reviews,/ }).waitFor({ timeout: 10_000 }));
  check("andForTheOtherPerson", renamedForB);
  const edited = details.getByRole("region", { name: "Step Ask for two reviews" });
  await edited.getByRole("textbox", { name: "Code", exact: true }).fill('export const code = async () => {\n  return { review: "two people" };\n};\n');
  await sleep(600);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 900, deletions: 1 }, /^Finished in/);
  await box("Ask for two reviews").click();
  await edited.getByRole("region", { name: "What came out" }).getByText('"two people"').waitFor({ timeout: 10_000 });
  check("theChangeIsWhatRuns", true);

  // ---- Adding steps, from the picker ----
  const picker = details.getByRole("region", { name: "Add a step" });
  const option = (name) => picker.getByRole("option", { name: new RegExp(`^${escape(name)}`) });
  await edited.getByRole("button", { name: "Add a step after this" }).click();
  await option("Code").click();
  await box("Code").waitFor({ timeout: 5000 });
  check("aCodeStepComesFromThePicker", (await chart.getByRole("button", { name: /^Step / }).count()) === 6);
  const added = details.getByRole("region", { name: "Step Code" });
  // The + after the last step, and a service found by searching every action.
  await chart.getByRole("button", { name: "Add a step after Code", exact: true }).click();
  await picker.getByPlaceholder(/^Search \d+ actions$/).fill("slugify");
  await option("Text Helper: Slugify").click();
  await box("Slugify").waitFor({ timeout: 5000 });
  check("aServiceIsFoundBySearchingItsActions", true);
  const slug = details.getByRole("region", { name: "Step Slugify" });
  const slugText = slug.getByRole("region", { name: "Its fields" }).getByLabel(/^Text/);
  await slugText.fill("Hello Big World");
  await sleep(500);
  check("itsFieldsComeFromThePiece", (await slug.getByRole("region", { name: "Its fields" }).getByRole("textbox").count()) >= 1);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 900, deletions: 1 }, /^Finished in/);
  await box("Slugify").click();
  await slug.getByRole("region", { name: "What came out" }).getByText("Hello-Big-World").waitFor({ timeout: 10_000 });
  check("aRealPieceAddedHereRunsOnTheEngine", true);

  // ---- Data from a step before, put in a field, as n8n maps it ----
  await slugText.fill("");
  await slugText.focus();
  const before = slug.getByRole("region", { name: "Data from the steps before" });
  await before.getByText("measure", { exact: true }).click();
  await before.getByRole("button", { name: "Use {{measure.output.lines}}" }).click();
  await sleep(500);
  check("usingDataPutsItsExpressionWhereTheCursorWas", (await slugText.inputValue()) === "{{measure.output.lines}}", await slugText.inputValue());
  check("theFieldSaysWhatItComesToOnThisRun", await slug.getByText("On this run: 901").isVisible());
  await slug.getByRole("region", { name: "What came out" }).getByRole("tab", { name: "Table" }).click();
  check("whatCameOutCanBeShownAnotherWay", await slug.getByRole("region", { name: "What came out" }).getByRole("tabpanel").getByText("Hello-Big-World").isVisible());
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 900, deletions: 1 }, /^Finished in/);
  await box("Slugify").click();
  await slug.getByRole("region", { name: "What came out" }).getByRole("tab", { name: "JSON" }).click();
  await slug.getByRole("region", { name: "What came out" }).getByText('"901"').waitFor({ timeout: 10_000 });
  check("theEngineReadsTheMappedData", true);

  // ---- Typing {{ offers what the steps before give, narrowed as it's typed ----
  await slugText.fill("");
  await slugText.pressSequentially("Lines: {{meas", { delay: 30 });
  const offered = slug.getByRole("listbox", { name: "What it can be" });
  check("typingBracesOffersExpressions", await ok(offered.waitFor({ timeout: 5000 })) && (await offered.getByRole("option", { name: /^measure\.output\.lines/ }).count()) === 1, await offered.innerText().catch(() => "no list"));
  check("narrowedByWhatsTyped", (await offered.getByRole("option").allInnerTexts()).every((text) => text.includes("meas")));
  await slugText.press("ArrowDown");
  await slugText.press("ArrowUp");
  const chosen = await offered.getByRole("option", { selected: true }).innerText();
  await slugText.press("Enter");
  check("enterPutsItIn", (await slugText.inputValue()) === `Lines: {{${chosen.split(/\s/)[0]}}}` && (await offered.count()) === 0, await slugText.inputValue());
  await slugText.pressSequentially(" {{", { delay: 30 });
  await offered.waitFor({ timeout: 5000 });
  await slugText.press("Escape");
  check("escapeClosesTheList", (await offered.count()) === 0 && (await slug.count()) === 1);
  await slugText.fill("{{measure.output.lines}}");
  await sleep(400);

  // ---- Trying things: one step on its own, and pinning what it gave ----
  const runsList = details.getByRole("list", { name: "Runs of this flow" });
  await select("Measure it");
  const measure = details.getByRole("region", { name: "Step Measure it" });
  await measure.getByRole("button", { name: "Run this step" }).click();
  await details.getByRole("button", { name: "Back to the runs" }).click();
  check("oneStepRunsOnItsOwn", await ok(runsList.getByRole("listitem").filter({ hasText: /one step: Measure it/ }).first().waitFor({ timeout: 60_000 })));
  await finished(/^Finished in/);
  await sleep(500);
  check("onlyThatStepIsLitUp", /ran fine/.test(await stepName("Measure it")) && /didn't run/.test(await stepName("Big?")), `${await stepName("Measure it")} | ${await stepName("Big?")}`);
  await select("Measure it");
  await measure.getByRole("button", { name: "Pin this output" }).click();
  await sleep(500);
  check("aPinnedStepSaysSo", /pinned/.test(await stepName("Measure it")) && (await measure.getByRole("region", { name: "Pinned output" }).isVisible()), await stepName("Measure it"));
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 1, deletions: 1 }, /^Finished in/);
  check("aPinnedStepIsntRun", await details.getByText("Pinned, so not run: Measure it.").isVisible());
  // What was pinned (901 lines, from the run it came from) decides the branch, not what was sent (2).
  check("whatComesAfterGetsThePinnedData", /ran fine/.test(await stepName("Ask for two reviews")), await stepName("Ask for two reviews"));
  await select("Measure it");
  await measure.getByRole("button", { name: "Unpin" }).click();
  await sleep(500);
  check("unpinningPutsItBack", !/pinned/.test(await stepName("Measure it")));
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await details.getByRole("button", { name: "Use what it was sent" }).click();
  check("whatARunWasSentCanBeUsedAgain", JSON.parse(await details.getByLabel("What to send, as JSON").inputValue()).additions === 1);

  // ---- A built-in step, as n8n's: Filter, from the picker, run on the engine ----
  await select("Measure it");
  await measure.getByRole("button", { name: "Add a step after this" }).click();
  await picker.getByPlaceholder(/^Search \d+ actions$/).fill("filter");
  await option("Filter").click();
  await box("Filter").waitFor({ timeout: 5000 });
  const filterPanel = details.getByRole("region", { name: "Step Filter" });
  check("aBuiltInStepHasAFormNotCode", (await filterPanel.getByRole("textbox", { name: "Code", exact: true }).count()) === 0 && (await filterPanel.getByRole("combobox", { name: /^Test/ }).count()) === 1);
  await filterPanel.getByRole("textbox", { name: /^Items/ }).fill("{{trigger.output.body.tests}}");
  await filterPanel.getByLabel("Field", { exact: true }).fill("status");
  await filterPanel.getByLabel("Compared with", { exact: true }).fill("failed");
  await sleep(600);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 1, deletions: 1, tests: [{ name: "kept", status: "failed" }, { name: "dropped", status: "passed" }] }, /^Finished in/);
  await select("Filter");
  const filtered = await filterPanel.getByRole("region", { name: "What came out" }).textContent();
  check("aBuiltInStepRunsOnTheEngine", filtered.includes('"kept"') && !filtered.includes('"dropped"'), filtered);
  await filterPanel.getByRole("button", { name: "Remove Filter" }).click();
  await box("Filter").waitFor({ state: "detached", timeout: 5000 });

  // ---- The right-click menu, and undo and redo ----
  const slugBoxes = chart.getByRole("button", { name: /^Step Slugify,/ });
  await box("Slugify").click({ button: "right" });
  await a.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await slugBoxes.nth(1).waitFor({ timeout: 5000 });
  check("theMenuDuplicatesAStep", (await slugBoxes.count()) === 2);
  await box("Measure it").focus();
  await a.keyboard.press("Control+z");
  await sleep(600);
  check("undoTakesItBack", (await slugBoxes.count()) === 1, await slugBoxes.count());
  await a.keyboard.press("Control+y");
  await sleep(600);
  check("redoPutsItBack", (await slugBoxes.count()) === 2, await slugBoxes.count());
  // Someone else's undo doesn't take back this person's change.
  check("theOtherPersonSeesTheDuplicate", await ok(toolB.getByRole("button", { name: /^Step Slugify,/ }).nth(1).waitFor({ timeout: 10_000 })));
  await slugBoxes.nth(1).focus();
  await a.keyboard.press("Delete");
  await sleep(600);
  check("deleteOnABoxRemovesIt", (await slugBoxes.count()) === 1);

  // ---- Keys on a focused box ----
  await box("Slugify").focus();
  await a.keyboard.press("Control+c");
  await a.keyboard.press("Control+v");
  await sleep(600);
  check("copyAndPasteFromTheKeyboard", (await slugBoxes.count()) === 2);
  // What's pasted is selected, so its panel is showing.
  check("thePasteHasANameOfItsOwn", /· slugify_\d+$/.test((await details.getByText(/^Text Helper: Slugify ·/).textContent()) ?? "") && !/· slugify_1$/.test((await details.getByText(/^Text Helper: Slugify ·/).textContent()) ?? ""), await details.getByText(/^Text Helper: Slugify ·/).textContent());
  await slugBoxes.nth(1).focus();
  await a.keyboard.press("Delete");
  await sleep(500);
  await box("Measure it").focus();
  await a.keyboard.press("ArrowRight");
  await sleep(300);
  check("theArrowsMoveBetweenBoxes", await a.evaluate(() => /^Step Big\?,/.test(document.activeElement?.getAttribute("aria-label") ?? "")));
  await a.keyboard.press("n");
  check("nOpensThePicker", await ok(picker.waitFor({ timeout: 5000 })));
  await picker.getByRole("button", { name: "Cancel" }).click();
  await box("Code").focus();
  await a.keyboard.press("d");
  await sleep(500);
  check("dTurnsAStepOff", /turned off/.test(await stepName("Code")), await stepName("Code"));
  await details.getByRole("button", { name: "Back to the runs" }).click().catch(() => {});
  await runUntil({ additions: 900, deletions: 1 }, /^Finished in/);
  check("aStepTurnedOffIsPassedOver", /didn't run/.test(await stepName("Code")) && /ran fine/.test(await stepName("Slugify")), `${await stepName("Code")} | ${await stepName("Slugify")}`);
  await box("Code").focus();
  await a.keyboard.press("d");
  await sleep(500);
  check("andOnAgain", !/turned off/.test(await stepName("Code")));

  // ---- A note, and a router's branches ----
  await select("Measure it");
  await details.getByRole("region", { name: "Step Measure it" }).getByLabel("Note").fill("Counts the lines");
  await sleep(500);
  check("aNoteShowsWithItsBox", /note: Counts the lines/.test(await stepName("Measure it")));
  await select("Big?");
  const router = details.getByRole("region", { name: "Step Big?" });
  await router.getByRole("button", { name: "Add a branch" }).click();
  check("aBranchCanBeAdded", await ok(chart.getByRole("button", { name: "Add a step to the Branch 2 branch of Big?", exact: true }).waitFor({ timeout: 5000 })));
  await router.getByRole("button", { name: "Remove the Branch 2 branch and its steps" }).click();
  check("andRemoved", await ok(chart.getByRole("button", { name: "Add a step to the Branch 2 branch of Big?", exact: true }).waitFor({ state: "detached", timeout: 5000 })));
  check("everyTestTheEngineHasIsOffered", (await router.getByRole("combobox", { name: /^Test, branch 1/ }).first().getByRole("option").count()) === 22);
  await select("When called");
  await details.getByRole("button", { name: "Change the trigger" }).click();
  check("theTriggerCanBeChanged", await ok(details.getByPlaceholder(/^Search \d+ triggers$/).waitFor({ timeout: 5000 })));
  await details.getByRole("button", { name: "Cancel" }).click();

  // ---- Turning it on: a webhook's addresses, a test call, a call from outside, and forgetting it ----
  await select("When called");
  const starting = details.getByRole("region", { name: "Step When called" }).getByRole("region", { name: "Starting by itself" });
  await starting.getByRole("button", { name: "Turn on" }).click();
  const liveAddress = starting.getByRole("textbox", { name: "Live address" });
  await liveAddress.waitFor({ timeout: 10_000 });
  const liveUrl = (await liveAddress.inputValue()).replace(/^https?:\/\/[^/]+/, BASE);
  check("turningItOnGivesAnAddress", liveUrl.includes(`/api/hooks/automations/${"E2ETST"}/`), liveUrl);
  // Who may call it: a signature, saved and shown without its secret, then back to the address alone.
  const whoMay = starting.getByRole("region", { name: "Who may call it" });
  await whoMay.getByRole("combobox", { name: "Who may call it" }).selectOption("signature");
  await whoMay.getByLabel("Shared secret").fill("shared webhook secret");
  await whoMay.getByRole("button", { name: "Save who may call it" }).click();
  check("aSignatureCanBeAskedFor", await ok(whoMay.getByText(/Now: Calls must sign their body in the x-hub-signature-256 header/).waitFor({ timeout: 10_000 })) && (await whoMay.getByLabel("Shared secret").inputValue()) === "");
  const refused = await fetch(liveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("anUnsignedCallIsRefused", refused.status === 401, refused.status);
  await whoMay.getByRole("combobox", { name: "Who may call it" }).selectOption("none");
  await whoMay.getByRole("button", { name: "Save who may call it" }).click();
  check("andBackToTheAddressAlone", await ok(whoMay.getByText(/Now: Anyone with the address can call it/).waitFor({ timeout: 10_000 })));
  await starting.getByRole("button", { name: "Listen for a test call" }).click();
  await fetch(`${liveUrl}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ additions: 600, deletions: 7 }) });
  check("aTestCallIsShown", await ok(starting.getByRole("button", { name: "Use it as what to send" }).waitFor({ timeout: 20_000 })));
  await starting.getByRole("button", { name: "Use it as what to send" }).click();
  await details.getByRole("button", { name: "Back to the runs" }).click();
  check("aTestCallCanBeWhatsSent", JSON.parse(await details.getByLabel("What to send, as JSON").inputValue()).additions === 600);
  const called = await fetch(liveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ additions: 1, deletions: 1 }) });
  check("calledFromOutsideItRuns", called.status === 202, called.status);
  const firstLine = (error) => String(error).split(/\r?\n/)[0];
  const byWebhook = await details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem").filter({ hasText: "Webhook" }).first().waitFor({ timeout: 60_000 }).then(() => true, firstLine);
  check("theRunSaysAWebhookStartedIt", byWebhook === true, `${byWebhook} | ${await details.getByRole("list", { name: "Runs of this flow" }).innerText().catch(firstLine)}`);
  await select("When called");
  await starting.getByRole("button", { name: "Forget it" }).click();
  await starting.getByRole("group", { name: "Are you sure?" }).getByRole("button", { name: "Forget it" }).click();
  check("itCanBeTurnedOffAndForgotten", await ok(starting.getByRole("button", { name: "Turn on" }).waitFor({ timeout: 10_000 })));
  const forgotten = await fetch(liveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("aForgottenAddressFindsNothing", forgotten.status === 404, forgotten.status);

  await select("Slugify");
  await slug.getByRole("button", { name: "Remove Slugify" }).click();
  await box("Slugify").waitFor({ state: "detached", timeout: 5000 });
  check("aStepCanBeRemoved", true);

  // ---- A step that fails: says where and why ----
  await box("Code").click();
  await added.getByRole("textbox", { name: "Code", exact: true }).fill('export const code = async () => {\n  throw new Error("This one broke on purpose");\n};\n');
  await sleep(600);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await runUntil({ additions: 900, deletions: 1 }, /^Failed/);
  check("aFailedRunSaysSo", true);
  check("itSaysWhichStepAndWhy", await details.getByText(/Code: .*broke on purpose/).isVisible());
  check("itsBoxIsMarked", /Failed/i.test(await stepName("Code")), await stepName("Code"));
  await box("Code").click();
  check("theStepShowsTheError", await added.getByRole("alert").filter({ hasText: "broke on purpose" }).isVisible());

  // ---- Carrying on from where it failed, with the step fixed ----
  await added.getByRole("textbox", { name: "Code", exact: true }).fill("export const code = async () => {\n  return { fixed: true };\n};\n");
  await sleep(600);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  const runsBefore = await details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem").count();
  await details.getByRole("button", { name: "Carry on from where it stopped" }).click();
  const carriedOn = await ok(details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem").filter({ hasText: /carried on/ }).first().waitFor({ timeout: 60_000 }));
  await finished(/^Finished in/, 30_000).catch(() => {});
  check("aFailedRunCarriesOnFromWhereItStopped", carriedOn && (await details.getByRole("list", { name: "Runs of this flow" }).getByRole("listitem").count()) === runsBefore + 1);
  check("itSaysItCarriedOn", await details.getByText("Carried on from an earlier run").isVisible());

  // ---- Stopping, and the steps showing while it runs ----
  await select("Code");
  await added.getByRole("textbox", { name: "Code", exact: true }).fill("export const code = async () => {\n  await new Promise((resolve) => setTimeout(resolve, 60000));\n  return {};\n};\n");
  await sleep(600);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  await run({ additions: 900, deletions: 1 });
  await details.getByRole("button", { name: "Stop", exact: true }).waitFor({ timeout: 20_000 });
  check("whileItRunsItCanBeStopped", true);
  const liveOk = await ok(chart.getByRole("button", { name: /^Step Measure it,.*ran fine/i }).waitFor({ timeout: 20_000 }));
  check("stepsLightUpWhileItsStillRunning", liveOk, await stepName("Measure it"));
  await details.getByRole("button", { name: "Stop", exact: true }).click();
  await finished(/^Stopped/, 30_000);
  check("stoppingStopsIt", true);

  // ---- Bad input ----
  await details.getByLabel("What to send, as JSON").fill("{ not json");
  await details.getByRole("button", { name: "Run it" }).click();
  check("badJsonIsCaught", await details.getByRole("alert").filter({ hasText: "isn't valid JSON" }).isVisible());
  await details.getByLabel("What to send, as JSON").fill("{}");

  // ---- A second flow, made by hand, and a broken file ----
  await tool.getByRole("button", { name: "New automation" }).click();
  await tool.getByLabel("Name of the new automation").fill("From scratch");
  await tool.getByRole("button", { name: "Make it" }).click();
  await box("Catch Webhook").or(chart.getByRole("button", { name: /^Step / })).first().waitFor({ timeout: 10_000 });
  await sleep(500);
  check("aNewOneStartsWithOneStep", (await chart.getByRole("button", { name: /^Step / }).count()) === 1);
  const flowList = tool.getByLabel("Automation to show");
  check("itsPickedInTheList", (await flowList.inputValue()).endsWith("from-scratch.flow.json"), await flowList.inputValue());
  check("bothAreInTheList", (await flowList.getByRole("option").count()) === 2);
  // Its own file, opened in the editor from here, and broken.
  await tool.getByRole("button", { name: "Its file" }).click();
  await a.getByRole("tab", { name: /from-scratch\.flow\.json/ }).waitFor({ timeout: 15_000 });
  await sleep(700);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Home");
  await a.keyboard.insertText("broken");
  await sleep(1000);
  await openTool();
  check("aBrokenFileSaysSo", await ok(tool.getByRole("alert").first().waitFor({ timeout: 10_000 })));
  // The tool takes the editor's place, so its file comes back through the tool.
  await tool.getByRole("button", { name: "Its file" }).click();
  await a.getByRole("tab", { name: /from-scratch.flow.json/ }).waitFor({ timeout: 15_000 });
  await sleep(500);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Home");
  for (let i = 0; i < 6; i++) await a.keyboard.press("Delete");
  await sleep(1000);
  await openTool();
  check("andWorksAgainOnceItsFixed", await ok(box("Catch Webhook").or(chart.getByRole("button", { name: /^Step / })).first().waitFor({ timeout: 10_000 })));

  // ---- On a schedule: the times it'll run, a wrong cron, turned on, its times changed, and forgotten ----
  await chart.getByRole("button", { name: /^Step / }).first().click();
  await details.getByRole("button", { name: "Change the trigger" }).click();
  await details.getByPlaceholder(/^Search \d+ triggers$/).fill("cron expression");
  await details.getByRole("option", { name: /Cron Expression/ }).first().click();
  const cronStep = details.getByRole("region", { name: "Step Cron Expression" });
  await cronStep.waitFor({ timeout: 10_000 });
  const scheduled = cronStep.getByRole("region", { name: "Starting by itself" });
  check("aScheduleShowsItsNextTimes", await ok(scheduled.getByRole("list", { name: "The next times it runs" }).waitFor({ timeout: 10_000 })) && (await scheduled.getByRole("list", { name: "The next times it runs" }).getByRole("listitem").count()) === 3);
  const cronField = cronStep.getByRole("textbox", { name: "Cron Expression (required)" });
  await cronField.fill("61 * * * *");
  check("aWrongCronSaysWhy", await ok(scheduled.getByText("A minute is from 0 to 59, not 61.").waitFor({ timeout: 5000 })));
  check("andCantBeTurnedOn", await scheduled.getByRole("button", { name: "Turn on" }).isDisabled());
  await cronField.fill("*/5 * * * *");
  await scheduled.getByRole("button", { name: "Turn on" }).click();
  check("turnedOnItSaysWhenItNextRuns", await ok(scheduled.getByText(/^Next run .*, in /).waitFor({ timeout: 10_000 })));
  await cronField.fill("0 9 * * *");
  let savedCron = null;
  for (let i = 0; i < 20 && savedCron !== "0 9 * * *"; i++) {
    await sleep(500);
    const listed = await a.request.get(`${BASE}/api/rooms/E2ETST/automations/triggers`).then((response) => response.json());
    savedCron = listed.find((each) => each.kind === "schedule" && each.path?.startsWith(`${FOLDER}/`))?.schedule?.cron ?? null;
  }
  check("changingItsTimesWhileOnChangesWhenItRuns", savedCron === "0 9 * * *", savedCron);
  await scheduled.getByRole("button", { name: "Forget it" }).click();
  await scheduled.getByRole("group", { name: "Are you sure?" }).getByRole("button", { name: "Forget it" }).click();
  check("aScheduleCanBeForgotten", await ok(scheduled.getByRole("button", { name: "Turn on" }).waitFor({ timeout: 10_000 })));

  // ---- On something happening in the room: files changing, which ones, an example to try it with, turned on and forgotten ----
  await details.getByRole("button", { name: "Change the trigger" }).click();
  await details.getByPlaceholder(/^Search \d+ triggers$/).fill("files change");
  check("theRoomsOwnEventsAreAmongTheTriggers", await ok(details.getByRole("group", { name: "This room" }).waitFor({ timeout: 5000 })));
  await details.getByRole("option", { name: /^Files change/ }).first().click();
  const onFiles = details.getByRole("region", { name: "Step Files change" });
  await onFiles.waitFor({ timeout: 10_000 });
  check("itSaysWhatItIs", /This room: Files change/.test(await chart.getByRole("button", { name: /^Step Files change/ }).getAttribute("aria-label")));
  check("itHasNoWebhookFields", (await onFiles.getByRole("region", { name: "Its fields" }).count()) === 0 && (await onFiles.getByRole("textbox", { name: "Live address" }).count()) === 0);
  const which = onFiles.getByRole("textbox", { name: "Which files" });
  await which.fill("/etc/*");
  check("aPatternOutsideTheRoomSaysSo", await ok(onFiles.getByText(/should be a path inside the room/).waitFor({ timeout: 5000 })));
  await which.fill("src/**/*.py");
  await onFiles.getByRole("button", { name: "Use it as what to send" }).click();
  await details.getByRole("button", { name: "Back to the runs" }).click();
  check("anExampleCanBeWhatsSent", JSON.parse(await details.getByLabel("What to send, as JSON").inputValue()).event === "files.changed");
  await chart.getByRole("button", { name: /^Step Files change/ }).click();
  const listening = onFiles.getByRole("region", { name: "Starting by itself" });
  await listening.getByRole("button", { name: "Turn on" }).click();
  check("aRoomEventTurnsOn", await ok(listening.getByText("Waiting for it to happen.").waitFor({ timeout: 10_000 })));
  const savedEvent = (await a.request.get(`${BASE}/api/rooms/E2ETST/automations/triggers`).then((response) => response.json())).find((each) => each.kind === "event" && each.path?.startsWith(`${FOLDER}/`));
  check("itListensForThoseFiles", savedEvent?.event?.event === "files.changed" && savedEvent.event.paths === "src/**/*.py", savedEvent);
  await listening.getByRole("button", { name: "Forget it" }).click();
  await listening.getByRole("group", { name: "Are you sure?" }).getByRole("button", { name: "Forget it" }).click();
  check("aRoomEventCanBeForgotten", await ok(listening.getByRole("button", { name: "Turn on" }).waitFor({ timeout: 10_000 })));

  // ---- What people do: a Run failing keeps the files asked for, and the chat asks what a message starts with ----
  await onFiles.getByRole("combobox", { name: "When" }).selectOption({ label: "A run fails" });
  const onRun = details.getByRole("region", { name: "Step A run fails" });
  check("aRunFailingIsOneToo", await ok(onRun.waitFor({ timeout: 10_000 })));
  check("itKeepsTheFilesAskedFor", (await onRun.getByRole("textbox", { name: "Runs of which files" }).inputValue()) === "src/**/*.py");
  await onRun.getByRole("combobox", { name: "When" }).selectOption({ label: "A chat message" });
  const onChat = details.getByRole("region", { name: "Step A chat message" });
  const startsWith = onChat.getByRole("textbox", { name: "Only messages that start with" });
  check("theChatAsksWhatAMessageStartsWith", (await ok(startsWith.waitFor({ timeout: 10_000 }))) && (await onChat.getByRole("textbox", { name: /files/ }).count()) === 0);
  await startsWith.fill("/deploy");
  await onChat.getByRole("button", { name: "Use it as what to send" }).click();
  await details.getByRole("button", { name: "Back to the runs" }).click();
  const sentExample = JSON.parse(await details.getByLabel("What to send, as JSON").inputValue());
  check("itsExampleIsACommand", sentExample.event === "chat.message" && sentExample.data?.args === "staging", sentExample);
  await chart.getByRole("button", { name: /^Step A chat message/ }).click();

  // ---- An error flow: nothing to turn on, and each flow names its own under "If it fails, run" ----
  await details.getByRole("button", { name: "Change the trigger" }).click();
  await details.getByPlaceholder(/^Search \d+ triggers$/).fill("another flow fails");
  await details.getByRole("option", { name: /^Another flow fails/ }).first().click();
  const onFailure = details.getByRole("region", { name: "Step Another flow fails" });
  check("anErrorFlowHasNothingToTurnOn", await ok(onFailure.getByText(/There's nothing to turn on/).waitFor({ timeout: 10_000 })) && (await onFailure.getByRole("region", { name: "Starting by itself" }).count()) === 0);
  await details.getByRole("button", { name: "Back to the runs" }).click();
  const ifItFails = details.getByRole("combobox", { name: "If it fails, run" });
  check("aFlowCanNameItsErrorFlow", await ok(ifItFails.waitFor({ timeout: 5000 })) && (await ifItFails.getByRole("option", { name: "Nothing" }).count()) === 1);

  // ---- On a phone ----
  await a.setViewportSize({ width: 390, height: 800 });
  await sleep(800);
  const wide = await a.evaluate(() => document.documentElement.scrollWidth);
  check("aPhoneDoesntScrollSideways", wide <= 390, wide);
  await a.setViewportSize({ width: 1440, height: 900 });
  await sleep(500);
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? error);
  await a.screenshot({ path: process.env.SHOT ?? "automations-failure.png" }).catch(() => {});
} finally {
  await a.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  // Whatever it turned on, even if it stopped halfway.
  const triggers = await a.request.get(`${BASE}/api/rooms/E2ETST/automations/triggers`).then((response) => response.json()).catch(() => []);
  for (const trigger of Array.isArray(triggers) ? triggers : []) if (trigger.path?.startsWith(`${FOLDER}/`)) await a.request.delete(`${BASE}/api/rooms/E2ETST/automations/triggers/${trigger.id}`, { headers: { origin: BASE } }).catch(() => {});
  await removeTheirFiles().catch(() => {});
  check("itsFilesAreRemoved", (await files.getByRole("treeitem", { name: new RegExp(`^${FOLDER}`) }).count()) === 0);
  check("noPageErrors", errors.length === 0, errors.join(" | "));
}
await browser.close();
finish();
