// Runs a room's automations, one at a time, with Activepieces' real engine and no Activepieces server. image/automation.py queues a job and starts this; it works
// through the queue and exits. For each job it starts a socket.io server for the engine to connect to, hands it the flow, and answers on loopback the few things
// the engine asks a server for: where to put the run's details, and a room's stored values and connections. The room's jail is the sandbox: AP_EXECUTION_MODE says so.
import { fork, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

import { Server } from "socket.io";

import { dispositionOf, FILE_ID, fileNameOf, filesHere, MOST_FILE_BYTES, RUN_ID, stepFileUrl, typeOf, wholeSteps } from "./files.mjs";

const HOME = join(process.env.HOME, "automations");
const QUEUE = join(HOME, "queue");
const RUNS = join(HOME, "runs");
/** What runs' steps kept apart: the files they made (File Helper's, a CSV file, a zip), and outputs too big for the run's details. A folder for each run. */
const FILES = join(HOME, "files");
const CODES = join(HOME, "codes");
const LIVE = join(HOME, "live.json");
const STORE = join(HOME, "store.json");
const STOP = join(HOME, "stop");
const LOCK = join(HOME, "worker");
const ROOT = new URL(".", import.meta.url).pathname;
const ENGINE = join(ROOT, "engine", "main.js");
/** Queues runs (an error flow, here), as it does for the runner. */
const SCRIPT = join(ROOT, "..", "automation.py");
const BUILTINS = pathToFileURL(join(ROOT, "builtins.mjs")).href;
const BUILTIN_NAME = /^[a-z_]{1,40}$/;
const MOST_RUNS = 50;
const STEP_NAME = /^[A-Za-z0-9_]+$/;
const ENGINE_HEAP_MB = 256;
const STOP_POLL_MS = 500;
const BEAT_MS = 1000;
const NOW = () => Date.now();

function writeJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}
function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

/** Every step in a flow: after this one, in its branches and in its loop. */
function* stepsOf(step) {
  for (let current = step; current; current = current.nextAction) {
    yield current;
    if (current.firstLoopAction) yield* stepsOf(current.firstLoopAction);
    for (const child of current.children ?? []) if (child) yield* stepsOf(child);
  }
}

/**
 * What Activepieces builds before a run: a code step is a module on disk. TypeScript's types come off, and packages aren't installed: a room has what its image
 * has. A built-in step (Filter, Merge and the rest) is a code step marked `builtin`: its module calls ours in builtins.mjs, whatever the file says its code is.
 */
function writeCodeSteps(flow, versionId) {
  for (const step of stepsOf(flow.trigger)) {
    if (!STEP_NAME.test(step.name ?? "")) throw new Error(`"${step.name}" can't be a step's name: letters, numbers and underscores only.`);
    if (step.type !== "CODE") continue;
    const folder = join(CODES, versionId, step.name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "package.json"), JSON.stringify({ type: "module" }));
    if (step.builtin !== undefined) {
      if (typeof step.builtin !== "string" || !BUILTIN_NAME.test(step.builtin)) throw new Error(`"${step.builtin}" isn't a built-in step.`);
      writeFileSync(join(folder, "index.js"), `import { run } from ${JSON.stringify(BUILTINS)};\nexport const code = async (inputs) => run(${JSON.stringify(step.builtin)}, inputs);\n`);
      continue;
    }
    const source = String(step.settings?.sourceCode?.code ?? "");
    let plain = source;
    try {
      plain = stripTypeScriptTypes(source);
    } catch {
      // Not TypeScript that can be stripped: the run says what's wrong with it, in the step.
    }
    writeFileSync(join(folder, "index.js"), plain);
  }
}

/**
 * The secrets in a run's connections (a token, a password, a piece's secret fields, as its manifest describes them), to take out of everything the run
 * keeps: its steps' inputs, outputs and errors, as Activepieces' own server does. A step could still pass one on to a service; it isn't written down here.
 */
