// The Prompt Playground in a browser, two people: a prompt written together, variables that appear as they're typed, two columns
// streaming side by side with their numbers, a run kept and an earlier prompt put back, Stop, and what a model that fails shows.
// The model is stood in for, so what it was sent can be read. The prompt is deleted at the end.
//   node test/prompts.e2e.mjs        (from apps/web, with the dev stack running)
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
const MODELS = { models: ["first", "second", "breaks"], default: "first", temperature: true, json: true, oneAtATime: false, contextChars: 32000, gateway: { on: true, requests: 120, windowSeconds: 600 } };
let hold = null;
for (const page of [a, b]) {
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, provider: "openai", model: "first", vision: false, problem: null, limit: { requests: 30, windowSeconds: 600 }, ollama: null } }));
  await page.route("**/api/rooms/*/ai/models", (route) => route.fulfill({ json: MODELS }));
  await page.route("**/api/rooms/*/ai/prompt", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    if (body.model === "breaks") return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "error", message: "The AI provider is having trouble right now." })}\n\n` });
    if (hold) await hold;
    const words = body.json ? '{"answer": 1}' : `An answer from ${body.model}.`;
    const events = [
      { type: "delta", text: words },
      { type: "done", stop: "end", usage: { inputTokens: 11, outputTokens: 22, estimated: false }, timing: { firstMs: 500, totalMs: 2500 } },
    ];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") }).catch(() => {});
  });
}

const open = async (page) => {
  await page.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Prompts", exact: true }).click();
  const tool = page.getByRole("region", { name: "Prompts" });
  await tool.waitFor({ timeout: 20_000 });
  return tool;
};

let toolA = null;
try {
  // Nobody signed out gets anything.
  const outside = await browser.newContext();
  const refused = await outside.request.post(`${BASE}/api/rooms/${ROOM}/ai/prompt`, { headers: { origin: BASE }, data: { messages: [{ role: "user", content: "Hi" }], model: "first" } });
  check("signedOutIsRefused", refused.status() === 401, refused.status());
  await outside.close();

  toolA = await open(a);
  const toolB = await open(b);
  const name = `Prompt test ${Date.now().toString(36)}`;
  await toolA.getByRole("button", { name: "New prompt" }).click();
  await toolA.getByLabel("Prompt name").fill(name);
  check("theNewPromptShowsForTheOtherPerson", await ok(toolB.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name }).waitFor({ timeout: 15_000 })));
  await toolB.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name }).click();

  // A new prompt starts as something that runs, and teaches variables.
  check("itStartsWithAVariable", (await toolA.getByLabel("Message 1", { exact: true }).inputValue()).includes("{{topic}}"));
  check("itsValueIsListed", (await toolA.getByLabel("Value of topic").inputValue()) === "recursion");
  await toolA.getByLabel("Value of topic").fill("loops");
  check("theValueReachesTheOtherPerson", await ok(b.waitForFunction(() => [...document.querySelectorAll("textarea")].some((field) => field.value === "loops"), null, { timeout: 15_000 })));

  // Typing a new variable makes a field for it, for both.
  await toolB.getByLabel("Message 1", { exact: true }).fill("Explain {{topic}} to {{who}}.");
  check("aNewVariableGetsAField", await ok(toolA.getByLabel("Value of who").waitFor({ timeout: 15_000 })));
  check("itSaysItsEmpty", await ok(toolA.getByText(/No value yet for who/).waitFor({ timeout: 5_000 })));
  await toolA.getByLabel("Value of who").click();
  await toolA.getByLabel("Value of who").fill("a child");

  // Two columns.
  await toolA.getByRole("button", { name: "Add a column" }).click();
  check("theNextColumnIsTheNextModel", (await toolA.getByLabel("Model in column 2").inputValue()) === "second");
  await toolA.getByRole("region", { name: "Column 2" }).getByLabel("Temperature").fill("0.3");
  await toolA.getByRole("region", { name: "Column 2" }).getByLabel("Max tokens").fill("200");
  check("theColumnReachesTheOtherPerson", await ok(toolB.getByLabel("Model in column 2").waitFor({ timeout: 15_000 })));

  // Run, by the keyboard, and watch it while it's going.
  let release = () => {};
  hold = new Promise((resolve) => {
    release = resolve;
  });
  await toolA.getByLabel("Value of who").press("Control+Enter");
  check("itShowsItsRunning", await ok(toolA.getByRole("button", { name: "Stop" }).waitFor({ timeout: 5_000 })));
  check("settingsCantChangeMidRun", await toolA.getByLabel("Model in column 1").isDisabled());
  release();
  hold = null;
  const column1 = toolA.getByRole("region", { name: "Column 1" });
  const column2 = toolA.getByRole("region", { name: "Column 2" });
  check("eachColumnGetsItsAnswer", (await ok(column1.getByText("An answer from first.").waitFor({ timeout: 15_000 }))) && (await ok(column2.getByText("An answer from second.").waitFor({ timeout: 15_000 }))));
  const fromFirst = sent.find((body) => body.model === "first");
  const fromSecond = sent.find((body) => body.model === "second");
  check("variablesAreFilledIn", fromFirst?.messages?.[0]?.content === "Explain loops to a child.", JSON.stringify(fromFirst));
  check("theSystemPromptGoesToo", fromFirst?.system?.startsWith("You are a helpful assistant"));
  check("eachColumnsSettingsGo", fromSecond?.temperature === 0.3 && fromSecond?.maxTokens === 200 && fromFirst?.temperature === undefined, JSON.stringify(fromSecond));
  check("theNumbersShow", await column1.getByText("0.5 s to the first word · 2.5 s in all · 11 in, 22 out · 11 tokens a second").isVisible());

  // The other person sees what came back, and the run is kept.
  check("theOtherPersonSeesTheAnswers", await ok(toolB.getByRole("region", { name: "Column 2" }).getByText("An answer from second.").waitFor({ timeout: 15_000 })));
  const runs = toolA.getByRole("region", { name: "Runs" });
  check("theRunIsListed", (await runs.getByRole("row").count()) === 2);
  check("itSaysWhoRanIt", await runs.getByRole("cell", { name: /Test|test1/i }).first().isVisible());
  check("thePromptIsStillAsItWas", await runs.getByText("As it is now").isVisible());

  // Change the prompt and run again: the earlier run can be opened, and its prompt brought back.
  await toolA.getByLabel("Message 1", { exact: true }).fill("Explain {{topic}} in one line to {{who}}.");
  await sleep(300);
  check("theEarlierRunNowDiffers", await ok(runs.getByText("Different").waitFor({ timeout: 5_000 })));
  await runs.getByRole("row").nth(1).getByRole("button").click();
  check("anEarlierRunOpens", await ok(toolA.getByText(/^The run at .* by /).waitFor({ timeout: 5_000 })));
  check("withItsPrompt", (await toolA.getByText("The prompt in that run").count()) === 1);
  await toolA.getByRole("button", { name: "Use this prompt" }).click();
  check("thePromptComesBack", await ok(a.waitForFunction(() => [...document.querySelectorAll("textarea")].some((field) => field.value === "Explain {{topic}} to {{who}}."), null, { timeout: 5_000 })));
  check("forTheOtherPersonToo", await ok(b.waitForFunction(() => [...document.querySelectorAll("textarea")].some((field) => field.value === "Explain {{topic}} to {{who}}."), null, { timeout: 15_000 })));
  await toolA.getByRole("button", { name: "Back to the latest" }).click();

  // JSON, checked. A model that fails says so in its own column, and the other still answers.
  await column1.getByLabel("JSON").check();
  await toolA.getByLabel("Model in column 2").selectOption("breaks");
  await toolA.getByRole("button", { name: "Run", exact: true }).click();
  check("aFailureShowsInItsColumn", await ok(column2.getByText("The AI provider is having trouble right now.").waitFor({ timeout: 15_000 })));
  check("theOtherColumnStillAnswers", await ok(column1.getByText('{"answer": 1}').waitFor({ timeout: 15_000 })));
  check("validJsonIsSaidSo", await column1.getByText("Valid JSON.").isVisible());

  // Stop keeps what came, and says it stopped.
  await toolA.getByLabel("Model in column 2").selectOption("second");
  hold = new Promise(() => {});
  await toolA.getByRole("button", { name: "Run", exact: true }).click();
  await toolA.getByRole("button", { name: "Stop" }).waitFor({ timeout: 5_000 });
  await toolA.getByRole("button", { name: "Stop" }).click();
  check("itStops", await ok(toolA.getByRole("button", { name: "Run", exact: true }).waitFor({ timeout: 10_000 })));
  hold = null;

  // The prompt as code, for this room's sandbox: filled in, and with no key.
  const fromCode = toolA.getByRole("region", { name: "Use it from code" });
  const python = await fromCode.getByLabel("The prompt as Python").innerText();
  check("itShowsAsCode", python.includes("from openai import OpenAI") && python.includes('model="first"') && python.includes("Explain loops to a child."), python.slice(0, 300));
  check("withNoKey", !/api_key|sk-/.test(python));
  await fromCode.getByRole("button", { name: "curl" }).click();
  check("inOtherLanguagesToo", (await fromCode.getByLabel("The prompt as curl").innerText()).includes("$OPENAI_BASE_URL/chat/completions"));
  check("itSaysHowItWorks", await fromCode.getByText(/no key/).isVisible());

  // Without a last message from the user, it can't be run, and says why.
  await toolA.getByLabel("Message 1", { exact: true }).fill("");
  check("itSaysWhyItCantRun", await ok(toolA.getByText(/last message has to be the user/).waitFor({ timeout: 5_000 })));
  check("andRunIsOff", await toolA.getByRole("button", { name: "Run", exact: true }).isDisabled());

  // Deleting asks first, and takes it away for both.
  await toolA.getByRole("button", { name: "Delete this prompt" }).click();
  await toolA.getByRole("button", { name: "Delete", exact: true }).click();
  check("itsGoneForTheOtherPerson", await ok(toolB.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name }).waitFor({ state: "detached", timeout: 15_000 })));
  toolA = null;
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 400));
} finally {
  // Whatever happened, nothing's left behind.
  const left = a.getByRole("navigation", { name: "Prompts in this room" }).getByRole("button", { name: /^Prompt test / });
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
