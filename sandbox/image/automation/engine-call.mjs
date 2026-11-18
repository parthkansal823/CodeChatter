// One call to Activepieces' engine that isn't a flow run, answered at once: checking a connection (EXECUTE_VALIDATE_AUTH), and a polling trigger's hooks
// (EXECUTE_TRIGGER_HOOK: ON_ENABLE, RUN, ON_DISABLE). image/automation.py runs it with the call on stdin and reads the answer on stdout; it never waits behind
// the room's flow runs, which host.mjs works through one at a time. Like host.mjs it starts the engine with a socket.io server for it to connect to, and
// answers on loopback what the engine asks a server for: the connections given with the call, and a polling trigger's own store (a file of its own, so a
// flow run's store can't overwrite it). Nothing is kept but that store.
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

import { Server } from "socket.io";

const ROOT = new URL(".", import.meta.url).pathname;
const ENGINE = join(ROOT, "engine", "main.js");
const ENGINE_HEAP_MB = 256;
const KINDS = new Set(["EXECUTE_VALIDATE_AUTH", "EXECUTE_TRIGGER_HOOK"]);

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
/** The engine's way of saying what went wrong: a JSON envelope around the message, as host.mjs's errorOf reads it. */
function messageOf(text) {
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.message ?? text);
  } catch {
    return String(text ?? "");
  }
}

/**
 * Asks the engine one thing. `call`: { kind, operation (the engine's, less what this fills in), connections ({ name: { piece, value } }), store (a file for
 * a trigger's store), seconds }. Answers { ok: true, response } or { ok: false, error }.
 */
export async function engineCall(call) {
  if (!KINDS.has(call.kind)) return { ok: false, error: "The engine isn't asked that here." };
  const connections = call.connections ?? {};
  const storeFile = call.store ?? null;
  const store = storeFile ? readJson(storeFile, {}) : {};
  const seconds = Math.min(Math.max(Number(call.seconds) || 60, 5), 300);

  const http = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url, "http://localhost");
    const send = (code, value) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(value ?? {}));
    };
    const path = url.pathname;
    if (path.startsWith("/v1/store-entries")) {
      if (!storeFile) return send(404);
      const key = url.searchParams.get("key");
      if (req.method === "POST") {
        const entry = JSON.parse(raw.toString() || "{}");
        store[entry.key] = entry.value;
        writeJson(storeFile, store);
        return send(200, entry);
      }
      if (req.method === "DELETE") {
        delete store[key];
        writeJson(storeFile, store);
        return send(200);
      }
      return Object.hasOwn(store, key) ? send(200, { key, value: store[key] }) : send(404);
    }
    if (path.startsWith("/v1/worker/app-connections/")) {
      const name = decodeURIComponent(path.slice("/v1/worker/app-connections/".length));
      const connection = Object.hasOwn(connections, name) ? connections[name] : null;
      return connection ? send(200, { id: name, externalId: name, displayName: name, pieceName: connection.piece, status: "ACTIVE", value: connection.value }) : send(404, { message: `This room has no connection called ${name}.` });
    }
    if (path === "/v1/worker/project") return send(200, { id: "room", displayName: "This room", externalId: null });
    if (path.startsWith("/v1/worker/variables/")) return send(404);
    return send(404, { message: `The engine can't use ${path} here.` });
  });
  const token = randomBytes(32).toString("hex");
  const io = new Server(http, { path: "/worker/ws", maxHttpBufferSize: 16 * 1024 * 1024 });
  io.use((socket, next) => (socket.handshake.auth?.connectionToken === token ? next() : next(new Error("refused"))));
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = http.address().port;

  let engine = null;
  const answer = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: `The engine didn't answer within ${seconds} seconds.` }), seconds * 1000);
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    engine = fork(ENGINE, [], {
      silent: true,
      execArgv: ["--no-node-snapshot", `--max-old-space-size=${ENGINE_HEAP_MB}`],
      env: {
        ...process.env,
        AP_EXECUTION_MODE: "UNSANDBOXED",
        AP_SANDBOX_WS_PORT: String(port),
        AP_SANDBOX_WS_TOKEN: token,
        AP_CUSTOM_PIECES_PATHS: ROOT,
        AP_NETWORK_MODE: "UNRESTRICTED",
        SANDBOX_ID: "room",
      },
    });
    engine.stdout.resume();
    engine.stderr.resume();
    engine.on("exit", (code, signal) => done({ ok: false, error: `The engine stopped with ${signal ?? `exit code ${code}`}.` }));
    io.on("connection", async (socket) => {
      socket.on("rpc-notify", () => {});
      socket.on("rpc", (_message, ack) => ack?.(undefined));
      const operation = {
        projectId: "room",
        platformId: "room",
        engineToken: "room",
        internalApiUrl: `http://127.0.0.1:${port}/`,
        publicApiUrl: `http://127.0.0.1:${port}/api/`,
        timeoutInSeconds: seconds,
        ...call.operation,
      };
      try {
        const reply = await socket.timeout((seconds + 5) * 1000).emitWithAck("rpc", { method: "executeOperation", payload: { operationType: call.kind, operation } });
        if (reply?.status === "OK") done({ ok: true, response: reply.response ?? null });
        else done({ ok: false, error: reply?.error ? messageOf(reply.error) : "The engine couldn't do it." });
      } catch (error) {
        done({ ok: false, error: error.message });
      }
    });
  });
  engine?.kill("SIGKILL");
  io.close();
  http.close();
  return answer;
}

// Run as a script: the call on stdin, the answer on stdout.
if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  const input = await readBody(process.stdin);
  let call = {};
  try {
    call = JSON.parse(input.toString("utf8") || "{}");
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "That isn't a call." }));
    process.exit(0);
  }
  const answer = await engineCall(call);
  process.stdout.write(JSON.stringify(answer));
  process.exit(0);
}
