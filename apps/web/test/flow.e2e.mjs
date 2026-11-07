// The Flow tool in a browser, with real dbt and DuckDB behind it: the example project on the chart, a build two people watch, rows, a profile and
// the rows a check found, a check and recipes made from the screen and built, a CSV added, stopping, and a phone. Only two failures are stood in
// for. Its files and everything dbt made are removed.
//   node test/flow.e2e.mjs        (from apps/web, with the dev stack running and the current sandbox images)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FOLDER = "orders-flow";

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const files = a.getByRole("tree", { name: "Files" });
const row = (name) => files.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
const apps = a.getByRole("group", { name: "Apps" });

/** Runs a shell line in the room, through its own Run button. */
async function runInRoom(line) {
  const name = `flow_shell_${Date.now().toString(36)}.sh`;
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  await sleep(500);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(`${line}\n`);
  await sleep(1500);
  await a.getByRole("button", { name: "Run", exact: true }).first().click();
  await sleep(4000);
  await row(name).focus();
  await a.keyboard.press("Delete");
  await sleep(800);
}
const CLEAN = 'rm -rf "$HOME/flow" "$HOME/lakehouse"';

async function removeProject(page = a) {
  const folder = page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${FOLDER}`) });
  if (await folder.count()) {
    await folder.first().focus();
    await page.keyboard.press("Delete");
    await sleep(800);
    const confirm = page.getByRole("alertdialog").getByRole("button", { name: /Delete/ });
    if (await confirm.count()) await confirm.click();
    await sleep(800);
  }
}

const tool = a.getByRole("region", { name: "Flow" });
const details = tool.getByRole("complementary", { name: "Details" });
const openTool = async () => {
  await apps.getByRole("button", { name: "Flow", exact: true }).click();
  await tool.waitFor({ timeout: 20_000 });
};
const chart = tool.getByRole("group", { name: "Datasets and the recipes that make them" });
const dataset = (name) => chart.getByRole("button", { name: new RegExp(`^Dataset ${escape(name)},`) });
const recipe = (name) => chart.getByRole("button", { name: new RegExp(`recipe that makes ${escape(name)},`) });
/** Opens a dataset's panel, wherever things are now. */
const select = async (name) => {
  await dataset(name).waitFor({ timeout: 30_000 });
  if ((await dataset(name).getAttribute("aria-pressed")) !== "true") await dataset(name).click();
  await details.getByRole("heading", { name }).waitFor({ timeout: 10_000 });
};
const backToBuilds = async () => {
  const back = details.getByRole("button", { name: "Back to the builds" });
  if (await back.count()) await back.click();
};
const buildAll = async () => {
  await tool.getByRole("button", { name: "Build all" }).click();
  await tool.getByRole("button", { name: "Stop" }).waitFor({ timeout: 10_000 }).catch(() => {});
  await tool.getByRole("button", { name: "Build all" }).waitFor({ timeout: 90_000 });
};

try {
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/flow`, { headers: { origin: BASE }, data: { op: "graph" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  // From a clean start: what an earlier run left is in the room's home, not its files.
  await removeProject();
  await runInRoom(CLEAN);

  // A sandbox from before dbt says what to do.
  await a.route("**/api/rooms/*/flow", (route) => route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ detail: "This room's sandbox doesn't have dbt yet. Restarting the sandbox brings it up to date." }) }));
  await openTool();
  check("aSandboxWithoutDbtSaysWhatToDo", await ok(tool.getByRole("alert").getByText(/doesn't have dbt yet.*Restarting/).waitFor({ timeout: 15_000 })));
  await a.unroute("**/api/rooms/*/flow");
  await tool.getByRole("button", { name: "Look again" }).click();

  // Empty, it explains itself and offers the example.
  check("itExplainsItselfWhenEmpty", await ok(tool.getByText(/the recipes that make them/).first().waitFor({ timeout: 30_000 })), await tool.innerText());
  await tool.getByRole("button", { name: "Make an example project" }).click();

  // The example comes up on the chart.
  check("theExampleShowsOnTheChart", await ok(dataset("state_share").waitFor({ timeout: 40_000 })), await tool.innerText());
  check("itsFilesAreInTheRoom", (await row(FOLDER).count()) === 1);
  for (const name of ["raw_orders", "cities", "clean_orders", "orders_by_state"]) check(`itShows_${name}`, (await dataset(name).count()) === 1);
  check("aRecipeForEachMadeThing", (await chart.getByRole("button", { name: /^SQL recipe that makes/ }).count()) === 2 && (await chart.getByRole("button", { name: /^Python recipe that makes state_share/ }).count()) === 1);
  check("uploadedDataHasNoRecipe", (await recipe("raw_orders").count()) === 0);
  check("arrowsConnectThem", (await chart.locator(".react-flow__edge").count()) === 7, await chart.locator(".react-flow__edge").count());
  check("itSaysWhatEachIsMadeFrom", /made from raw_orders/.test((await dataset("clean_orders").getAttribute("aria-label")) ?? ""));
  check("nothingIsBuiltYet", /not built yet/.test((await dataset("clean_orders").getAttribute("aria-label")) ?? ""));
  check("theToolSaysWhichProject", (await tool.getByText("orders_flow").count()) === 1);

  // Someone else has it open too.
  const { page: b } = await signIn("test2@codechatter.local");
  await b.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Flow", exact: true }).click();
  const theirTool = b.getByRole("region", { name: "Flow" });
  const theirChart = theirTool.getByRole("group", { name: "Datasets and the recipes that make them" });
  check("theyCanSeeTheChart", await ok(theirChart.getByRole("button", { name: /^Dataset clean_orders,/ }).waitFor({ timeout: 40_000 })));

  // A build.
  const unbuilt = await select("clean_orders").then(() => details.getByText("Not built yet", { exact: false }).first().waitFor({ timeout: 15_000 })).then(() => true, () => false);
  check("aDatasetNotBuiltSaysSo", unbuilt, await details.innerText());
  await backToBuilds();
  const started = Date.now();
  await tool.getByRole("button", { name: "Build all" }).click();
  check("buildingCanBeStopped", await ok(tool.getByRole("button", { name: "Stop" }).waitFor({ timeout: 10_000 })));
  await tool.getByRole("button", { name: "Build all" }).waitFor({ timeout: 90_000 });
  console.log(`      the build took ${Math.round((Date.now() - started) / 100) / 10} s`);
  check("itSaysHowTheBuildWent", await ok(details.getByRole("heading", { name: "Built, with warnings" }).waitFor({ timeout: 15_000 })), await details.innerText());
  check("whatDbtSaidIsThere", await ok(details.getByRole("group", { name: "What dbt said" }).getByText(/Completed with 1 warning/).waitFor({ timeout: 5000 })));
  check("whoStartedIt", /Test/i.test(await details.innerText()), await details.innerText());
  check("theChartLightsUp", await ok(a.waitForFunction(() => /ran fine/.test(document.querySelector('[aria-label^="Dataset orders_by_state,"]')?.getAttribute("aria-label") ?? ""), undefined, { timeout: 15_000 })));
  check("aDatasetWithAWarningShowsIt", /has a warning/.test((await dataset("clean_orders").getAttribute("aria-label")) ?? ""), await dataset("clean_orders").getAttribute("aria-label"));
  check("theOtherPersonSeesItToo", await ok(theirChart.getByRole("button", { name: /^Dataset orders_by_state, ran fine/ }).waitFor({ timeout: 25_000 })));
  await b.context().close();

  // Its rows and profile.
  await select("clean_orders");
  const rows = details.getByRole("group", { name: "Rows of clean_orders" });
  check("itsRowsShow", await ok(rows.getByText("Mumbai").first().waitFor({ timeout: 20_000 })), await details.innerText());
  check("namesAreTidied", (await rows.getByText("pune", { exact: true }).count()) === 0 && (await rows.getByText("mumbai", { exact: true }).count()) === 0);
  check("repeatedRowsAreGone", (await rows.locator("tbody tr").count()) === 9, await rows.locator("tbody tr").count());
  check("emptyValuesShowAsSuch", (await rows.getByText("NULL").count()) === 1);
  check("itCanBeExplained", (await details.getByRole("button", { name: /Explain/ }).count()) === 1);
  await details.getByRole("button", { name: "Profile" }).click();
  const profile = details.getByRole("region", { name: "Its profile" });
  check("aProfileCountsItsRows", await ok(profile.getByText(/^9 rows, 3 columns/).waitFor({ timeout: 20_000 })), await details.innerText());
  check("itSaysWhatsEmpty", /amount[\s\S]*?Empty\s+11\.11%/.test(await profile.innerText()), await profile.innerText());
  check("itSaysTheCommonestValues", /Most common: Pune \(3\)/.test(await profile.innerText()), await profile.innerText());

  // Its checks.
  await details.getByRole("button", { name: /^Checks/ }).click();
  const checks = details.getByRole("region", { name: "Its checks" });
  check("itsChecksAreInPlainWords", await ok(checks.getByText("amount is never empty").waitFor({ timeout: 5000 })) && (await checks.getByText("order_id has no duplicates").count()) === 1 && (await checks.getByText("amount stays in its range").count()) === 1, await checks.innerText());
  check("oneWarns", /amount is never empty\s+Warning: 1 row/.test(await checks.innerText()), await checks.innerText());
  await checks.getByRole("button", { name: "The rows that broke: amount is never empty" }).click();
  const broke = checks.getByRole("group", { name: "Rows of amount is never empty" });
  check("itShowsTheRowThatBrokeIt", await ok(broke.getByRole("cell", { name: "3", exact: true }).waitFor({ timeout: 15_000 })), await checks.innerText());

  // A check made from the screen, that fails.
  await checks.getByRole("button", { name: "Add a check" }).click();
  const form = details.getByRole("form", { name: "Add a check" });
  await form.getByLabel("What should be true").selectOption("accepted");
  await form.getByLabel("Of which column").selectOption("city");
  await form.getByRole("button", { name: "Add it" }).click();
  check("aCheckAsksForWhatItNeeds", await ok(form.getByRole("alert").getByText(/List the allowed values/).waitFor({ timeout: 3000 })));
  await form.getByLabel("Allowed values").fill("Pune, Delhi, Mumbai");
  await form.getByRole("button", { name: "Add it" }).click();
  check("theCheckShowsUp", await ok(checks.getByText("city only has the allowed values").waitFor({ timeout: 30_000 })), await details.innerText());
  await buildAll();
  check("whatItHoldsBackIsSkipped", await ok(a.waitForFunction(() => /skipped/.test(document.querySelector('[aria-label^="Dataset orders_by_state,"]')?.getAttribute("aria-label") ?? ""), undefined, { timeout: 20_000 })), await dataset("orders_by_state").getAttribute("aria-label"));
  check("theDatasetShowsTheFailure", /^Dataset clean_orders, failed/.test((await dataset("clean_orders").getAttribute("aria-label")) ?? ""), await dataset("clean_orders").getAttribute("aria-label"));
  await backToBuilds();
  check("theBuildSaysItFailed", await ok(details.getByRole("heading", { name: "The build failed" }).waitFor({ timeout: 10_000 })), await details.innerText());
  await select("clean_orders");
  await details.getByRole("button", { name: /^Checks/ }).click();
  const made = "city only has the allowed values";
  await checks.getByRole("button", { name: `The rows that broke: ${made}` }).click();
  check("theRowsItFoundAreThere", await ok(checks.getByRole("group", { name: `Rows of ${made}` }).getByText("Agra").first().waitFor({ timeout: 15_000 })), await checks.innerText());
  await checks.getByRole("button", { name: `Remove the check: ${made}` }).click();
  check("removingACheckTakesItAway", await ok(checks.getByRole("button", { name: `Remove the check: ${made}` }).waitFor({ state: "detached", timeout: 30_000 })), await checks.innerText());
  check("aCheckInYamlCantBeRemovedFromHere", (await checks.getByRole("button", { name: "Remove the check: order_id has no duplicates" }).count()) === 0);
  await buildAll();

  // A recipe, and its code.
  await backToBuilds();
  await recipe("clean_orders").click();
  const recipePanel = details.getByRole("region", { name: "The recipe for clean_orders" });
  check("aRecipeSaysWhatItDoes", await ok(recipePanel.getByText(/Makes clean_orders from raw_orders/).waitFor({ timeout: 5000 })), await details.innerText());
  await recipePanel.getByRole("button", { name: "Open the code" }).click();
  check("itsCodeOpens", await ok(a.getByRole("tab", { name: /clean_orders\.sql/ }).waitFor({ timeout: 15_000 })));
  await openTool();

  // Recipes made from the screen, on real columns.
  await select("orders_by_state");
  await details.getByRole("button", { name: "New recipe from this" }).click();
  const newRecipe = details.getByRole("form", { name: "New recipe" });
  await newRecipe.getByLabel("Name of the dataset").fill("Not A Name");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("aBadNameIsRefused", await ok(newRecipe.getByRole("alert").getByText(/lower-case/).waitFor({ timeout: 3000 })));
  await newRecipe.getByLabel("Name of the dataset").fill("orders_by_state");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("soIsATakenOne", await ok(newRecipe.getByRole("alert").getByText(/already a dataset/).waitFor({ timeout: 3000 })));
  await newRecipe.getByLabel("Column", { exact: true }).waitFor({ timeout: 15_000 });
  await newRecipe.getByLabel("Column", { exact: true }).selectOption("orders");
  await newRecipe.getByLabel("Test", { exact: true }).selectOption("above");
  await newRecipe.getByLabel("Value", { exact: true }).fill("2");
  await newRecipe.getByLabel("Name of the dataset").fill("busy_states");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("aFilterRecipeComesUp", await ok(dataset("busy_states").waitFor({ timeout: 30_000 })), await tool.innerText());

  await select("clean_orders");
  await details.getByRole("button", { name: "New recipe from this" }).click();
  await newRecipe.getByLabel("What it does").selectOption("group");
  await newRecipe.getByLabel("Name of the dataset").fill("city_totals");
  await newRecipe.getByRole("group", { name: "One row for each" }).getByRole("checkbox").nth(1).click();
  await newRecipe.getByLabel("What to work out").selectOption("sum");
  await newRecipe.getByLabel("Of which column").selectOption("amount");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("aGroupRecipeComesUp", await ok(dataset("city_totals").waitFor({ timeout: 30_000 })), await tool.innerText());

  await select("clean_orders");
  await details.getByRole("button", { name: "New recipe from this" }).click();
  await newRecipe.getByLabel("What it does").selectOption("join");
  await newRecipe.getByLabel("Name of the dataset").fill("orders_with_state");
  await newRecipe.getByLabel("Other dataset", { exact: true }).selectOption("cities");
  await newRecipe.getByLabel("Match this column here").waitFor({ timeout: 15_000 });
  await newRecipe.getByLabel("Match this column here").selectOption("city");
  await newRecipe.getByLabel("With this one there").selectOption("city");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("aJoinRecipeComesUp", await ok(dataset("orders_with_state").waitFor({ timeout: 30_000 })), await tool.innerText());

  await backToBuilds();
  await buildAll();
  check("theyAllBuild", await ok(a.waitForFunction(() => ["busy_states", "city_totals", "orders_with_state"].every((name) => /ran fine/.test(document.querySelector(`[aria-label^="Dataset ${name},"]`)?.getAttribute("aria-label") ?? "")), undefined, { timeout: 20_000 })), await tool.innerText());
  await select("busy_states");
  const busy = details.getByRole("group", { name: "Rows of busy_states" });
  check("theFilterKeptTheRightRows", await ok(busy.getByText("Maharashtra").waitFor({ timeout: 15_000 })) && (await busy.locator("tbody tr").count()) === 1, await details.innerText());
  await select("city_totals");
  const totals = details.getByRole("group", { name: "Rows of city_totals" });
  await totals.getByText("Pune").waitFor({ timeout: 15_000 });
  const puneRow = await totals.locator("tr", { hasText: "Pune" }).innerText();
  check("theGroupAddedUpRight", /Pune\s+3\s+165\.5/.test(puneRow), puneRow);
  await select("orders_with_state");
  const joined = details.getByRole("group", { name: "Rows of orders_with_state" });
  await joined.getByText("Uttar Pradesh").first().waitFor({ timeout: 15_000 }).catch(() => {});
  const heads = await joined.locator("thead th").allInnerTexts();
  check("theJoinAddedTheColumnOnce", heads.join() === "order_id,city,amount,state", heads);

  // A blank recipe opens to be written.
  await backToBuilds();
  await tool.getByRole("button", { name: "New recipe" }).click();
  await newRecipe.getByLabel("Name of the dataset").fill("written_by_hand");
  await newRecipe.getByLabel("What it does").selectOption("python");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("aBlankRecipeOpensToBeWritten", await ok(a.getByRole("tab", { name: /written_by_hand\.py/ }).waitFor({ timeout: 15_000 })));
  check("itStartsAsARecipe", await ok(a.locator(".monaco-editor .view-lines").getByText("def").first().waitFor({ timeout: 10_000 })));
  await openTool();
  check("whatsChangedShowsWhenTheToolOpens", await ok(dataset("written_by_hand").waitFor({ timeout: 30_000 })), await tool.innerText());

  // A CSV.
  await tool.getByLabel("A CSV file to add").setInputFiles({ name: "Staff List.csv", mimeType: "text/csv", buffer: Buffer.from("name,team\nAsha,red\nBen,blue\n") });
  check("aCsvBecomesADataset", await ok(dataset("staff_list").waitFor({ timeout: 30_000 })), await tool.innerText());
  await tool.getByLabel("A CSV file to add").setInputFiles({ name: "Staff List.csv", mimeType: "text/csv", buffer: Buffer.from("name,team\n") });
  check("aSecondOneDoesntOverwriteIt", await ok(tool.getByRole("alert").getByText(/already has/).waitFor({ timeout: 5000 })));
  await tool.getByLabel("A CSV file to add").setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.alloc(2 * 1024 * 1024 + 1, "a") });
  check("aBigOneIsTurnedAway", await ok(tool.getByRole("alert").getByText(/over 2 MB/).waitFor({ timeout: 5000 })));

  // Building just one thing.
  await select("staff_list");
  await details.getByRole("button", { name: "Build this" }).click();
  check("oneThingCanBeBuilt", await ok(details.getByRole("group", { name: "Rows of staff_list" }).getByText("Asha").waitFor({ timeout: 60_000 })), await details.innerText());

  // AutoML, for real: FLAML learns a rule from a CSV, from a form.
  const customers = Array.from({ length: 300 }, (_, i) => {
    const visits = (i * 7) % 31;
    const area = ["Pune", "Agra", "Delhi"][i % 3];
    return [i, visits, area, visits > 12 && area !== "Agra" ? "yes" : "no"];
  });
  await tool.getByLabel("A CSV file to add").setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(`id,visits,area,bought\n${customers.map((item) => item.join(",")).join("\n")}\n`) });
  await select("customers");
  await details.getByRole("button", { name: "Build this" }).click();
  await details.getByRole("group", { name: "Rows of customers" }).waitFor({ timeout: 60_000 });
  await details.getByRole("button", { name: "New recipe from this" }).click();
  await newRecipe.getByLabel("What it does").selectOption("automl");
  await newRecipe.getByLabel("Name of the dataset").fill("will_buy");
  await newRecipe.getByLabel("Column to predict").waitFor({ timeout: 15_000 });
  await newRecipe.getByLabel("Column to predict").selectOption("visits");
  check("aNumberIsPredictedAsANumber", (await newRecipe.getByLabel("What it is").inputValue()) === "regression");
  await newRecipe.getByLabel("Column to predict").selectOption("bought");
  check("anythingElseAsOneOfItsValues", (await newRecipe.getByLabel("What it is").inputValue()) === "classification");
  await newRecipe.getByRole("group", { name: "Learn from" }).getByRole("checkbox").first().click();
  await newRecipe.getByLabel("How long to try").selectOption("15");
  await newRecipe.getByRole("button", { name: "Make it" }).click();
  check("anAutomlRecipeComesUp", await ok(dataset("will_buy").waitFor({ timeout: 30_000 })), await tool.innerText());
  check("itsAPythonRecipe", (await chart.getByRole("button", { name: /^Python recipe that makes will_buy/ }).count()) === 1);
  await select("will_buy");
  await details.getByRole("button", { name: "Build this" }).click();
  const guesses = details.getByRole("group", { name: "Rows of will_buy" });
  check("itTrainsAndMakesADataset", await ok(guesses.waitFor({ timeout: 120_000 })), await details.innerText());
  const heads2 = await guesses.locator("thead th").allInnerTexts();
  check("eachRowHasItsPrediction", heads2.join() === "id,visits,area,bought,predicted_bought,held_back", heads2);
  const guessed = await guesses.locator("tbody tr").evaluateAll((all) => all.map((item) => [...item.cells].map((cell) => cell.textContent)));
  const heldBack = guessed.filter((item) => item[5] === "True");
  const right = heldBack.filter((item) => item[3] === item[4]).length;
  check("itDoesWellOnRowsItNeverSaw", heldBack.length >= 10 && right / heldBack.length >= 0.85, { right, of: heldBack.length });
  await backToBuilds();
  check("theLogSaysHowItDid", await ok(details.getByRole("group", { name: "What dbt said" }).getByText(/Best model: \w+\. accuracy on the rows held back: [01]\.\d+/).waitFor({ timeout: 10_000 })), await details.innerText());

  // On the full image, the run is one the Lakehouse tool can compare.
  const experiments = await a.request.post(`${BASE}/api/rooms/${ROOM}/lakehouse`, { headers: { origin: BASE }, data: { op: "runs" } });
  const logged = experiments.ok() ? (await experiments.json()).runs.find((run) => run.experiment === "Flow: will_buy") : null;
  check("mlflowHasTheRun", !experiments.ok() || (logged?.status === "FINISHED" && logged.metrics.accuracy >= 0.85 && logged.params.target === "bought"), experiments.ok() ? (logged ?? "no such run") : experiments.status());

  // Stopping, with a recipe that sleeps.
  await backToBuilds();
  await runInRoom(`printf 'import time\\n\\ndef model(dbt, session):\\n    time.sleep(120)\\n    return dbt.ref("clean_orders").df()\\n' > /workspace/${FOLDER}/models/slow.py`);
  await openTool();
  await tool.getByRole("button", { name: "Look again" }).click();
  check("aFileMadeInTheSandboxShowsUpToo", await ok(dataset("slow").waitFor({ timeout: 40_000 })), await tool.innerText());
  await tool.getByRole("button", { name: "Build all" }).click();
  check("whatsRunningShows", await ok(a.waitForFunction(() => /running now/.test(document.querySelector('[aria-label^="Dataset slow,"]')?.getAttribute("aria-label") ?? ""), undefined, { timeout: 80_000 })), await dataset("slow").getAttribute("aria-label"));
  await tool.getByRole("button", { name: "Stop" }).click();
  check("stoppingStopsIt", await ok(details.getByRole("heading", { name: "The build was stopped" }).waitFor({ timeout: 30_000 })), await details.innerText());
  check("earlierBuildsAreListed", await ok(details.getByRole("region", { name: "Earlier builds" }).getByRole("button", { name: /^Built, with warnings/ }).first().waitFor({ timeout: 10_000 })), await details.innerText());
  await details.getByRole("region", { name: "Earlier builds" }).getByRole("button", { name: /^Built, with warnings/ }).first().click();
  check("anEarlierOneOpens", await ok(details.getByRole("region", { name: "Earlier builds" }).getByRole("group", { name: /What dbt said/ }).waitFor({ timeout: 10_000 })));

  // A project dbt can't read: what it says shows, over what it last knew.
  await a.route("**/api/rooms/*/flow", async (route) => {
    if (!/"op":"graph"/.test(route.request().postData() ?? "")) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, problem: "Parsing Error in schema.yml: this is stood in for." } });
  });
  await tool.getByRole("button", { name: "Look again" }).click();
  check("whatDbtCantReadIsSaid", await ok(tool.getByRole("alert").getByText(/Parsing Error in schema\.yml/).waitFor({ timeout: 20_000 })));
  check("andHowItLastWasStays", (await dataset("clean_orders").count()) === 1);
  await a.unroute("**/api/rooms/*/flow");
  await tool.getByRole("button", { name: "Look again" }).click();
  await sleep(1500);

  // On a phone.
  await a.setViewportSize({ width: 390, height: 800 });
  await sleep(800);
  const wide = await a.evaluate(() => document.documentElement.scrollWidth);
  check("aPhoneDoesntScrollSideways", wide <= 390, wide);
  await a.setViewportSize({ width: 1280, height: 800 });
  await sleep(500);
} catch (error) {
  console.error(error);
  check("noUnexpectedError", false, error.stack ?? String(error));
} finally {
  await a.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  await a.unrouteAll().catch(() => {});
  await tool.getByRole("button", { name: "Stop" }).click({ timeout: 1000 }).catch(() => {});
  const close = a.getByRole("button", { name: "Close Flow" });
  if (await close.count().catch(() => 0)) await close.click().catch(() => {});
  await removeProject().catch(() => {});
  await runInRoom(CLEAN).catch(() => {});
  await sleep(1000);
  check("itsFilesAreRemoved", (await row(FOLDER).count()) + (await files.getByRole("treeitem", { name: /^flow_shell_/ }).count()) === 0);
  check("noPageErrors", errors.length === 0, errors.join(" | "));
}
await browser.close();
finish();