function secretsOf(connections) {
  const pieces = readJson(join(ROOT, "manifest.json"), {}) ?? {};
  const found = new Set();
  for (const connection of Object.values(connections ?? {})) {
    const value = connection?.value ?? {};
    if (value.type === "SECRET_TEXT") found.add(value.secret_text);
    else if (value.type === "BASIC_AUTH") found.add(value.password);
    else if (value.type === "CUSTOM_AUTH") {
      const fields = pieces[connection.piece]?.auth?.fields ?? {};
      for (const [name, field] of Object.entries(value.props ?? {})) if (typeof field === "string" && (fields[name]?.type === "SECRET_TEXT" || /pass|secret|token|key|cred|private|pwd/i.test(name))) found.add(field);
    }
  }
  // Very short values would take out ordinary words.
  return [...found].filter((secret) => typeof secret === "string" && secret.length >= 4).sort((a, b) => b.length - a.length);
}

/** What's kept of a run, with its connections' secrets taken out wherever they appear, as JSON has them. */
function scrubbed(value, secrets) {
  if (!secrets.length) return value;
  const text = JSON.stringify(value);
  let clean = text;
  for (const secret of secrets) clean = clean.split(JSON.stringify(secret).slice(1, -1)).join("**REDACTED**");
  return clean === text ? value : JSON.parse(clean);
}

function readStep(execution) {
  return execution?.executionState?.steps ?? {};
}

/** A step's file, kept with its run: its bytes and its name, or null once the run isn't kept. */
function stepFile(runId, fileId) {
  if (!RUN_ID.test(runId) || !FILE_ID.test(fileId)) return null;
  try {
    const meta = readJson(join(FILES, runId, `${fileId}.json`), {}) ?? {};
    return { name: fileNameOf(meta.name), data: readFileSync(join(FILES, runId, fileId)) };
  } catch {
    return null;
  }
}

/** An output the engine kept apart (over 32 KB), by its id, from whichever run it was in: ids are the engine's, random and long. */
function sliceOf(fileId) {
  if (!FILE_ID.test(fileId) || !existsSync(FILES)) return null;
  for (const run of readdirSync(FILES)) {
    const path = join(FILES, run, `${fileId}.slice`);
    if (existsSync(path)) return readFileSync(path);
  }
  return null;
}

/**
 * A flow with its pinned steps standing in for themselves: each becomes a code step that gives back what was pinned, so it isn't run (a piece that needs an
 * account isn't called at all) and what comes after gets the same data every time. Only code and pieces' actions can be pinned. `except` stays as it is: the
 * step being tried on its own runs for real.
 */
function withPins(flow, except = null) {
  const pinned = flow.pinned && typeof flow.pinned === "object" ? flow.pinned : {};
  const names = [];
  const copy = JSON.parse(JSON.stringify(flow));
  for (const step of stepsOf(copy.trigger)) {
    if (step.name === except || !Object.hasOwn(pinned, step.name) || (step.type !== "CODE" && step.type !== "PIECE")) continue;
    names.push(step.name);
    step.type = "CODE";
    // A pinned built-in step gives back what was pinned too.
    delete step.builtin;
    step.settings = { sourceCode: { code: `export const code = async () => (${JSON.stringify(pinned[step.name] ?? null)});\n`, packageJson: "{}" }, input: {}, errorHandlingOptions: step.settings?.errorHandlingOptions ?? { continueOnFailure: { value: false }, retryOnFailure: { value: false } } };
  }
  return { flow: copy, pinned: names };
}

