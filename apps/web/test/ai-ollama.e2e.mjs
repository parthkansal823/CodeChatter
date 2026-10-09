// Local AI on Ollama (needs Ollama running on this machine with at least one model).
// With AI off, the setup panel offers the models Ollama has; with AI_PROVIDER=ollama,
// a question gets a real answer from the local model.
//   node test/ai-ollama.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) => promise.then(() => true, () => false);
const { browser, errors, signIn } = await launch();
const { page } = await signIn("test1@codechatter.local");
const status = await (await page.request.get(`${BASE}/api/ai/status`)).json();
check("ollamaDetected", (status.ollama?.models ?? []).length > 0, JSON.stringify(status.ollama));

await page.getByRole("button", { name: "AI", exact: true }).click(); // the title bar toggle opens the side panel on AI
if (status.provider === "none") {
  const offer = page.getByText(/Ollama is running on this server with/);
  check("setupOffersLocalModels", await ok(offer.waitFor({ timeout: 15_000 })), (await offer.textContent().catch(() => "")) ?? "");
} else if (status.provider === "ollama") {
  check("configured", status.configured, status.problem ?? "");
  const input = page.getByRole("textbox", { name: "Message to the AI" });
  await input.fill("In one short sentence: what is a variable?");
  await input.press("Enter");
  // A local model on a CPU needs a while; the answer streams once it starts.
  const conversation = page.getByLabel("AI conversation");
  const answered = await ok(conversation.getByText(/\bvariable\b/i).nth(1).waitFor({ timeout: 180_000 }));
  const text = ((await conversation.textContent()) ?? "").replace(/\s+/g, " ");
  check("localModelAnswers", answered && !/Couldn't reach|doesn't have the model|failed/i.test(text), text.slice(-200));
} else {
  check("providerIsOllamaOrOff", false, `AI_PROVIDER is ${status.provider}`);
}

await page.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/ai-ollama.png` });
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
