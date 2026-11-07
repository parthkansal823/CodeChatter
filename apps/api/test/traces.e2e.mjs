// The Traces view's server side, with a real API, a stand-in model and a stand-in tracing tool. Each kind of call is kept with its
// tokens and time, secrets don't survive, someone's conversation stays theirs even after they've left, code in the room is readable
// by those who can run it, and spans go on to a tracing tool without prompts unless it's asked for. Its rows are removed at the end.
//   node --env-file=../../.env test/traces.e2e.mjs        (from apps/api, with the dev stack running and the dev watcher's dist built)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createDb, schema } from "@codechatter/db";
import { and, eq, gte } from "drizzle-orm";

const PORT = 4019;
const API = `http://127.0.0.1:${PORT}`;
const ORIGIN = "http://localhost:8080";
const ROOM = "E2ETST";
const SECRET_IN_PROMPT = "AKIAIOSFODNN7EXAMPLE";
const SECRET = process.env.SERVICE_SECRET;
const started = new Date();
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).slice(0, 400)}` : ""}`);
};

const model = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const asked = JSON.parse(body || "{}");
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (asked.model === "breaks") return json(500, { error: { message: "stand-in broke" } });
    if (req.url.endsWith("/embeddings")) return json(200, { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1] }], model: asked.model, usage: { prompt_tokens: 3, total_tokens: 3 } });
    if (!asked.stream) return json(200, { id: "1", object: "chat.completion", model: asked.model, choices: [{ index: 0, message: { role: "assistant", content: "A plain answer." }, finish_reason: "stop" }], usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 } });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (value) => res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", model: asked.model, ...value })}\n\n`);
    await sleep(120);
    chunk({ choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }] });
    await sleep(120);
    chunk({ choices: [{ index: 0, delta: { content: `there, ${SECRET_IN_PROMPT}.` }, finish_reason: "stop" }] });
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const spans = [];
const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url === "/v1/traces") spans.push(...JSON.parse(body).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((resolve) => collector.listen(0, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  env: { ...process.env, API_PORT: String(PORT), LOG_LEVEL: "error", NODE_ENV: "test", APP_URL: ORIGIN, AI_PROVIDER: "openai", OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, OPENAI_API_KEY: "mock", AI_MODEL: "stand-in", AI_PLAYGROUND_MODELS: "breaks", AI_RATE_LIMIT: "500", AI_GATEWAY_RATE_LIMIT: "500", AI_TRACES_OTLP_URL: `http://127.0.0.1:${collector.address().port}` },
  stdio: ["ignore", "ignore", "inherit"],
});

async function signIn(email) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email, password: "codechatter123" }) });
  if (!response.ok) throw new Error(`Couldn't sign in ${email}: ${response.status}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}
const headers = (cookie) => ({ "content-type": "application/json", origin: ORIGIN, ...(cookie && { cookie }) });
const list = async (cookie, room = ROOM) => {
  const response = await fetch(`${API}/api/rooms/${room}/ai/traces`, { headers: headers(cookie) });
  return { status: response.status, rows: response.ok ? await response.json() : [] };
};
const finished = async (response) => {
  await response.text();
  await sleep(250);
};
const newest = (rows, source) => rows.find((row) => row.source === source);

const database = createDb(process.env.DATABASE_URL, { max: 2 });
try {
  for (let tries = 0; ; tries += 1) {
    if (await fetch(`${API}/api/healthz`, { signal: AbortSignal.timeout(1000) }).then((res) => res.ok, () => false)) break;
    if (tries > 40) throw new Error(`The test API didn't start: is the API built, and :${PORT} free?`);
    await sleep(750);
  }
  const one = await signIn("test1@codechatter.local");
  const two = await signIn("test2@codechatter.local");

  check("signedOutCantRead", (await list(null)).status === 401);
  check("aRoomYoureNotInIsRefused", [403, 404].includes((await list(one, "ZZZZZZ")).status));

  // From the AI panel.
  await finished(await fetch(`${API}/api/rooms/${ROOM}/ai/chat`, { method: "POST", headers: headers(one), body: JSON.stringify({ mode: "tutor", messages: [{ role: "user", content: `My key is ${SECRET_IN_PROMPT}, how do I hide it?` }], context: { runOutput: false } }) }));
  const mine = (await list(one)).rows;
  const chat = newest(mine, "chat");
  check("aChatCallIsKept", chat?.model === "stand-in" && chat.mode === "tutor" && chat.status === "ok", JSON.stringify(chat));
  check("withItsTimes", chat?.firstMs >= 100 && chat.totalMs >= chat.firstMs + 100, JSON.stringify(chat));
  check("andTokens", chat?.outputTokens > 0 && chat.estimated === true, JSON.stringify(chat));
  check("whatWasAskedIsThere", chat?.input.at(-1).content.includes("how do I hide it?"), JSON.stringify(chat?.input));
  check("itsOurSystemPromptToo", chat?.input[0].role === "system");
  check("whatCameBackIsThere", chat?.output.startsWith("Hello there"), chat?.output);
  check("noSecretSurvivesEitherWay", !JSON.stringify(chat).includes(SECRET_IN_PROMPT), JSON.stringify(chat).slice(0, 300));

  // Someone's conversation is theirs.
  const theirView = newest((await list(two)).rows, "chat");
  check("othersSeeThatItHappened", theirView?.id === chat?.id && theirView.outputTokens === chat.outputTokens && theirView.by, JSON.stringify(theirView));
  check("butNotWhatWasSaid", theirView?.input === null && theirView.output === null && theirView.hidden === true, JSON.stringify(theirView));
  check("andItsNotMarkedTheirs", theirView?.mine === false && chat?.mine === true);

  // Leaving doesn't hand it to the room: deleting an account empties the column, as if it were code.
  const [gone] = await database.db.insert(schema.aiTraces).values({ roomId: ROOM, userId: null, source: "chat", mode: "assistant", model: "stand-in", status: "ok", inputTokens: 1, outputTokens: 1, totalMs: 1, input: [{ role: "user", content: "PRIVATE-WORDS" }], output: "PRIVATE-REPLY" }).returning();
  const left = (await list(two)).rows.find((row) => row.id === gone.id);
  check("someoneWhoLeftStaysPrivate", left?.input === null && left.output === null && left.hidden === true && left.by === "Someone who has left", JSON.stringify(left));
  const leftForOwner = (await list(one)).rows.find((row) => row.id === gone.id);
  check("evenFromTheOwner", leftForOwner?.input === null && !JSON.stringify(leftForOwner).includes("PRIVATE"), JSON.stringify(leftForOwner));

  // From the Playground, with what the column chose.
  await finished(await fetch(`${API}/api/rooms/${ROOM}/ai/prompt`, { method: "POST", headers: headers(one), body: JSON.stringify({ system: "Be brief.", messages: [{ role: "user", content: "Say hello." }], model: "stand-in" }) }));
  const prompt = newest((await list(one)).rows, "prompt");
  check("aPlaygroundCallIsKept", prompt?.input[0].content === "Be brief." && prompt.input[1].content === "Say hello.", JSON.stringify(prompt));

  // A failure says so.
  await finished(await fetch(`${API}/api/rooms/${ROOM}/ai/prompt`, { method: "POST", headers: headers(one), body: JSON.stringify({ messages: [{ role: "user", content: "Say hello." }], model: "breaks" }) }));
  const broke = newest((await list(one)).rows, "prompt");
  check("aFailureIsKept", broke?.status === "error" && broke.model === "breaks" && broke.error?.length > 0, JSON.stringify(broke));
  const brokeForOther = newest((await list(two)).rows, "prompt");
  check("andWhatItSaidIsTheirsToo", brokeForOther?.status === "error" && brokeForOther.error === "It failed.", JSON.stringify(brokeForOther));

  // From code in the sandbox.
  const asRoom = { authorization: `Bearer ${signServiceToken(SECRET, { aud: "api", sub: ROOM })}`, "content-type": "application/json" };
  await finished(await fetch(`${API}/api/internal/ai-gateway/v1/chat/completions`, { method: "POST", headers: asRoom, body: JSON.stringify({ model: "default", messages: [{ role: "user", content: [{ type: "text", text: "From code." }, { type: "image_url", image_url: { url: "data:image/png;base64,IMAGEDATA" } }] }] }) }));
  const code = newest((await list(one)).rows, "gateway");
  check("aCallFromCodeIsKept", code?.by === null && code.output === "A plain answer." && code.inputTokens === 6 && code.outputTokens === 4 && code.estimated === false, JSON.stringify(code));
  check("whoeverCanRunCodeCanReadIt", newest((await list(two)).rows, "gateway")?.output === "A plain answer.");
  check("withoutAnImagesData", !JSON.stringify(code).includes("IMAGEDATA") && code?.input[0].content.includes("From code."), JSON.stringify(code?.input));
  await finished(await fetch(`${API}/api/internal/ai-gateway/v1/chat/completions`, { method: "POST", headers: asRoom, body: JSON.stringify({ model: "default", stream: true, messages: [{ role: "user", content: "Stream." }] }) }));
  const streamed = newest((await list(one)).rows, "gateway");
  check("aStreamFromCodeIsTimed", streamed?.firstMs >= 100 && streamed.output.startsWith("Hello there"), JSON.stringify(streamed));
  await finished(await fetch(`${API}/api/internal/ai-gateway/v1/embeddings`, { method: "POST", headers: asRoom, body: JSON.stringify({ model: "default", input: ["A whole file of code", "another"] }) }));
  const embedded = newest((await list(one)).rows, "embedding");
  check("embeddingsAreCountedNotKept", embedded?.inputTokens === 3 && embedded.input[0].content === "2 texts to embed" && !JSON.stringify(embedded).includes("whole file"), JSON.stringify(embedded));

  // On to a tracing tool: what it cost, not what was said.
  await sleep(500);
  const sent = spans.at(-1);
  const attributes = Object.fromEntries((sent?.attributes ?? []).map((item) => [item.key, Object.values(item.value)[0]]));
  check("spansGoOnToATracingTool", spans.length >= 5, spans.length);
  check("inOpenTelemetrysTerms", attributes["gen_ai.request.model"] === "stand-in" && attributes["gen_ai.operation.name"] === "embeddings" && attributes["codechatter.room"] === ROOM, JSON.stringify(attributes));
  check("withoutWhatWasSaid", !JSON.stringify(spans).includes("how do I hide it") && !JSON.stringify(spans).includes("Be brief") && !JSON.stringify(spans).includes(SECRET_IN_PROMPT));
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  await database.db.delete(schema.aiTraces).where(and(eq(schema.aiTraces.roomId, ROOM), gte(schema.aiTraces.createdAt, started))).catch(() => {});
  await database.close?.();
  child.kill();
  model.close();
  collector.close();
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