/** One job, to its end. Never throws: whatever goes wrong is the run's result. */
async function runJob(job) {
  const startedAt = NOW();
  const mode = job.mode === "step" || job.mode === "retry" || job.mode === "resume" ? job.mode : "run";
  // The flow's steps' files are read from this worker once it has a port (below).
  let { flow, pinned } = withPins(job.flow ?? { trigger: null }, mode === "step" ? job.step : null);
  running.add(job.id);
  const live = { state: "running", id: job.id, path: job.path, flowId: job.flowId ?? null, name: job.flow?.displayName ?? job.path, trigger: job.trigger, by: job.by ?? null, mode, step: mode === "step" ? job.step : null, retryOf: mode === "retry" ? job.retryOf : null, pinned, startedAt, finishedAt: null, beat: startedAt, steps: {}, status: null, message: null };
  // A flow called by another runs inside its run: the live view stays the caller's.
  const secrets = secretsOf(job.connections);
  const writeLive = () => {
    if (!job.nested) writeJson(LIVE, scrubbed(live, secrets));
  };
  // Approval links made in this run (builtins.mjs), for the wait after them: kept here, never in the run's details.
  let reservedToken = null;
  writeLive();
  const connections = job.connections ?? {};
  let steps = {};
  let engine = null;
  let stopTimer = null;
  let beat = null;
  const store = readJson(STORE, {});

  const http = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url, "http://localhost");
    const send = (code, value) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(value ?? {}));
    };
    const path = url.pathname;
    const port = http.address().port;
    if (path.startsWith("/v1/files/")) {
      const fileId = path.slice("/v1/files/".length);
      if (req.method === "GET") {
        // Running again from where a run failed: the engine reads that run's steps, keeps what succeeded, and carries on from what didn't.
        if ((mode === "retry" || mode === "resume") && fileId === `resume-${job.id}`) return send(200, { executionState: { steps: filesHere(job.resumeSteps ?? {}, port), tags: [] } });
        // A step's output the engine kept apart, read back when a later step uses it.
        const slice = sliceOf(fileId);
        if (!slice) return send(404);
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": slice.length });
        return res.end(slice);
      }
      if (req.method !== "PUT") return send(404);
      const kind = String(req.headers["x-ap-file-type"] ?? "FLOW_RUN_LOG");
      const zstd = String(req.headers["content-encoding"] ?? "").toLowerCase() === "zstd";
      if (kind !== "FLOW_RUN_LOG") {
        if (!FILE_ID.test(fileId)) return send(400, { message: "That isn't a file's id." });
        const data = zstd ? zstdDecompressSync(raw) : raw;
        if (data.length > MOST_FILE_BYTES) return send(413, { message: `A step's file is up to ${MOST_FILE_BYTES / 1024 / 1024} MB.` });
        mkdirSync(join(FILES, job.id), { recursive: true });
        // An output over 32 KB, kept apart by the engine: put back into the run's details below.
        if (kind === "FLOW_RUN_LOG_SLICE") {
          writeFileSync(join(FILES, job.id, `${fileId}.slice`), data);
          const readUrl = `http://127.0.0.1:${port}/v1/files/${fileId}`;
          res.setHeader("x-ap-file-read-url", readUrl);
          return send(200, { readUrl });
        }
        // A file a step made: the next steps, and a run carried on later, read it from its address.
        const name = fileNameOf(req.headers["x-ap-file-name"]);
        writeFileSync(join(FILES, job.id, fileId), data);
        writeFileSync(join(FILES, job.id, `${fileId}.json`), JSON.stringify({ name, size: data.length }));
        const readUrl = stepFileUrl(port, job.id, fileId, name);
        res.setHeader("x-ap-file-read-url", readUrl);
        return send(200, { readUrl });
      }
      try {
        steps = wholeSteps(readStep(JSON.parse((zstd || raw[0] === 0x28 ? zstdDecompressSync(raw) : raw).toString())), sliceOf);
        live.steps = steps;
        writeLive();
      } catch {
        // Details that can't be read don't stop the run.
      }
      const readUrl = `http://127.0.0.1:${port}${path}`;
      res.setHeader("x-ap-file-read-url", readUrl);
      return send(200, { readUrl });
    }
    // A step's file, from this run or an earlier one still kept.
    if (path.startsWith("/v1/step-files/") && req.method === "GET") {
      const [runId = "", fileId = ""] = path.slice("/v1/step-files/".length).split("/");
      const found = stepFile(runId, fileId);
      if (!found) return send(404, { message: "That file isn't kept any more: its run has gone." });
      res.writeHead(200, { "content-type": typeOf(found.name), "content-length": found.data.length, "content-disposition": dispositionOf(found.name) });
      return res.end(found.data);
    }
    // A file made by a built-in step (Read files), kept as a piece's would be.
    if (path === "/v1/codechatter/files" && req.method === "POST") {
      let asked = {};
      try {
        asked = JSON.parse(raw.toString());
      } catch {
        return send(400, { error: "That isn't a file." });
      }
      const data = Buffer.from(String(asked.data ?? ""), "base64");
      if (data.length > MOST_FILE_BYTES) return send(413, { error: `A step's file is up to ${MOST_FILE_BYTES / 1024 / 1024} MB.` });
      const fileId = randomBytes(12).toString("base64url");
      const name = fileNameOf(asked.name);
      mkdirSync(join(FILES, job.id), { recursive: true });
      writeFileSync(join(FILES, job.id, fileId), data);
      writeFileSync(join(FILES, job.id, `${fileId}.json`), JSON.stringify({ name, size: data.length }));
      return send(200, { url: stepFileUrl(port, job.id, fileId, name) });
    }
    if (path === "/v1/engine/run-logs") {
      try {
        const report = JSON.parse(raw.toString());
        live.status = report.status ?? live.status;
        // The engine wraps a step's error in its own JSON: the plain message is what people, an error flow and a flow's caller want.
        if (report.failedStep) live.failedStep = { ...report.failedStep, ...(typeof report.failedStep.message === "string" && { message: errorOf(report.failedStep.message) }) };
        writeLive();
      } catch {
        // The same.
      }
      return send(200);
    }
    // Each step as it starts and ends. Inside a loop it's kept by its name too, so the chart can light it up; the final details have each time round.
    if (path === "/v1/engine/run-progress") {
      try {
        const { step } = JSON.parse(raw.toString());
        if (step?.name) {
          steps = { ...steps, ...wholeSteps({ [step.name]: step.output }, sliceOf) };
          live.steps = steps;
          writeLive();
        }
      } catch {
        // Details that can't be read don't stop the run.
      }
      return send(200);
    }
    if (path === "/v1/engine/step-progress" || path === "/v1/engine/flow-response") return send(200);
    /**
     * A step that waits (Activepieces' Delay, or the webhook piece's "respond and wait for the next call"): the run pauses here, and carries on later. One
     * waiting for a call gets an address with a token of its own, through the API (job.resumeBase); one waiting for a time, when the API's timer says so.
     */
    if (path === "/v1/waitpoints" && req.method === "POST") {
      let asked = {};
      try {
        asked = JSON.parse(raw.toString());
      } catch {
        // What it asks for is checked below.
      }
      const type = asked.type === "DELAY" ? "DELAY" : "WEBHOOK";
      const resumeAt = type === "DELAY" && asked.resumeDateTime ? Date.parse(asked.resumeDateTime) : NaN;
      const token = type === "WEBHOOK" && reservedToken ? reservedToken : randomBytes(24).toString("base64url");
      if (type === "WEBHOOK") reservedToken = null;
      const id = `wp_${randomBytes(8).toString("hex")}`;
      live.waitpoint = { id, type, step: String(asked.stepName ?? ""), resumeAt: Number.isFinite(resumeAt) ? resumeAt : null, token, ...(asked.responseToSend && { responseToSend: asked.responseToSend }) };
      writeLive();
      const resumeUrl = job.resumeBase ? `${job.resumeBase}/${job.id}/${token}` : `http://localhost/this-run-can-only-be-carried-on-from-the-room/${job.id}`;
      return send(200, { id, resumeUrl, type, status: "PENDING" });
    }
    // Approval links (builtins.mjs): the address the next wait for a call will have, made now so it can be sent first.
    if (path === "/v1/codechatter/approval-links" && req.method === "POST") {
      if (!job.resumeBase) return send(409, { error: "Approval links need the run to have been started through CodeChatter." });
      reservedToken ??= randomBytes(24).toString("base64url");
      return send(200, { url: `${job.resumeBase}/${job.id}/${reservedToken}` });
    }
    // Call a flow (builtins.mjs), from this run's own engine.
    if (path === "/v1/codechatter/call-flow" && req.method === "POST") {
      let call;
      try {
        call = JSON.parse(raw.toString());
      } catch {
        return send(400, { error: "That isn't a call." });
      }
      const answer = await callFlow(job, call, startedAt);
      // Files the flow called made were read from its worker, gone now: they're read from this one.
      return send(answer.status, filesHere(answer.body, port));
    }
    if (path.startsWith("/v1/store-entries")) {
      const key = url.searchParams.get("key");
      if (req.method === "POST") {
        const entry = JSON.parse(raw.toString());
        store[entry.key] = entry.value;
        writeJson(STORE, store);
        return send(200, entry);
      }
      if (req.method === "DELETE") {
        delete store[key];
        writeJson(STORE, store);
        return send(200);
      }
      return Object.hasOwn(store, key) ? send(200, { key, value: store[key] }) : send(404);
    }
    if (path.startsWith("/v1/worker/app-connections/")) {
      const name = decodeURIComponent(path.slice("/v1/worker/app-connections/".length));
      // The room's connections, given with this run by the API (sealed there, never on disk here), in the shape the engine reads: { piece, value }.
      const connection = Object.hasOwn(connections, name) ? connections[name] : null;
      return connection ? send(200, { id: name, externalId: name, displayName: name, pieceName: connection.piece, status: "ACTIVE", value: connection.value }) : send(404, { message: `This room has no connection called ${name}.` });
    }
    if (path === "/v1/worker/project") return send(200, { id: "room", displayName: "This room", externalId: null });
    if (path.startsWith("/v1/worker/variables/")) return send(404);
    return send(404, { message: `An automation can't use ${path} here yet.` });
  });

  const token = randomBytes(32).toString("hex");
  const io = new Server(http, { path: "/worker/ws", maxHttpBufferSize: 64 * 1024 * 1024 });
  io.use((socket, next) => (socket.handshake.auth?.connectionToken === token ? next() : next(new Error("refused"))));
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = http.address().port;
  // Pinned data, or what's sent, may name files from an earlier run: they're read from this worker.
  flow = filesHere(flow, port);

  const finish = (status, message) => {
    clearInterval(stopTimer);
    clearInterval(beat);
    const finishedAt = NOW();
    Object.assign(live, { state: "finished", status, message, finishedAt, durationMs: finishedAt - startedAt, steps, beat: finishedAt });
    // Only a run that's waiting keeps what it waits for.
    if (status !== "PAUSED") live.waitpoint = null;
    if (mode === "resume") rmSync(join(HOME, `resume-${job.id}.lock`), { force: true });
    // A flow that failed, with an error flow, starts it: n8n's error workflow. Not for a step tried alone, nor an error flow's own failure, so it can't loop.
    if ((status === "FAILED" || status === "TIMEOUT") && mode !== "step" && job.trigger !== "error" && typeof job.flow?.errorFlow === "string") Object.assign(live, queueErrorFlow(job, live));
    // What started it stays its payload when it carries on; where it's carried on from goes with it, for a waitpoint after this one.
    writeJson(join(RUNS, `${job.id}.json`), scrubbed({ ...live, payload: (mode === "resume" ? job.triggerPayload : job.payload) ?? null, resumeBase: job.resumeBase ?? null }, secrets));
    writeLive();
    rmSync(join(CODES, job.id), { recursive: true, force: true });
    running.delete(job.id);
    for (const old of readdirSync(RUNS).sort().reverse().slice(MOST_RUNS)) rmSync(join(RUNS, old), { force: true });
    // A run's files go with it, but not while it (or a run that called it) is going on.
    if (existsSync(FILES)) for (const run of readdirSync(FILES)) if (!running.has(run) && !existsSync(join(RUNS, `${run}.json`))) rmSync(join(FILES, run), { recursive: true, force: true });
    engine?.kill("SIGKILL");
    io.close();
    http.close();
  };

  try {
    writeCodeSteps(flow, job.id);
  } catch (error) {
    finish("FAILED", error.message);
    return;
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      finish("TIMEOUT", `It was still running after ${job.seconds} seconds, so it was stopped.`);
      resolve();
    }, job.seconds * 1000);
    const settle = (status, message) => {
      clearTimeout(timeout);
      finish(status, message);
      resolve();
    };
    beat = setInterval(() => {
      live.beat = NOW();
      writeLive();
    }, BEAT_MS);
    // Stop stops every run going on, a called flow's and its caller's.
    stopTimer = setInterval(() => {
      if (stopping || existsSync(STOP)) {
        stopping = true;
        rmSync(STOP, { force: true });
        settle("STOPPED", "It was stopped.");
      }
    }, STOP_POLL_MS);
    engine = fork(ENGINE, [], {
      silent: true,
      execArgv: ["--no-node-snapshot", "--expose-gc", `--max-old-space-size=${ENGINE_HEAP_MB}`],
      env: {
        ...process.env,
        AP_EXECUTION_MODE: "UNSANDBOXED",
        AP_SANDBOX_WS_PORT: String(port),
        AP_SANDBOX_WS_TOKEN: token,
        AP_BASE_CODE_DIRECTORY: CODES,
        AP_CUSTOM_PIECES_PATHS: ROOT,
        AP_NETWORK_MODE: "UNRESTRICTED",
        AP_MAX_FLOW_RUN_LOG_SIZE_MB: "10",
        AP_MAX_FILE_SIZE_MB: "10",
        // Pieces reach the internet only through the room's proxy (HTTPS_PROXY, the agent's relay): Node's own fetch honours it only when told to, and the
        // engine's calls to this worker, and the room's own services, never go through it.
        NODE_USE_ENV_PROXY: "1",
        NO_PROXY: [process.env.NO_PROXY, "127.0.0.1", "localhost", "postgres", "mysql", "mariadb", "mongo", "redis"].filter(Boolean).join(","),
        SANDBOX_ID: "room",
      },
    });
    engine.stdout.resume();
    engine.stderr.resume();
    engine.on("exit", (code, signal) => {
      if (live.state === "running") settle("FAILED", signal === "SIGKILL" || code === 137 ? "The automation ran out of memory." : `The engine stopped with ${signal ?? `exit code ${code}`}.`);
    });
    io.on("connection", async (socket) => {
      socket.on("rpc-notify", () => {});
      socket.on("rpc", (_message, ack) => ack?.(undefined));
      const flowVersion = { id: job.id, flowId: job.flowId ?? job.path, displayName: flow.displayName ?? job.path, valid: true, state: "LOCKED", schemaVersion: flow.schemaVersion ?? "27", trigger: flow.trigger, agentIds: [], connectionIds: [], notes: [], updatedBy: null, backupFiles: null, created: new Date(startedAt).toISOString(), updated: new Date(startedAt).toISOString() };
      const operation = {
        projectId: "room",
        platformId: "room",
        engineToken: "room",
        internalApiUrl: `http://127.0.0.1:${port}/`,
        publicApiUrl: `http://127.0.0.1:${port}/api/`,
        timeoutInSeconds: job.seconds,
        flowVersion,
        flowRunId: job.id,
        // The engine only reports each step as it goes on a test run. It's the same run otherwise.
        runEnvironment: "TESTING",
        workerHandlerId: null,
        httpRequestId: null,
        streamStepProgress: "NONE",
        executeTrigger: false,
        ...(mode === "resume"
          ? // Carrying on from a waitpoint: the step that waited gets what the call to its address sent (or nothing, after a time).
            { executionType: "RESUME", resumeReason: "WAITPOINT", logsFileId: `resume-${job.id}`, resumePayload: { type: "inline", value: job.payload && typeof job.payload === "object" ? filesHere(job.payload, port) : { body: {}, headers: {}, queryParams: {} } }, stepNameToTest: null }
          : mode === "retry"
          ? { executionType: "RESUME", logsFileId: `resume-${job.id}`, resumePayload: { type: "inline", value: { body: {}, headers: {}, queryParams: {} } }, stepNameToTest: null }
          : {
              executionType: "BEGIN",
              logsFileId: `logs-${job.id}`,
              triggerPayload: { type: "inline", value: filesHere(triggerOutputOf(flow, job), port) },
              // One step on its own: the engine stands every other step in with this data, and runs only that one.
              stepNameToTest: mode === "step" ? job.step : null,
              ...(mode === "step" ? { sampleData: filesHere({ ...(job.sampleData ?? {}), ...Object.fromEntries(pinned.map((name) => [name, job.flow.pinned[name]])) }, port) } : {}),
            }),
      };
      try {
        const answer = await socket.timeout((job.seconds + 5) * 1000).emitWithAck("rpc", { method: "executeOperation", payload: { operationType: "EXECUTE_FLOW", operation } });
        if (live.state !== "running") return;
        if (answer?.status === "OK") settle(live.status ?? "SUCCEEDED", live.failedStep?.message ?? null);
        else settle("FAILED", answer?.error ? errorOf(answer.error) : "The engine couldn't run this flow.");
      } catch (error) {
        if (live.state === "running") settle("FAILED", error.message);
      }
    });
  });
}

