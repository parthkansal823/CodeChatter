// Ask the codebase in a browser: the question is searched for first, the answer is given what was found, its places open the file,
// what it read can be seen, and what it says that it wasn't shown is flagged. The search and the model are stood in for, so what the
// model is sent can be read: apps/runner/test/rag.e2e.mjs runs the real thing. Its file is removed at the end.
//   node test/ask-codebase.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const name = `ask_${Date.now().toString(36)}.py`;
const row = () => a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")}`) });

let searched = null;
let sent = null;
let hits = null;
let holdSearch = 0;
await a.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, provider: "openai", model: "stand-in", vision: false, problem: null, limit: { requests: 30, windowSeconds: 600 }, ollama: null } }));
await a.route("**/api/rooms/*/ai/retrieve", async (route) => {
  searched = route.request().postDataJSON();
  if (holdSearch) await sleep(holdSearch);
  if (!hits) return route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ detail: "This room's sandbox can't search yet: its image needs rebuilding." }) });
  return route.fulfill({ json: hits });
});
await a.route("**/api/rooms/*/ai/chat", (route) => {
  sent = route.request().postDataJSON();
  const events = [
    { type: "delta", text: `It connects in \`${name}:2\` and \`${name}:1-3\`. See also \`${name}:50\` and \`src/invented.py\`.` },
    { type: "done", stop: "end", usage: { inputTokens: 10, outputTokens: 10, estimated: false } },
  ];
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
});

const passage = { path: name, start: 1, end: 4, name: "connect", text: "def connect():\n    return open_database()", score: 0.03, found: "both" };
const index = { files: 3, chunks: 9, changed: 0, embedded: 0, waiting: 0, ms: 40, model: "embedder" };

try {
  // Nobody signed out gets anything.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/ai/retrieve`, { headers: { origin: BASE }, data: { question: "Where?" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
  await sleep(800);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText("def connect():\n    return open_database()\n");
  await sleep(1500);

  // Choosing the mode.
  await a.getByRole("button", { name: "AI", exact: true }).click(); // the title bar toggle opens the side panel on AI
  const panel = a.getByRole("log", { name: "AI conversation" });
  await panel.waitFor({ timeout: 15_000 });
  const modes = a.getByRole("combobox", { name: "AI mode" });
  await modes.click();
  await a.getByRole("option", { name: "Ask the codebase" }).click();
  const box = a.getByPlaceholder("Where do we handle failed logins?");
  check("theModeIsOffered", await ok(box.waitFor({ timeout: 5_000 })));

  // A search that fails says why, and keeps the question.
  hits = null;
  await box.fill("Where do we connect?");
  await box.press("Enter");
  check("aFailedSearchSaysWhy", await ok(a.getByText(/needs rebuilding/).first().waitFor({ timeout: 10_000 })));
  check("theQuestionIsKept", (await box.inputValue()) === "Where do we connect?");
  check("nothingWentToTheModel", sent === null);

  // The real flow: the search first, and it says so while it looks.
  hits = { passages: [passage, { ...passage, start: 10, end: 12, name: "", text: "print('x')", found: "words" }], index, note: null };
  holdSearch = 1200;
  await box.press("Enter");
  check("itSaysItsSearching", await ok(a.getByRole("status").getByText("Searching the code…").waitFor({ timeout: 5_000 })));
  check("theAnswerComes", await ok(panel.getByText(/It connects in/).waitFor({ timeout: 20_000 })));
  holdSearch = 0;
  check("itSearchedForTheQuestion", searched?.question === "Where do we connect?", JSON.stringify(searched));
  check("inCodebaseMode", sent?.mode === "codebase");
  check("theModelIsGivenWhatItFound", sent?.context?.retrieved?.length === 2 && sent.context.retrieved[0].text.includes("open_database") && sent.context.retrieved[0].path === name, JSON.stringify(sent?.context?.retrieved));
  check("noWholeProjectGoesWithIt", !sent?.context?.project && !sent?.context?.file);
  check("itSaysHowManyItFound", await panel.getByText("2 passages found").isVisible());

  // Its citations.
  check("aPlaceItCitesOpensTheFile", await panel.getByRole("button", { name: `${name}:2` }).isVisible());
  check("aRangeOfLinesOpensItToo", await panel.getByRole("button", { name: `${name}:1-3` }).isVisible());
  check("aFileThatIsntThereIsFlagged", await panel.getByText(/Not in this project/).isVisible());
  check("aPlaceItWasntShownIsFlagged", await panel.getByText(/cites places it wasn't shown/).isVisible());
  check("onlyThatOne", (await panel.getByText(/wasn't shown/).locator("span").innerText()) === `${name}:50`);

  // What it read.
  const read = panel.getByText("What it read: 2 passages");
  check("itCanShowWhatItRead", await read.isVisible());
  await read.click();
  check("withTheText", await panel.getByText("return open_database()").first().isVisible());
  check("andHowItWasFound", (await panel.getByText("found by meaning and words").isVisible()) && (await panel.getByText("found by words").isVisible()));
  await panel.getByRole("button", { name: `${name}:1-4` }).click();
  check("aPassageOpensItsFile", await ok(a.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")), selected: true }).waitFor({ timeout: 10_000 })));

  // What to know about the search, and when it finds nothing.
  hits = { passages: [], index, note: "Searched by words only: this server has no embedding model." };
  await box.fill("Anything about zebras?");
  await box.press("Enter");
  check("aNoteIsPassedOn", await ok(panel.getByText(/Searched by words only/).waitFor({ timeout: 20_000 })));
  check("itSaysItFoundNothing", await panel.getByText("The search found nothing to read.").isVisible());
  check("theModelIsToldToo", Array.isArray(sent?.context?.retrieved) && sent.context.retrieved.length === 0, JSON.stringify(sent?.context));
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 500));
} finally {
  await a.getByRole("button", { name: "New conversation" }).click().catch(() => {});
  await row().focus().catch(() => {});
  await a.keyboard.press("Delete").catch(() => {});
  check("theFileIsRemoved", await ok(row().waitFor({ state: "detached", timeout: 10_000 })));
  check("noPageErrors", errors.length === 0, errors.join(" | "));
  await browser.close();
}
finish();
