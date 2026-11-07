// The AI gateway from inside a sandbox, for real, in E2ETST: a program calls the room's model at OPENAI_BASE_URL with no key, as an
// SDK would, and gets a real answer from whatever .env's AI is. It can't name another room, the door isn't a port to preview, and no
// key is anywhere in the sandbox's environment. Needs the sandbox images rebuilt with the current agent. The file is removed.
//   node --env-file=../../.env test/gateway.e2e.mjs        (from apps/runner, with the dev stack running and the AI set up)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 400)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function run(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(400_000),
  });
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    }
  }
  return output;
}

// All of it runs in the sandbox, with only what a program there has.
const PROBE = String.raw`
const base = process.env.OPENAI_BASE_URL;
const headers = { "content-type": "application/json", authorization: "Bearer " + process.env.OPENAI_API_KEY };
const call = async (path, body, extra = {}) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) } : { headers: { ...headers, ...extra } });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, text, json };
};
const out = { base, key: process.env.OPENAI_API_KEY };
// DATABASE_URL is the room's own Postgres, on purpose (databases.ts).
out.environment = Object.keys(process.env).filter((name) => /SECRET|ANTHROPIC|_TOKEN/.test(name));
const listed = await call("/models");
out.models = listed.json?.data?.map((model) => model.id) ?? listed.text;
const answer = await call("/chat/completions", { model: "default", messages: [{ role: "user", content: "Reply with only the word: ready" }], max_tokens: 30 });
out.answer = { status: answer.status, content: answer.json?.choices?.[0]?.message?.content ?? answer.text, usage: answer.json?.usage ?? null };
const stream = await call("/chat/completions", { model: "default", stream: true, messages: [{ role: "user", content: "Say hi." }], max_tokens: 20 });
const lines = stream.text.split("\n").filter((line) => line.startsWith("data: "));
out.stream = { status: stream.status, chunks: lines.length, ends: lines.at(-1), allHaveChoices: lines.slice(0, -1).every((line) => JSON.parse(line.slice(6)).choices?.length > 0) };
const unknown = await call("/chat/completions", { model: "gpt-very-expensive", messages: [{ role: "user", content: "Hi" }] });
out.unknown = { status: unknown.status, message: unknown.json?.error?.message };
const stored = await call("/chat/completions", { model: "default", messages: [], store: true });
out.empty = { status: stored.status, message: stored.json?.error?.message };
const other = await fetch("http://127.0.0.1:3129/internal/anything");
out.other = { status: other.status, message: (await other.json()).error?.message };
const forged = await call("/models", null, { authorization: "Bearer svc.forged.token", "x-room": "TEAM22" });
out.forged = { status: forged.status, ok: forged.json?.object === "list" };
console.log("RESULT " + JSON.stringify(out));
`;

const SDK_SCRIPT = `from openai import OpenAI

client = OpenAI()
print("models:", [model.id for model in client.models.list().data])
answer = client.chat.completions.create(model="default", messages=[{"role": "user", "content": "Reply with only the word: ready"}], max_tokens=20)
print("answer:", answer.choices[0].message.content, "| tokens:", answer.usage.prompt_tokens, answer.usage.completion_tokens)
words = []
for chunk in client.chat.completions.create(model="default", stream=True, messages=[{"role": "user", "content": "Count from 1 to 3."}], max_tokens=30):
    if chunk.choices and chunk.choices[0].delta.content:
        words.append(chunk.choices[0].delta.content)
print("stream:", "".join(words).strip()[:80].replace(chr(10), " "), "| pieces:", len(words))
try:
    client.chat.completions.create(model="gpt-very-expensive", messages=[{"role": "user", "content": "Hi"}])
except Exception as error:
    print("refused:", type(error).__name__, str(error)[:160])
`;

const path = `gw-${Date.now().toString(36)}.mjs`;
createFileAtPath(doc, path, PROBE, null);
await new Promise((resolve) => setTimeout(resolve, 1500));