/**
 * What the trigger gives the flow's first step. A webhook's call, as Activepieces' webhook piece gives it; what the schedule piece gives (its cron, its timezone and
 * the time it was for) as it is, as Activepieces runs it. Any other trigger runs only by hand, with what was sent as its body.
 */
function triggerOutputOf(flow, job) {
  // An error flow: the failed run and its flow, as n8n's Error Trigger gives them. A called flow: what its caller sent.
  if (job.trigger === "error" || job.trigger === "flow") return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  // A service's new item, from its polling trigger (automation.py's poll): the item, as Activepieces' own server gives it.
  if (job.trigger === "poll") return job.payload ?? {};
  // A room event (a `room` setting on the webhook trigger): what happened, as it is.
  if (flow.trigger?.settings?.room) return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  if (flow.trigger?.settings?.pieceName === "@activepieces/piece-schedule") return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  return { body: job.payload ?? {}, headers: job.headers ?? {}, queryParams: job.query ?? {} };
}

/** Asks automation.py, as the runner does: to find a flow, or queue one. */
function askScript(request) {
  const done = spawnSync("python3", [SCRIPT], { input: JSON.stringify(request), encoding: "utf8", timeout: 20_000 });
  try {
    return JSON.parse(done.stdout);
  } catch {
    return { error: "The automation couldn't be reached." };
  }
}

