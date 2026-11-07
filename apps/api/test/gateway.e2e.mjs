// The AI gateway's API side, with a real API and a stand-in model, so the test can read exactly what the provider was sent and say
// what a provider would say back: only our own services get in, only what's allowed goes out, no key comes back, and the rooms
// that shouldn't use it can't. (apps/runner/test/gateway.e2e.mjs is the whole way, from inside a sandbox, with the real model.)
//   node --env-file=../../.env test/gateway.e2e.mjs        (from apps/api, with the dev stack running and the dev watcher's dist built)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createDb, schema } from "@codechatter/db";
import { eq, inArray } from "drizzle-orm";

const PORT = 4018;
const API = `http://127.0.0.1:${PORT}`;
const GATEWAY = `${API}/api/internal/ai-gateway/v1`;
const SECRET = process.env.SERVICE_SECRET;
const KEY = "sk-the-servers-own-key-do-not-show";
const stamp = Date.now().toString(36).slice(-5).toUpperCase().padStart(5, "0");
const INTERVIEW = `I${stamp}`;
const GUEST = `G${stamp}`;
const ARCHIVED = `A${stamp}`;
const LIMITED = `L${stamp}`;
// A room of its own, so that running this twice in ten minutes doesn't run into the limit it tests.
const NORMAL = `N${stamp}`;
let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).slice(0, 300)}` : ""}`);
};