try {
  const output = await run(path);
  const found = /RESULT (\{.*\})/.exec(output)?.[1];
  check("theProgramRan", Boolean(found), output.slice(0, 500));
  const out = JSON.parse(found ?? "{}");
  check("theAddressIsSet", out.base === "http://127.0.0.1:3129/v1", out.base);
  check("anSdkHasAKeyToShow", out.key === "not-needed-in-this-room", out.key);
  check("noServerSecretsInTheSandbox", out.environment?.length === 0, JSON.stringify(out.environment));
  check("itListsTheModels", Array.isArray(out.models) && out.models.length > 0, JSON.stringify(out.models));
  check("theModelAnswers", out.answer?.status === 200 && out.answer.content?.length > 0, JSON.stringify(out.answer));
  check("withItsTokens", out.answer?.usage?.prompt_tokens > 0, JSON.stringify(out.answer?.usage));
  check("itStreamsToTheEnd", out.stream?.status === 200 && out.stream.chunks > 2 && out.stream.ends === "data: [DONE]", JSON.stringify(out.stream));
  check("noChunkWithoutChoices", out.stream?.allHaveChoices === true, JSON.stringify(out.stream));
  check("aModelNotOnOfferIsRefused", out.unknown?.status === 404 && /doesn't offer the model/.test(out.unknown.message ?? ""), JSON.stringify(out.unknown));
  check("aBadRequestSaysWhy", out.empty?.status === 400 && /messages/.test(out.empty.message ?? ""), JSON.stringify(out.empty));
  check("onlyItsOwnRoutes", out.other?.status === 404 && /only has/.test(out.other.message ?? ""), JSON.stringify(out.other));
  check("whatTheCallerSendsDoesntMatter", out.forged?.ok === true, JSON.stringify(out.forged));

  // The door isn't a server to preview: the runner's tunnel to it is refused inside the sandbox.
  const preview = await fetch(`${RUNNER}/rooms/${ROOM}/preview/3129/v1/models`, { headers: { authorization: token() } }).catch(() => null);
  const body = preview ? await preview.text() : "";
  check("itCantBeReachedThroughAPreview", !body.includes('"object":"list"'), `${preview?.status} ${body.slice(0, 200)}`);

  // The real thing: OpenAI's own Python library, installed the way anyone would, with no settings of its own. It downloads, so only when asked.
  if (process.env.REAL_SDK) {
    const call = (method, what, data) => fetch(`${RUNNER}/rooms/${ROOM}/${what}`, { method, headers: { authorization: token(), "content-type": "application/json" }, ...(data && { body: JSON.stringify(data) }) });
    const script = `gw-${Date.now().toString(36)}-sdk.py`;
    const install = `gw-${Date.now().toString(36)}-sdk.sh`;
    createFileAtPath(doc, install, "pip install --quiet --disable-pip-version-check openai 2>&1 | tail -2; echo installed\n", null);
    createFileAtPath(doc, script, process.env.REAL_SDK_SCRIPT ?? SDK_SCRIPT, null);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await call("PUT", "sandbox/installs", { minutes: 5 });
    try {
      const installed = await run(install);
      check("theSdkInstalls", installed.includes("installed"), installed.slice(-300));
    } finally {
      await call("DELETE", "sandbox/installs");
    }
    const said = await run(script);
    console.log(said.trim().split("\n").map((line) => `      ${line}`).join("\n"));
    check("theSdkListsModels", /^models: \[/m.test(said), said.slice(0, 400));
    check("theSdkGetsAnAnswer", /^answer: .+ \| tokens: \d+ \d+/m.test(said), said.slice(0, 400));
    check("theSdkStreams", /^stream: .+ \| pieces: [2-9]/m.test(said), said.slice(0, 400));
    check("theSdkShowsARefusal", /^refused: NotFoundError .*doesn't offer the model/m.test(said), said.slice(0, 400));
    for (const name of [script, install]) {
      const node = findByPath(doc, name);
      if (node) trash(doc, node.id);
    }
  }
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  const node = findByPath(doc, path);
  if (node) trash(doc, node.id);
  await new Promise((resolve) => setTimeout(resolve, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