/** A run's id, as automation.py makes them: when, and something random. */
function newRunId() {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}-${randomBytes(4).toString("hex")}`;
}

/** How deep flows may call each other: a flow calling itself stops here, rather than until the memory runs out. */
const MOST_DEPTH = 5;
/** Set when Stop is pressed, so a called flow and the run that called it both stop. */
let stopping = false;
/** The runs going on: a flow called, and the run that called it. Their files are kept while they are. */
const running = new Set();

/**
 * Call a flow (n8n's Execute Workflow). The flow called must start on "Called by another flow": that's what lets it be called. Waiting, it runs here and now,
 * inside the caller's run and its time, as its own run of its own flow, and what its last step gave goes back; not waiting, it's queued for after.
 */
async function callFlow(caller, call, callerStartedAt) {
  const flowId = typeof call?.flowId === "string" ? call.flowId : "";
  if (!/^[\w-]{1,100}$/.test(flowId)) return { status: 400, body: { error: "Choose the flow to call." } };
  const depth = (caller.depth ?? 0) + 1;
  if (depth > MOST_DEPTH) return { status: 409, body: { error: `Flows called each other more than ${MOST_DEPTH} deep, so it stopped there: a flow calling itself, perhaps.` } };
  const found = askScript({ op: "find", flowId });
  if (!found.flow) return { status: 404, body: { error: found.error ?? "That flow isn't in the room any more." } };
  const name = found.flow.displayName || found.path;
  if (found.flow.trigger?.settings?.room?.event !== "flow.called") return { status: 409, body: { error: `${name} can't be called: its trigger isn't "Called by another flow".` } };
  const by = `Called by ${String(caller.flow?.displayName ?? caller.path).slice(0, 60)}`;
  const data = call.data === undefined ? {} : call.data;
  if (call.wait === false) {
    const queued = askScript({ op: "run", path: found.path, flowId, payload: data, trigger: "flow", by, noWorker: true });
    return typeof queued.id === "string" ? { status: 200, body: { runId: queued.id, queued: true } } : { status: 409, body: { error: queued.error ?? `${name} couldn't be queued.` } };
  }
  const left = caller.seconds - Math.ceil((NOW() - callerStartedAt) / 1000) - 2;
  if (left < 3) return { status: 409, body: { error: `There wasn't time left to run ${name}.` } };
  const id = newRunId();
  await runJob({ id, path: found.path, flowId, flow: found.flow, payload: data, headers: {}, query: {}, trigger: "flow", by, seconds: left, connections: caller.connections ?? {}, mode: "run", depth, nested: true });
  const run = readJson(join(RUNS, `${id}.json`));
  if (run?.status !== "SUCCEEDED") {
    const why = run?.failedStep?.message ?? run?.message ?? "it didn't say why";
    return { status: 409, body: { error: `${name} ${run?.status === "TIMEOUT" ? "took too long" : run?.status === "STOPPED" ? "was stopped" : "failed"}: ${why}`, runId: id } };
  }
  return { status: 200, body: { output: Object.values(run.steps ?? {}).at(-1)?.output ?? null, runId: id } };
}

