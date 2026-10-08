import { runnableLanguage, type JudgeCase, type JudgeEvent } from "@codechatter/contracts";
import { PassThrough } from "node:stream";

import { JAIL } from "./plans.js";
import type { Sandbox } from "./sandbox.js";

const MAX_OUTPUT = 64 * 1024;

/**
 * How to judge a file: an optional build step (compiled languages build
 * once, not per test) and the command that runs one test. Both get the
 * file's path as "$1"; the test's input arrives in $CC_INPUT.
 */
export type JudgePlan = { build?: string; run: string };

export function judgePlanFor(path: string): JudgePlan | null {
  switch (runnableLanguage(path)?.language) {
    case "python":
      return { run: 'python3 -u "$1"' };
    case "javascript":
      return { run: 'node "$1"' };
    case "typescript":
      return { run: 'node --experimental-transform-types --disable-warning=ExperimentalWarning "$1"' };
    case "java":
      return { run: 'java "$1"' };
    case "shell":
      return { run: 'bash "$1"' };
    case "c":
      return { build: 'gcc -std=c17 -O2 -o /tmp/cc-judge "$1" -lm', run: "/tmp/cc-judge" };
    case "cpp":
      return { build: 'g++ -std=c++20 -O2 -o /tmp/cc-judge "$1"', run: "/tmp/cc-judge" };
    default:
      return null;
  }
}

/** Compare like online judges do: trailing spaces on each line and trailing blank lines don't matter. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

type ExecResult = { stdout: string; stderr: string; exitCode: number | null; timeMs: number };

/** One non-interactive exec: stdout and stderr captured separately (capped), exit code, wall time. */
async function capture(sandbox: Sandbox, script: string, path: string, env: string[]): Promise<ExecResult> {
  const started = Date.now();
  // No stdin at all: ending a hijacked stdin closes the whole connection, and the
  // input already travels in $CC_INPUT.
  const { exec, stream } = await sandbox.exec([JAIL, "sh", "-c", `umask 002; ${script}`, "cc-judge", path], { tty: false, env, stdin: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  sandbox.modem.demuxStream(stream, stdout, stderr);
  const collect = (source: PassThrough) => {
    let text = "";
    source.on("data", (chunk: Buffer) => {
      if (text.length < MAX_OUTPUT) text += chunk.toString("utf8");
    });
    return () => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n[output cut at 64 KB]` : text);
  };
  const out = collect(stdout);
  const err = collect(stderr);
  await new Promise<void>((resolve) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", () => resolve());
  });
  const timeMs = Date.now() - started;
  // The stream can end a moment before Docker records the exit code.
  let inspect = await exec.inspect().catch(() => null);
  for (let i = 0; i < 20 && inspect?.Running; i++) {
    await new Promise((r) => setTimeout(r, 50));
    inspect = await exec.inspect().catch(() => null);
  }
  return { stdout: out(), stderr: err(), exitCode: inspect && !inspect.Running ? inspect.ExitCode : null, timeMs };
}

/**
 * Run every test case against a file in the room's sandbox and report each
 * verdict as it finishes. Cases without an expected output just show what
 * the program printed ("custom input").
 */
export async function* judge(sandbox: Sandbox, path: string, cases: JudgeCase[], timeLimitMs: number): AsyncGenerator<JudgeEvent> {
  const plan = judgePlanFor(path);
  if (!plan) {
    yield { type: "error", message: `CodeChatter can't test ${path} yet.` };
    return;
  }
  if (plan.build) {
    yield { type: "compiling" };
    const built = await capture(sandbox, plan.build, path, []);
    if (built.exitCode !== 0) {
      yield { type: "compile-error", output: (built.stderr || built.stdout).trim() };
      return;
    }
  }

  const seconds = Math.max(1, Math.ceil(timeLimitMs / 1000));
  let passed = 0;
  for (const [index, testCase] of cases.entries()) {
    // printf keeps the input byte for byte; timeout's KILL makes TLE unambiguous (exit 137).
    const result = await capture(sandbox, `printf '%s' "$CC_INPUT" | timeout -s KILL ${seconds}s ${plan.run}`, path, [`CC_INPUT=${testCase.input}`]);
    const timedOut = result.exitCode === 137 && result.timeMs >= seconds * 1000 - 200;
    let verdict: "passed" | "failed" | "error" | "timeout" | "ran";
    if (timedOut) verdict = "timeout";
    else if (result.exitCode !== 0) verdict = "error";
    else if (testCase.expected === undefined) verdict = "ran";
    else verdict = normalizeOutput(result.stdout) === normalizeOutput(testCase.expected) ? "passed" : "failed";
    if (verdict === "passed") passed += 1;
    yield { type: "case", index, verdict, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timeMs: result.timeMs };
  }
  yield { type: "done", passed, total: cases.filter((c) => c.expected !== undefined).length };
}
