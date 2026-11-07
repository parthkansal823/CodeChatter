// The Prompt Playground's server side, with a real API and a stand-in model, so the test can read exactly what the model was sent:
// the prompt as it's written with nothing of ours, the settings chosen, and who's refused.
//   node --env-file=../../.env test/prompts.e2e.mjs        (from apps/api, with the dev stack running and the dev watcher's dist built)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 4017;
const API = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:8080";
const ROOM = "E2ETST";
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).slice(0, 240)}` : ""}`);
};

// The stand-in model: writes a few words slowly enough to time, and remembers what it was asked.
const asked = [];
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const parsed = JSON.parse(body || "{}");
    asked.push(parsed);
    if (parsed.model === "breaks") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stand-in broke" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta, finish = null, usage) => res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage && { usage }) })}\n\n`);
    await sleep(120);
    chunk({ content: "Hello " });
    await sleep(120);
    chunk({ content: "there." });
    chunk({}, "stop");
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  env: { ...process.env, API_PORT: String(PORT), LOG_LEVEL: "warn", NODE_ENV: "test", APP_URL: ORIGIN, AI_PROVIDER: "openai", OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, OPENAI_API_KEY: "mock", AI_MODEL: "stand-in", AI_PLAYGROUND_MODELS: "second, breaks", AI_RATE_LIMIT: "12", AI_RATE_WINDOW_SECONDS: "600" },
  stdio: ["ignore", "ignore", "inherit"],
});
const stopAll = () => {
  child.kill();
  model.close();
};

async function ready() {
  for (let tries = 0; tries < 80; tries += 1) {
    if (child.exitCode !== null) throw new Error(`The API stopped (${child.exitCode}).`);
    const up = await fetch(`${API}/api/ai/status`).then((response) => response.status !== 502, () => false);
    if (up) return;
    await sleep(500);
  }
  throw new Error("The API didn't start.");
}

async function signIn(email) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: "codechatter123" }) });
  if (!response.ok) throw new Error(`Couldn't sign in ${email}: ${response.status}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

const headers = (cookie) => ({ "content-type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) });
const ask = (cookie, body, room = ROOM) => fetch(`${API}/api/rooms/${room}/ai/prompt`, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) });
const events = async (response) => (await response.text()).split("\n\n").flatMap((block) => (block.startsWith("data: ") ? [JSON.parse(block.slice(6))] : []));
const GOOD = { system: "Answer like a pirate.", messages: [{ role: "user", content: "Say hello." }], model: "stand-in" };

try {
  await ready();
  const owner = await signIn("test1@codechatter.local");

  // Who may.
  check("signedOutCantAsk", (await ask(null, GOOD)).status === 401);
  check("signedOutCantList", (await fetch(`${API}/api/rooms/${ROOM}/ai/models`)).status === 401);
  check("aRoomYoureNotInIsRefused", [403, 404].includes((await ask(owner, GOOD, "ZZZZZZ")).status));

  // What's on offer.
  const offered = await (await fetch(`${API}/api/rooms/${ROOM}/ai/models`, { headers: headers(owner) })).json();
  check("itOffersWhatTheOwnerNamed", JSON.stringify(offered.models) === JSON.stringify(["stand-in", "second", "breaks"]), JSON.stringify(offered));
  check("itsOwnModelIsTheDefault", offered.default === "stand-in");
  check("settingsAreAvailable", offered.temperature === true && offered.json === true);
  check("columnsCanRunTogether", offered.oneAtATime === false);
  check("noKeyInWhatItOffers", !JSON.stringify(offered).includes("mock"));

  // An answer.
  const answer = await ask(owner, GOOD);
  const seen = await events(answer);
  const sent = asked.at(-1);
  check("itStreams", answer.status === 200 && seen.filter((event) => event.type === "delta").map((event) => event.text).join("") === "Hello there.", JSON.stringify(seen));
  const done = seen.find((event) => event.type === "done");
  check("itSaysHowLongItTook", done?.timing?.firstMs >= 100 && done.timing.totalMs >= done.timing.firstMs + 100, JSON.stringify(done));
  check("itSaysTheTokens", done?.usage?.outputTokens > 0 && done.usage.estimated === true, JSON.stringify(done));

  // What the model was sent: this, and nothing of ours.
  check("theSystemPromptIsYours", sent.messages[0].role === "system" && sent.messages[0].content === GOOD.system, JSON.stringify(sent.messages));
  check("nothingOfOursGoesWithIt", sent.messages.length === 2 && sent.messages[1].content === "Say hello." && !JSON.stringify(sent).includes("CodeChatter"), JSON.stringify(sent.messages));
  check("noSettingsYouDidntChoose", sent.temperature === undefined && sent.max_tokens === undefined && sent.response_format === undefined, JSON.stringify(sent));

  // The choices.
  await events(await ask(owner, { ...GOOD, model: "second", temperature: 0.2, maxTokens: 50, json: true }));
  const tuned = asked.at(-1);
  check("theColumnsModelIsUsed", tuned.model === "second");
  check("itsSettingsToo", tuned.temperature === 0.2 && tuned.max_tokens === 50 && tuned.response_format?.type === "json_object", JSON.stringify(tuned));
  await events(await ask(owner, { ...GOOD, temperature: 0 }));
  check("aTemperatureOfNoneIsStillSent", asked.at(-1).temperature === 0);

  await events(await ask(owner, { system: "", messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "More" }], model: "stand-in" }));
  const turns = asked.at(-1).messages;
  check("noEmptySystemPromptIsSent", turns[0].role === "user", JSON.stringify(turns));
  check("aConversationGoesInOrder", turns.map((turn) => turn.role).join() === "user,assistant,user");

  // Refused before anything reaches the model.
  let before = asked.length;
  const unknown = await ask(owner, { ...GOOD, model: "gpt-very-expensive" });
  check("aModelNotOnOfferIsRefused", unknown.status === 400 && asked.length === before, unknown.status);
  check("theReasonNamesIt", /gpt-very-expensive/.test((await unknown.json()).detail ?? ""));
  for (const [name, bad] of [
    ["noUserMessage", { ...GOOD, messages: [{ role: "assistant", content: "Hi" }] }],
    ["aSystemRoleInTheMessages", { ...GOOD, messages: [{ role: "system", content: "Hi" }] }],
    ["aTemperatureOutOfRange", { ...GOOD, temperature: 9 }],
    ["tooManyTokens", { ...GOOD, maxTokens: 1_000_000 }],
  ]) {
    before = asked.length;
    check(`${name}IsRefused`, (await ask(owner, bad)).status === 400 && asked.length === before);
  }

  // A model that fails says so, in words someone can act on, with no key.
  const failing = await events(await ask(owner, { ...GOOD, model: "breaks" }));
  const failure = failing.find((event) => event.type === "error");
  check("aFailureIsReported", Boolean(failure?.message), JSON.stringify(failing));
  check("withoutTheKey", !JSON.stringify(failing).includes("mock"));

  // Each column counts against the person's limit: the limit here is 12, and so far 9 reached the provider or failed there.
  let limited = null;
  for (let tries = 0; tries < 12 && !limited; tries += 1) {
    const response = await ask(owner, GOOD);
    if (response.status === 429) limited = response;
    else await response.text();
  }
  check("itCountsAgainstTheLimit", limited?.status === 429);
  check("andSaysWhenToTryAgain", Number(limited?.headers.get("retry-after")) > 0);
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  stopAll();
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
