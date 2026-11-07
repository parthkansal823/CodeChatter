// Explain this data in a browser, on a real SQL result and a real pandas table. DuckDB in the sandbox works out the numbers for real;
// only the model is stood in for, so what it's sent can be read. The test's files are removed.
//   node test/explain-data.e2e.mjs        (from apps/web, with the dev stack running and the current sandbox images)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stamp = Date.now().toString(36);
const csv = `sales_${stamp}.csv`;
const notebookName = `table_${stamp}.ipynb`;

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const row = (name) => a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });

let sent = null;
await a.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, provider: "openai", model: "stand-in", vision: false, problem: null, limit: { requests: 30, windowSeconds: 600 }, ollama: null } }));
await a.route("**/api/rooms/*/ai/chat", (route) => {
  sent = route.request().postDataJSON();
  const events = [
    { type: "delta", text: "## What this is\nSales by region." },
    { type: "done", stop: "end", usage: { inputTokens: 10, outputTokens: 10, estimated: false } },
  ];
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
});

try {
  // Nobody signed out gets anything.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/data/summary`, { headers: { origin: BASE }, data: { columns: ["a"], rows: [["1"]] } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  // A real SQL result.
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(csv);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(csv)) }).waitFor({ timeout: 15_000 });
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText("region,amount\nnorth,10\nsouth,5\nnorth,7\nsouth,\neast,1000\n");
  await a.getByRole("button", { name: "Databases", exact: true }).click();
  await a.getByRole("region", { name: "Database files" }).getByRole("listitem", { name: "The room's data files" }).getByRole("button", { name: "Open" }).click({ timeout: 30_000 });
  const list = a.getByRole("complementary", { name: "Data files" });
  const entry = list.getByRole("button", { name: new RegExp(escape(csv)) });
  for (let i = 0; i < 15 && !(await entry.isVisible()); i++) {
    await list.getByRole("button", { name: "Refresh data files" }).click();
    await entry.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await entry.click();
  const results = a.getByRole("region", { name: "Results" });
  await results.getByText("5 rows", { exact: true }).waitFor({ timeout: 30_000 });
  const explain = results.getByRole("button", { name: "Explain this data" });
  check("aResultOffersIt", await explain.isVisible());
  await explain.click();
  const panel = a.getByRole("log", { name: "AI conversation" });
  check("theAiPanelAnswers", await ok(panel.getByText("Sales by region.").waitFor({ timeout: 60_000 })));
  check("inDataMode", sent?.mode === "data", sent?.mode);
  const data = sent?.context?.data;
  const amount = data?.summary.columns.find((column) => column.name === "amount");
  check("itSendsDuckDbsNumbers", /^DuckDB/.test(data?.summary.engine ?? "") && data?.summary.rows === 5, JSON.stringify(data?.summary).slice(0, 200));
  check("whichAreRight", amount?.max === "1000" && Number(amount?.mean) === 255.5 && amount?.nullPercent === 20, JSON.stringify(amount));
  check("withAFewRows", data?.sample.rows.length === 5 && data.sample.columns.join() === "region,amount", JSON.stringify(data?.sample));
  check("itKnowsThisIsAllOfIt", data?.source === "query" && data.complete === true);
  check("itSaysWhatItSent", await panel.getByText(/5 rows, DuckDB's numbers/).isVisible());
  const numbers = panel.getByText(/The numbers it was given, from DuckDB/);
  check("theNumbersCanBeSeen", await numbers.isVisible());
  await numbers.click();
  check("eachColumnsNumbers", await panel.getByRole("group", { name: "The numbers it was given" }).getByRole("rowheader", { name: "amount" }).isVisible());

  // A question after it keeps the table.
  sent = null;
  await a.getByPlaceholder("Ask about this data").fill("Which region is odd?");
  await a.getByPlaceholder("Ask about this data").press("Enter");
  await sleep(1500);
  check("aFollowUpKeepsTheNumbers", sent?.context?.data?.summary.rows === 5 && sent.messages.at(-1).content === "Which region is odd?", JSON.stringify(sent?.context?.data?.summary?.rows));

  // A real pandas table, from a real kernel.
  await a.getByRole("button", { name: "New conversation" }).click();
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(notebookName);
  await a.getByPlaceholder("name.ext").press("Enter");
  const notebook = a.getByRole("region", { name: `Notebook ${notebookName}` });
  await notebook.waitFor({ timeout: 20_000 });
  const cell = notebook.getByRole("list", { name: "Cells" }).locator(":scope > li").first();
  await cell.locator(".monaco-editor .view-lines").click();
  await a.keyboard.press("Control+a");
  await a.keyboard.insertText('import pandas as pd\npd.DataFrame({"city": ["Pune", "Delhi", "Pune"], "rooms": [3, 5, None]})');
  await a.keyboard.press("Escape");
  await a.keyboard.press("Control+Enter");
  const fromNotebook = cell.getByRole("group", { name: "Output" }).getByRole("button", { name: "Explain this data" });
  check("aPandasTableOffersIt", await ok(fromNotebook.waitFor({ timeout: 180_000 })));
  sent = null;
  await fromNotebook.click();
  await panel.getByText("Sales by region.").waitFor({ timeout: 60_000 });
  const table = sent?.context?.data;
  check("itSaysItsFromANotebook", table?.source === "notebook" && table.complete === true, JSON.stringify(table).slice(0, 200));
  check("itReadsThePandasTable", table?.summary.rows === 3 && table.summary.columns.map((column) => column.name).join() === "index,city,rooms", JSON.stringify(table?.summary.columns?.map((column) => column.name)));
  const rooms = table?.summary.columns.find((column) => column.name === "rooms");
  check("andAnEmptyValueAsEmpty", Math.abs(rooms?.nullPercent - 33.3) < 0.1 && Number(rooms?.mean) === 4, JSON.stringify(rooms));
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  await a.getByRole("button", { name: "New conversation" }).click().catch(() => {});
  for (const name of [notebookName, csv]) {
    if (await row(name).count().catch(() => 0)) {
      await row(name).focus().catch(() => {});
      await a.keyboard.press("Delete").catch(() => {});
      await sleep(800);
    }
  }
  check("theFilesAreRemoved", (await row(notebookName).count()) + (await row(csv).count()) === 0);
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