// The stand-in provider: remembers what it was sent and the key it was sent with, and answers as it's told by the model's name.
const asked = [];
const model = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const parsed = JSON.parse(body || "{}");
    asked.push({ path: req.url, authorization: req.headers.authorization, body: parsed });
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (parsed.model === "says-bad-key") return json(401, { error: { message: `Incorrect API key provided: ${KEY}` } });
    if (parsed.model === "echoes-key") return json(400, { error: { message: `Something about ${KEY} here` } });
    if (parsed.model === "slow-down") {
      res.setHeader("retry-after", "7");
      return json(429, { error: { message: "Slow down" } });
    }
    if (req.url.endsWith("/embeddings")) return json(200, { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }], model: parsed.model, usage: { prompt_tokens: 3, total_tokens: 3 } });
    if (!parsed.stream) return json(200, { id: "1", object: "chat.completion", model: parsed.model, choices: [{ index: 0, message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (value) => res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", model: parsed.model, ...value })}\n\n`);
    chunk({ choices: [{ index: 0, delta: { role: "assistant", content: "Hello " }, finish_reason: null }] });
    await sleep(50);
    chunk({ choices: [{ index: 0, delta: { content: "there." }, finish_reason: "stop" }] });
    chunk({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  env: { ...process.env, API_PORT: String(PORT), LOG_LEVEL: "error", NODE_ENV: "test", AI_PROVIDER: "openai", OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, OPENAI_API_KEY: KEY, AI_MODEL: "stand-in", AI_PLAYGROUND_MODELS: "says-bad-key,echoes-key,slow-down", AI_GATEWAY_RATE_LIMIT: "30", AI_RATE_WINDOW_SECONDS: "600" },
  stdio: ["ignore", "ignore", "inherit"],
});

const as = (room, audience = "api") => ({ authorization: `Bearer ${signServiceToken(SECRET, { aud: audience, sub: room })}`, "content-type": "application/json" });
const post = (room, path, body) => fetch(`${GATEWAY}${path}`, { method: "POST", headers: as(room), body: JSON.stringify(body) });
const chat = (room, body = {}) => post(room, "/chat/completions", { model: "stand-in", messages: [{ role: "user", content: "Hi" }], ...body });
const read = async (response) => {
  const text = await response.text();
  try {
    return { status: response.status, text, json: JSON.parse(text) };
  } catch {
    return { status: response.status, text, json: null };
  }
};

const database = createDb(process.env.DATABASE_URL, { max: 2 });
const db = database.db;
const guestId = `gw-guest-${stamp}`;

try {
  for (let tries = 0; ; tries += 1) {
    if (await fetch(`${API}/api/healthz`, { signal: AbortSignal.timeout(1000) }).then((res) => res.ok, () => false)) break;
    if (tries > 40) throw new Error(`The test API didn't start: is the API built, and :${PORT} free?`);
    await sleep(750);
  }
  const [base] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, "E2ETST"));
  const { GUEST_DOMAIN } = await import("../dist/demo/guest-domain.js");
  await db.insert(schema.user).values({ id: guestId, name: "Guest", email: `guest-${stamp.toLowerCase()}@${GUEST_DOMAIN}` });
  const room = (id, over = {}) => ({ id, orgId: base.orgId, name: `Gateway test ${id}`, createdBy: base.createdBy, ...over });
  await db.insert(schema.rooms).values([room(NORMAL), room(LIMITED), room(INTERVIEW, { kind: "interview" }), room(ARCHIVED, { archivedAt: new Date() }), room(GUEST, { createdBy: guestId })]);

  // Only our own services get in.
  const body = JSON.stringify({ model: "stand-in", messages: [{ role: "user", content: "Hi" }] });
  const before = asked.length;
  const tries = [
    ["noToken", {}],
    ["aForgedOne", { authorization: "Bearer svc.e30.abc" }],
    ["aSessionlessGuess", { authorization: `Bearer ${KEY}` }],
    ["aTokenForAnotherService", as(NORMAL, "runner")],
    ["anExpiredOne", { authorization: `Bearer ${signServiceToken(SECRET, { aud: "api", sub: NORMAL }, -5)}` }],
  ];
  for (const [name, headers] of tries) {
    const refused = await fetch(`${GATEWAY}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    check(`${name}IsRefused`, refused.status === 401, refused.status);
  }
  check("noneOfThemReachedTheModel", asked.length === before);

  // An answer, as an SDK expects it.
  const answer = await read(await chat(NORMAL, { store: true, service_tier: "priority", metadata: { a: 1 }, temperature: 0.4, max_tokens: 9 }));
  check("itAnswers", answer.status === 200 && answer.json?.choices?.[0]?.message?.content === "Hello there.", answer.text);
  const sent = asked.at(-1);
  check("theProviderGetsTheServersKey", sent.authorization === `Bearer ${KEY}`);
  check("whatTheCodeChoseGoes", sent.body.temperature === 0.4 && sent.body.max_tokens === 9);
  check("whatCouldChangeTheBillDoesnt", !("store" in sent.body) && !("service_tier" in sent.body) && !("metadata" in sent.body), JSON.stringify(sent.body));
  check("noKeyComesBack", !answer.text.includes(KEY));
  await read(await chat(NORMAL, { model: "default" }));
  check("defaultMeansTheServersModel", asked.at(-1).body.model === "stand-in");

  // Models.
  const models = await read(await fetch(`${GATEWAY}/models`, { headers: as(NORMAL) }));
  check("itListsWhatsOnOffer", models.json?.object === "list" && models.json.data.map((item) => item.id).includes("stand-in"), models.text);
  const atBefore = asked.length;
  const unknown = await read(await chat(NORMAL, { model: "gpt-very-expensive" }));
  check("aModelNotOnOfferIsRefused", unknown.status === 404 && unknown.json?.error?.code === "model_not_found" && asked.length === atBefore, unknown.text);

  // Streams, with the usage chunk only for code that asked for it.
  const quiet = await read(await chat(NORMAL, { stream: true }));
  check("aStreamComesThrough", quiet.status === 200 && quiet.text.includes("Hello ") && quiet.text.includes("there.") && quiet.text.trim().endsWith("data: [DONE]"), quiet.text);
  check("noUsageChunkUnasked", !quiet.text.includes('"usage"'), quiet.text);
  // A provider that isn't OpenAI or Ollama isn't asked to report it: it may not know the option.
  check("aCompatibleServerIsntAskedForIt", !("stream_options" in asked.at(-1).body), JSON.stringify(asked.at(-1).body));
  const told = await read(await chat(NORMAL, { stream: true, stream_options: { include_usage: true } }));
  check("usageWhenAsked", told.text.includes('"usage"'), told.text);

  // Embeddings.
  const embedded = await read(await post(NORMAL, "/embeddings", { model: "stand-in", input: ["a", "b"], store: true }));
  check("embeddingsWork", embedded.status === 200 && embedded.json?.data?.[0]?.embedding?.length === 2 && asked.at(-1).path === "/v1/embeddings", embedded.text);
  check("withOnlyWhatsAllowed", !("store" in asked.at(-1).body));

  // A provider's refusals: useful, and never the key.
  const badKey = await read(await chat(NORMAL, { model: "says-bad-key" }));
  check("aRefusedKeyIsTheServersProblem", badKey.status === 502 && /server's key/.test(badKey.json?.error?.message ?? ""), badKey.text);
  check("andDoesntShowIt", !badKey.text.includes(KEY));
  const echoed = await read(await chat(NORMAL, { model: "echoes-key" }));
  check("aProviderEchoingTheKeyIsCleaned", echoed.status === 400 && !echoed.text.includes(KEY) && echoed.text.includes("[key]"), echoed.text);
  const slow = await chat(NORMAL, { model: "slow-down" });
  check("aProvidersLimitPassesOn", slow.status === 429 && slow.headers.get("retry-after") === "7");

  // Rooms that shouldn't.
  const refusedIn = async (name, id, pattern, status = 403) => {
    const at = asked.length;
    const refused = await read(await chat(id));
    check(`${name}IsRefused`, refused.status === status && pattern.test(refused.json?.error?.message ?? "") && asked.length === at, refused.text);
  };
  await refusedIn("anInterview", INTERVIEW, /off during this interview/);
  await refusedIn("aDemoRoom", GUEST, /Demo rooms/);
  await refusedIn("anArchivedRoom", ARCHIVED, /doesn't exist/, 404);
  await refusedIn("aRoomThatDoesntExist", "ZZZZZZ", /doesn't exist/, 404);

  // A loop in someone's code stops, in that room only.
  let limited = null;
  for (let index = 0; index < 40 && !limited; index += 1) {
    const real = await chat(LIMITED);
    if (real.status === 429) limited = real;
    else await real.text();
  }
  check("aLoopIsStopped", limited?.status === 429 && Number(limited.headers.get("retry-after")) > 0);
  check("withAReasonAnSdkShows", (await read(limited)).json?.error?.type === "rate_limit_error");
  const elsewhere = await chat(NORMAL);
  check("otherRoomsCarryOn", elsewhere.status === 200, elsewhere.status);
  await elsewhere.text();
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  await db.delete(schema.rooms).where(inArray(schema.rooms.id, [NORMAL, INTERVIEW, GUEST, ARCHIVED, LIMITED])).catch(() => {});
  await db.delete(schema.user).where(eq(schema.user.id, guestId)).catch(() => {});
  await database.close?.().catch?.(() => {});
  child.kill();
  model.close();
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
