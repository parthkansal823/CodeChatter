/**
 * Evals: promptfoo, in the room's sandbox, inside the jail like a Run, calling the room's model through the AI gateway. Its config
 * and results live in a folder of /tmp for the length of the run, so nothing lands in the room's files.
 */
import { randomBytes } from "node:crypto";

import { EVAL_LIMITS, promptfooConfig, type EvalCell, type EvalInput, type EvalReport } from "@codechatter/contracts";

import { Collector, ended } from "./databases.js";
import { log } from "./log.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { exitCodeOnceEnded } from "./sandbox.js";

/** A local model can take a minute over one answer, and an eval is up to 120 of them. */
const EVAL_SECONDS = 30 * 60;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

export class EvalError extends Error {}

type Raw = {
  success?: unknown;
  error?: unknown;
  latencyMs?: unknown;
  testIdx?: unknown;
  provider?: { label?: unknown; id?: unknown };
  response?: { output?: unknown; error?: unknown };
  tokenUsage?: { prompt?: unknown; completion?: unknown };
  gradingResult?: { componentResults?: Array<{ pass?: unknown; reason?: unknown; assertion?: { type?: unknown; value?: unknown; threshold?: unknown } }> };
};

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const cut = (value: string, most: number) => (value.length > most ? `${value.slice(0, most)}…` : value);
const words = (value: unknown) => (value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value));

/** promptfoo's --output JSON, down to what's named: it repeats the whole prompt and config in every result. */
export function parsePromptfoo(json: string, input: Pick<EvalInput, "cases" | "columns">, ms: number): EvalReport {
  const parsed = JSON.parse(json) as { results?: { results?: Raw[] } };
  const raw = parsed.results?.results;
  if (!Array.isArray(raw)) throw new EvalError("promptfoo's report wasn't what was expected.");
  const cells: EvalCell[] = [];
  for (const result of raw) {
    const test = typeof result.testIdx === "number" ? input.cases[result.testIdx] : undefined;
    const label = result.provider?.label;
    const column = input.columns.find((item) => item.id === label);
    if (!test || !column) continue;
    const error = words(result.error ?? result.response?.error);
    const hasAnswer = result.response?.output !== undefined && result.response.output !== null;
    // A failed check also reports here as `error`: only with no answer at all was it the call that failed.
    const callFailed = Boolean(error) && !hasAnswer;
    const failed = (result.gradingResult?.componentResults ?? [])
      .filter((check) => check.pass === false)
      .map((check) => ({ type: words(check.assertion?.type), value: cut(words(check.assertion?.value ?? check.assertion?.threshold), EVAL_LIMITS.reasonChars), reason: cut(words(check.reason), EVAL_LIMITS.reasonChars) }));
    cells.push({
      caseId: test.id,
      columnId: column.id,
      pass: result.success === true,
      error: callFailed ? cut(error, EVAL_LIMITS.reasonChars) : null,
      output: cut(words(result.response?.output), EVAL_LIMITS.outputChars),
      failed,
      latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : null,
      inputTokens: count(result.tokenUsage?.prompt),
      outputTokens: count(result.tokenUsage?.completion),
    });
  }
  return {
    cells,
    passed: cells.filter((cell) => cell.pass).length,
    failed: cells.filter((cell) => !cell.pass && !cell.error).length,
    errors: cells.filter((cell) => cell.error).length,
    inputTokens: cells.reduce((sum, cell) => sum + cell.inputTokens, 0),
    outputTokens: cells.reduce((sum, cell) => sum + cell.outputTokens, 0),
    ms,
  };
}

/** One at a time in a room: a second would share one machine's model with the first, and spoil its timings. */
const busy = new WeakSet<RoomSession>();

export async function runEvals(session: RoomSession, input: EvalInput, signal: AbortSignal): Promise<EvalReport> {
  if (busy.has(session)) throw new EvalError("Evals are already running in this room. Wait for them to finish.");
  busy.add(session);
  const { sandbox } = session;
  const folder = `/tmp/cc-eval-${randomBytes(6).toString("hex")}`;
  const started = Date.now();
  try {
    const config = Buffer.from(JSON.stringify(promptfooConfig(input)), "utf8");
    // The exec's stdin can't be closed on its own on every Docker, so the config is read by its size. $1 is that, $2 the folder.
    const script = [
      'command -v promptfoo >/dev/null || { echo "cc-evals: missing" >&2; exit 127; }',
      'mkdir -p "$2/home" && cd "$2" || exit 1',
      "trap 'rm -rf \"$2\"' EXIT",
      'head -c "$1" > config.json',
      'export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_CONFIG_DIR="$2/home" HOME="$2/home" NO_COLOR=1',
      `timeout ${EVAL_SECONDS} promptfoo eval -c config.json -o out.json --no-cache --no-progress-bar --no-table --no-write >log.txt 2>&1 &`,
      'echo $! > pid',
      'wait $!',
      "code=$?",
      // 100 is promptfoo's own for "some tests failed", which is a result.
      'if [ -s out.json ]; then cat out.json; exit 0; fi',
      'tail -c 2000 log.txt >&2',
      'exit "$code"',
    ].join("\n");
    const handle = await sandbox.exec([JAIL, "sh", "-c", script, "cc-evals", String(config.length), folder], { tty: false, stdin: true });
    const stdout = new Collector(MAX_REPORT_BYTES);
    const stderr = new Collector(16 * 1024);
    handle.demux(stdout, stderr);
    const finished = ended(handle.stream);
    handle.stream.write(config);
    const stop = () => {
      void sandbox
        .exec(["sh", "-c", `kill -TERM "$(cat ${folder}/pid)" 2>/dev/null; true`], { tty: false })
        .then((killer) => killer.stream.resume())
        .catch((error: unknown) => log.warn(`couldn't stop an eval: ${String(error)}`));
    };
    signal.addEventListener("abort", stop, { once: true });
    await finished;
    signal.removeEventListener("abort", stop);
    const code = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    if (signal.aborted) throw new EvalError("Stopped.");
    if (code === 127 && stderr.text().includes("cc-evals: missing")) throw new EvalError("This room's sandbox doesn't have promptfoo yet: its image needs rebuilding (pnpm sandbox:build).");
    if (code === 124) throw new EvalError(`The evals took longer than ${EVAL_SECONDS / 60} minutes and were stopped.`);
    if (stdout.cut) throw new EvalError("The results were too big to read back.");
    if (code !== 0) throw new EvalError(`promptfoo couldn't run them: ${cut(stderr.text().trim(), 600) || `exit code ${code}`}`);
    return parsePromptfoo(stdout.text(), input, Date.now() - started);
  } finally {
    busy.delete(session);
  }
}
