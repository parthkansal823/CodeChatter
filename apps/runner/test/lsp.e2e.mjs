// IntelliSense from a language server in the sandbox (roadmap §14 A): Pyright over the runner's WebSocket,
// one JSON-RPC message per text frame as the browser's language client sends them. It starts, reports a
// type error in an open file, completes `math.`, explains a function on hover, finds its definition (in
// another file of the room, read from the sandbox's /workspace), and ends when the socket closes.
//   node --env-file=../../.env test/lsp.e2e.mjs      (from apps/runner, with `pnpm dev` running)
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
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}` });

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const dir = `lsp-${Date.now().toString(36)}`;
const APP = `from shapes import area\nimport math\n\nx: int = "not a number"\nprint(area(2), math.)\n`;
createFileAtPath(doc, `${dir}/shapes.py`, "import math\n\n\ndef area(radius: float) -> float:\n    \"\"\"The area of a circle.\"\"\"\n    return math.pi * radius**2\n", null);
createFileAtPath(doc, `${dir}/app.py`, APP, null);
const uri = `file:///workspace/${dir}/app.py`;

/** A JSON-RPC connection over the runner's socket. */
function connect(language = "python") {
  const ws = new WebSocket(`${RUNNER.replace(/^http/, "ws")}/rooms/${ROOM}/lsp?language=${language}`, { headers: headers() });
  let next = 1;
  const pending = new Map();
  const notes = [];
  const waiters = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    if (process.env.LSP_DEBUG) console.log("  <-", JSON.stringify(message).slice(0, 200));
    if (message.id !== undefined && pending.has(message.id) && !message.method) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.id !== undefined && message.method) {
      // A request from the server (configuration, capabilities): answer as a client would.
      const result = message.method === "workspace/configuration" ? message.params.items.map(() => null) : null;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    } else {
      notes.push(message);
      for (const waiter of waiters.splice(0)) waiter();
    }
  });
  return {
    ws,
    opened: new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    }),
    request(method, params, timeout = 60_000) {
      const id = next++;
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(() => reject(new Error(`${method} timed out`)), timeout);
      });
    },
    notify(method, params) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    },
    async note(test, timeout = 60_000) {
      const until = Date.now() + timeout;
      for (;;) {
        const found = notes.find(test);
        if (found) return found;
        if (Date.now() > until) return null;
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 500);
        });
      }
    },
  };
}

async function pyrightProcesses() {
  // A Run in the sandbox counts them (the jail still sees the container's processes).
  createFileAtPath(doc, `${dir}/count.sh`, "pgrep -fc pyright-langserver || true\n", null);
  await sleep(1000);
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ path: `${dir}/count.sh`, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }),
    signal: AbortSignal.timeout(60_000),
  });
  let out = "";
  for await (const chunk of response.body) out += Buffer.from(chunk).toString();
  const printed = out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((e) => e.type === "output")
    .map((e) => e.data)
    .join("");
  return Number(/\d+/.exec(printed)?.[0] ?? NaN);
}