/**
 * Queues a failed flow's error flow, with what n8n's Error Trigger gives: the run (its id, the error, the step it failed at, what started it) and the flow.
 * automation.py finds the error flow by its id, as for any trigger, and queues it; this worker goes on to it once this run is done.
 */
function queueErrorFlow(job, live) {
  const errorFlow = job.flow.errorFlow;
  if (!/^[\w-]{1,100}$/.test(errorFlow)) return { errorRun: null, errorProblem: "Its error flow isn't a flow's id." };
  if (errorFlow === job.flowId) return { errorRun: null, errorProblem: "A flow can't be its own error flow." };
  const payload = {
    execution: {
      id: job.id,
      url: null,
      retryOf: job.retryOf ?? null,
      error: { message: live.failedStep?.message ?? live.message ?? "It failed.", step: live.failedStep?.name ?? null },
      lastNodeExecuted: live.failedStep?.name ?? null,
      mode: job.trigger ?? "manual",
      startedAt: new Date(live.startedAt).toISOString(),
      stoppedAt: new Date(live.finishedAt).toISOString(),
    },
    workflow: { id: job.flowId ?? null, name: job.flow.displayName ?? job.path, path: job.path },
  };
  const answer = askScript({ op: "run", path: job.path, flowId: errorFlow, payload, trigger: "error", by: `${String(job.flow.displayName ?? job.path).slice(0, 60)} failed`, noWorker: true });
  if (typeof answer.id === "string") return { errorRun: answer.id, errorProblem: null };
  return { errorRun: null, errorProblem: String(answer.error ?? "Its error flow couldn't be started.").slice(0, 300) };
}

/** The engine's errors come wrapped; the person wants the message. */
function errorOf(text) {
  try {
    const outer = JSON.parse(text);
    const inner = typeof outer.message === "string" ? outer.message : text;
    try {
      return JSON.parse(inner).message ?? inner;
    } catch {
      return inner;
    }
  } catch {
    return String(text).slice(0, 1000);
  }
}

mkdirSync(QUEUE, { recursive: true });
mkdirSync(RUNS, { recursive: true });
try {
  for (;;) {
    stopping = false;
    const next = readdirSync(QUEUE).filter((name) => name.endsWith(".json")).sort()[0];
    if (!next) break;
    const file = join(QUEUE, next);
    const job = readJson(file);
    // Its connections have been read: they aren't left on disk.
    unlinkSync(file);
    if (job) await runJob(job);
  }
} finally {
  rmSync(LOCK, { recursive: true, force: true });
}
process.exit(0);
