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

const HOME = join(process.env.HOME, "automations");
const QUEUE = join(HOME, "queue");
const RUNS = join(HOME, "runs");
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

function readStep(execution) {
  return execution?.executionState?.steps ?? {};
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
  const mode = job.mode === "step" || job.mode === "retry" ? job.mode : "run";
  const { flow, pinned } = withPins(job.flow ?? { trigger: null }, mode === "step" ? job.step : null);
  const live = { state: "running", id: job.id, path: job.path, flowId: job.flowId ?? null, name: job.flow?.displayName ?? job.path, trigger: job.trigger, by: job.by ?? null, mode, step: mode === "step" ? job.step : null, retryOf: mode === "retry" ? job.retryOf : null, pinned, startedAt, finishedAt: null, beat: startedAt, steps: {}, status: null, message: null };
  writeJson(LIVE, live);
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
    if (path.startsWith("/v1/files/")) {
      // Running again from where a run failed: the engine reads that run's steps, keeps what succeeded, and carries on from what didn't.
      if (req.method === "GET" && mode === "retry" && path === `/v1/files/resume-${job.id}`) return send(200, { executionState: { steps: job.resumeSteps ?? {}, tags: [] } });
      if (req.method !== "PUT") return send(404);
      try {
        steps = readStep(JSON.parse((raw[0] === 0x28 ? zstdDecompressSync(raw) : raw).toString()));
        live.steps = steps;
        writeJson(LIVE, live);
      } catch {
        // Details that can't be read don't stop the run.
      }
      const readUrl = `http://127.0.0.1:${http.address().port}${path}`;
      res.setHeader("x-ap-file-read-url", readUrl);
      return send(200, { readUrl });
    }
    if (path === "/v1/engine/run-logs") {
      try {
        const report = JSON.parse(raw.toString());
        live.status = report.status ?? live.status;
        if (report.failedStep) live.failedStep = report.failedStep;
        writeJson(LIVE, live);
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
          steps = { ...steps, [step.name]: step.output };
          live.steps = steps;
          writeJson(LIVE, live);
        }
      } catch {
        // Details that can't be read don't stop the run.
      }
      return send(200);
    }
    if (path === "/v1/engine/step-progress" || path === "/v1/engine/flow-response") return send(200);
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
      return Object.hasOwn(connections, name) ? send(200, connections[name]) : send(404, { message: `This room has no connection called ${name}.` });
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

  const finish = (status, message) => {
    clearInterval(stopTimer);
    clearInterval(beat);
    const finishedAt = NOW();
    Object.assign(live, { state: "finished", status, message, finishedAt, durationMs: finishedAt - startedAt, steps, beat: finishedAt });
    // A flow that failed, with an error flow, starts it: n8n's error workflow. Not for a step tried alone, nor an error flow's own failure, so it can't loop.
    if ((status === "FAILED" || status === "TIMEOUT") && mode !== "step" && job.trigger !== "error" && typeof job.flow?.errorFlow === "string") Object.assign(live, queueErrorFlow(job, live));
    writeJson(join(RUNS, `${job.id}.json`), { ...live, payload: job.payload ?? null });
    writeJson(LIVE, live);
    rmSync(join(CODES, job.id), { recursive: true, force: true });
    for (const old of readdirSync(RUNS).sort().reverse().slice(MOST_RUNS)) rmSync(join(RUNS, old), { force: true });
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
      writeJson(LIVE, live);
    }, BEAT_MS);
    stopTimer = setInterval(() => {
      if (existsSync(STOP)) {
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
        ...(mode === "retry"
          ? { executionType: "RESUME", logsFileId: `resume-${job.id}`, resumePayload: { type: "inline", value: { body: {}, headers: {}, queryParams: {} } }, stepNameToTest: null }
          : {
              executionType: "BEGIN",
              logsFileId: `logs-${job.id}`,
              triggerPayload: { type: "inline", value: triggerOutputOf(flow, job) },
              // One step on its own: the engine stands every other step in with this data, and runs only that one.
              stepNameToTest: mode === "step" ? job.step : null,
              ...(mode === "step" ? { sampleData: { ...(job.sampleData ?? {}), ...Object.fromEntries(pinned.map((name) => [name, job.flow.pinned[name]])) } } : {}),
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
  // An error flow: the failed run and its flow, as n8n's Error Trigger gives them.
  if (job.trigger === "error") return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  // A room event (a `room` setting on the webhook trigger): what happened, as it is.
  if (flow.trigger?.settings?.room) return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  if (flow.trigger?.settings?.pieceName === "@activepieces/piece-schedule") return job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  return { body: job.payload ?? {}, headers: job.headers ?? {}, queryParams: job.query ?? {} };
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
  const request = { op: "run", path: job.path, flowId: errorFlow, payload, trigger: "error", by: `${String(job.flow.displayName ?? job.path).slice(0, 60)} failed`, noWorker: true };
  const done = spawnSync("python3", [SCRIPT], { input: JSON.stringify(request), encoding: "utf8", timeout: 20_000 });
  try {
    const answer = JSON.parse(done.stdout);
    if (typeof answer.id === "string") return { errorRun: answer.id, errorProblem: null };
    return { errorRun: null, errorProblem: String(answer.error ?? "Its error flow couldn't be started.").slice(0, 300) };
  } catch {
    return { errorRun: null, errorProblem: "Its error flow couldn't be started." };
  }
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
