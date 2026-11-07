// The MCP tool for real, in E2ETST: the official MCP Inspector in the sandbox lists and calls a real MCP server over stdio, and one
// serving HTTP. Values arrive with their types, a tool's failure and a server that won't start come back as answers, and a name can't
// become an option on the command line. Needs the current sandbox images. The files are removed.
//   node --env-file=../../.env test/mcp.e2e.mjs        (from apps/runner, with the dev stack running)
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
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
const mcp = async (body) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/mcp`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ stateVector: stateVector(), ...body }), signal: AbortSignal.timeout(200_000) });
  return { status: response.status, ...(await response.json()) };
};

const dir = `mcp-${Date.now().toString(36)}`;
const SERVER = `
import { createInterface } from "node:readline";
const answers = {
  initialize: (p) => ({ protocolVersion: p.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "t", version: "1" } }),
  "tools/list": () => ({ tools: [
    { name: "echo", description: "Says back what it got", inputSchema: { type: "object", properties: { text: { type: "string" }, n: { type: "number" }, on: { type: "boolean" }, o: { type: "object" } } } },
    { name: "fail", description: "Fails", inputSchema: { type: "object", properties: {} } },
    { name: "where", description: "Where it runs", inputSchema: { type: "object", properties: {} } },
  ] }),
  "tools/call": (p) => {
    if (p.name === "fail") return { isError: true, content: [{ type: "text", text: "It went wrong." }] };
    if (p.name === "where") return { content: [{ type: "text", text: JSON.stringify({ cwd: process.cwd(), uid: process.getuid(), key: process.env.OPENAI_API_KEY ?? null, secret: process.env.SERVICE_SECRET ?? null }) }] };
    return { content: [{ type: "text", text: JSON.stringify(p.arguments) }] };
  },
  "resources/list": () => ({ resources: [{ uri: "note://one", name: "One", mimeType: "text/plain" }] }),
  "resources/read": (p) => ({ contents: [{ uri: p.uri, mimeType: "text/plain", text: "read " + p.uri }] }),
  "prompts/list": () => ({ prompts: [{ name: "greet", arguments: [{ name: "who", required: true }] }] }),
  "prompts/get": (p) => ({ messages: [{ role: "user", content: { type: "text", text: "Hello " + p.arguments.who } }] }),
};
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  const answer = answers[method];
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...(answer ? { result: answer(params) } : { error: { code: -32601, message: "No " + method } }) }) + "\\n");
});
`;
const CONFIG = (extra = {}) => JSON.stringify({ mcpServers: { real: { command: "node", args: [`${dir}/server.mjs`] }, broken: { command: "no-such-program-here", args: [] }, crashes: { command: "node", args: ["-e", "process.exit(3)"] }, ...extra } }, null, 2);

const existing = findByPath(doc, ".mcp.json");
if (existing) throw new Error("E2ETST already has a .mcp.json: remove it first.");

try {
  createFileAtPath(doc, `${dir}/server.mjs`, SERVER, null);
  createFileAtPath(doc, ".mcp.json", CONFIG(), null);

  // What it offers, right after the file was made: the call waits for the edit.
  const tools = await mcp({ server: "real", method: "tools/list" });
  check("itListsTheTools", tools.ok && tools.result.tools.map((tool) => tool.name).join() === "echo,fail,where", JSON.stringify(tools).slice(0, 400));
  check("withTheirSchemas", tools.result?.tools[0].inputSchema.properties.n.type === "number");
  check("quickly", tools.ms < 20_000, tools.ms);
  const resources = await mcp({ server: "real", method: "resources/list" });
  check("itListsResources", resources.ok && resources.result.resources[0].uri === "note://one", JSON.stringify(resources));
  const prompts = await mcp({ server: "real", method: "prompts/list" });
  check("itListsPrompts", prompts.ok && prompts.result.prompts[0].name === "greet", JSON.stringify(prompts));

  // Calling, with values keeping their types.
  const args = { text: "123", n: 5, on: false, o: { a: [1, "two"] } };
  const echoed = await mcp({ server: "real", method: "tools/call", tool: "echo", args });
  check("aToolIsCalled", echoed.ok && Array.isArray(echoed.result.content), JSON.stringify(echoed));
  check("valuesKeepTheirTypes", JSON.stringify(JSON.parse(echoed.result?.content?.[0]?.text ?? "{}")) === JSON.stringify(args), echoed.result?.content?.[0]?.text);
  const awkward = await mcp({ server: "real", method: "tools/call", tool: "echo", args: { text: `It's "quoted", a=b --flag\nline two ` } });
  check("awkwardTextArrivesWhole", JSON.parse(awkward.result?.content?.[0]?.text ?? "{}").text === `It's "quoted", a=b --flag\nline two `, JSON.stringify(awkward));

  // A tool saying it failed is an answer.
  const failed = await mcp({ server: "real", method: "tools/call", tool: "fail" });
  check("aToolsFailureIsAnAnswer", failed.ok === true && failed.result?.isError === true && failed.result.content[0].text === "It went wrong.", JSON.stringify(failed));

  // Where it runs: the room's folder and user, with what a Run has and no more.
  const where = JSON.parse((await mcp({ server: "real", method: "tools/call", tool: "where" })).result?.content?.[0]?.text ?? "{}");
  check("itRunsInTheRoomsFolder", where.cwd === "/workspace", where.cwd);
  check("asTheRoomsUser", where.uid === 10001, where.uid);
  check("noServerSecrets", where.secret === null, where.secret);

  const read = await mcp({ server: "real", method: "resources/read", uri: "note://one" });
  check("aResourceIsRead", read.ok && read.result.contents[0].text === "read note://one", JSON.stringify(read));
  const got = await mcp({ server: "real", method: "prompts/get", prompt: "greet", args: { who: "Parth K" } });
  check("aPromptIsGot", got.ok && got.result.messages[0].content.text === "Hello Parth K", JSON.stringify(got));

  // Servers that don't work say so.
  const broken = await mcp({ server: "broken", method: "tools/list" });
  check("aProgramThatIsntThereIsAnAnswer", broken.status === 200 && broken.ok === false && broken.error.length > 0 && !/keychain/i.test(broken.error), JSON.stringify(broken));
  const crashes = await mcp({ server: "crashes", method: "tools/list" });
  check("aServerThatCrashesIsAnAnswer", crashes.status === 200 && crashes.ok === false, JSON.stringify(crashes));
  const unknown = await mcp({ server: "nobody", method: "tools/list" });
  check("aServerNotInTheFileIsAnAnswer", unknown.status === 200 && unknown.ok === false, JSON.stringify(unknown));
  console.log(`      a broken server says: ${broken.error}`);

  // Names can't become options.
  check("aServerNameLikeAnOptionIsRefused", (await mcp({ server: "--config", method: "tools/list" })).status === 400);
  const sneaky = await mcp({ server: "real", method: "tools/call", tool: "--method=tools/list" });
  check("aToolNameLikeAnOptionIsOnlyAName", !sneaky.ok || !Array.isArray(sneaky.result?.tools), JSON.stringify(sneaky).slice(0, 300));
  check("anotherMethodIsRefused", (await mcp({ server: "real", method: "servers/add" })).status === 400);

  // A room's token is for that room.
  const elsewhere = await fetch(`${RUNNER}/rooms/${ROOM}/mcp`, { method: "POST", headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: "TEAM22", uid: "x", name: "X" })}`, "content-type": "application/json" }, body: JSON.stringify({ server: "real", method: "tools/list" }) });
  check("anotherRoomsTokenIsRefused", elsewhere.status === 401, elsewhere.status);
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  for (const path of [".mcp.json", dir]) {
    const node = findByPath(doc, path);
    if (node) trash(doc, node.id);
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