let client;
try {
  const refused = new WebSocket(`${RUNNER.replace(/^http/, "ws")}/rooms/${ROOM}/lsp?language=python`);
  const status = await new Promise((resolve) => {
    refused.once("unexpected-response", (_req, res) => resolve(res.statusCode));
    refused.once("open", () => resolve("open"));
    refused.once("error", () => resolve("error"));
  });
  record("needsAToken", status === 401, String(status));

  await sleep(1500); // the files reach the sandbox
  client = connect();
  await client.opened;
  const t0 = Date.now();
  const init = await client.request("initialize", {
    processId: null,
    rootUri: "file:///workspace",
    workspaceFolders: [{ uri: "file:///workspace", name: "workspace" }],
    capabilities: {
      textDocument: { publishDiagnostics: {}, hover: { contentFormat: ["markdown", "plaintext"] }, completion: { completionItem: { snippetSupport: true } }, definition: {} },
      workspace: { configuration: true, workspaceFolders: true },
    },
  });
  record("initializes", Boolean(init.result?.capabilities?.completionProvider) && Boolean(init.result.capabilities.hoverProvider), `${Date.now() - t0}ms ${Object.keys(init.result?.capabilities ?? {}).length} capabilities`);
  client.notify("initialized", {});
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "python", version: 1, text: APP } });

  const diagnostics = await client.note((n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === uri && n.params.diagnostics.length > 0);
  const messages = diagnostics?.params.diagnostics.map((d) => d.message) ?? [];
  record("reportsTypeError", messages.some((m) => /not assignable/.test(m) && /int/.test(m)), messages.join(" | "));

  const completion = await client.request("textDocument/completion", { textDocument: { uri }, position: { line: 4, character: 20 } });
  const items = (Array.isArray(completion.result) ? completion.result : (completion.result?.items ?? [])).map((i) => i.label);
  record("completesModule", items.includes("sqrt") && items.includes("pi"), `${items.length} items: ${items.slice(0, 8).join(", ")}`);

  const hover = await client.request("textDocument/hover", { textDocument: { uri }, position: { line: 4, character: 7 } });
  const hoverText = JSON.stringify(hover.result?.contents ?? "");
  record("hoverExplains", hoverText.includes("radius: float") && hoverText.includes("The area of a circle"), hoverText);

  const definition = await client.request("textDocument/definition", { textDocument: { uri }, position: { line: 4, character: 7 } });
  const target = [definition.result].flat()[0];
  const where = target?.uri ?? target?.targetUri;
  record("goesToDefinitionInAnotherFile", where === `file:///workspace/${dir}/shapes.py` && (target.range ?? target.targetSelectionRange).start.line === 3, JSON.stringify(target));

  record("serverRunning", (await pyrightProcesses()) >= 1);
  client.ws.close();
  await sleep(3000);
  record("serverStopsWhenClosed", (await pyrightProcesses()) === 0);

  // C++ with clangd (both images): gcc's headers, a compile error, and completions on a vector.
  const cppUri = `file:///workspace/${dir}/main.cpp`;
  const CPP = `#include <bits/stdc++.h>
int main() {
  std::vector<int> v;
  int n = "x";
  v.
}
`;
  createFileAtPath(doc, `${dir}/main.cpp`, CPP, null);
  await sleep(1000);
  const cpp = connect("cpp");
  await cpp.opened;
  await cpp.request("initialize", { processId: null, rootUri: "file:///workspace", capabilities: { textDocument: { publishDiagnostics: {}, completion: { completionItem: { snippetSupport: true } } } } });
  cpp.notify("initialized", {});
  cpp.notify("textDocument/didOpen", { textDocument: { uri: cppUri, languageId: "cpp", version: 1, text: CPP } });
  const cppDiagnostics = await cpp.note((n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === cppUri && n.params.diagnostics.length > 0);
  const cppMessages = cppDiagnostics?.params.diagnostics.map((d) => d.message) ?? [];
  record("cppReportsError", cppMessages.some((m) => /cannot initialize|const char/.test(m)) && !cppMessages.some((m) => /file not found/.test(m)), cppMessages.join(" | "));
  const cppCompletion = await cpp.request("textDocument/completion", { textDocument: { uri: cppUri }, position: { line: 4, character: 4 } });
  const cppItems = (Array.isArray(cppCompletion.result) ? cppCompletion.result : (cppCompletion.result?.items ?? [])).map((i) => i.filterText ?? i.label.trim());
  record("cppCompletes", cppItems.includes("push_back"), `${cppItems.length} items: ${cppItems.slice(0, 6).join(", ")}`);
  cpp.ws.close();

  // Go and Rust come with the full image; the base image says so when asked.
  const FULL = (process.env.SANDBOX_IMAGE ?? "").includes("full");
  for (const [language, file, text, line, character, expected] of [
    ["go", "hello/main.go", `package main

import "fmt"

func main() {
	fmt.Pr
}
`, 5, 7, "Println"],
    // A crate one folder below the workspace, where rust-analyzer looks for Cargo.toml.
    ["rust", "src/main.rs", `fn main() {
    let s = String::new();
    s.
}
`, 2, 6, "len"],
  ]) {
    if (language === "rust") createFileAtPath(doc, `${dir}/Cargo.toml`, `[package]
name = "crab"
version = "0.1.0"
edition = "2021"
`, null);
    if (language === "go") createFileAtPath(doc, `${dir}/hello/go.mod`, `module hello

go 1.22
`, null);
    createFileAtPath(doc, `${dir}/${file}`, text, null);
    await sleep(1500);
    const lsp = connect(language);
    const closedWith = new Promise((resolve) => lsp.ws.once("close", (code, reason) => resolve(`${code} ${reason}`)));
    await lsp.opened;
    if (!FULL) {
      lsp.notify("initialized", {});
      record(`${language}NeedsFullImage`, /^4404 .*full image/.test(await closedWith), await closedWith);
      continue;
    }
    const fileUri = `file:///workspace/${dir}/${file}`;
    await lsp.request("initialize", { processId: null, rootUri: "file:///workspace", capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } } }, 120_000);
    lsp.notify("initialized", {});
    lsp.notify("textDocument/didOpen", { textDocument: { uri: fileUri, languageId: language, version: 1, text } });
    let labels = [];
    // Servers that index a project first (rust-analyzer) answer with little until they're done.
    for (const until = Date.now() + 120_000; Date.now() < until && !labels.includes(expected); await sleep(2000)) {
      const result = await lsp.request("textDocument/completion", { textDocument: { uri: fileUri }, position: { line, character } }, 60_000).catch(() => null);
      labels = (Array.isArray(result?.result) ? result.result : (result?.result?.items ?? [])).map((i) => i.filterText ?? i.label.trim());
    }
    record(`${language}Completes`, labels.includes(expected), `${labels.length} items: ${labels.slice(0, 6).join(", ")}`);
    lsp.ws.close();
  }
} catch (error) {
  record("flowCompletes", false, error instanceof Error ? error.message : String(error));
} finally {
  client?.ws.close();
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(800);
  provider.destroy();
  socket.destroy();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
