import type { RunExit, RunInfo } from "@codechatter/contracts";
import { describe, expect, it } from "vitest";

import { plainTail, runEventOf, runFailed, TestsWatcher } from "./room-activity.js";

const run: RunInfo = { id: "run-1", roomId: "ABC123", path: "src/main.py", command: "python3 src/main.py", startedBy: { id: "u1", name: "Asha" }, startedAt: "2026-11-18T10:00:00.000Z" };
const exit = (reason: RunExit["reason"], code: number | null): RunExit => ({ runId: "run-1", code, reason, durationMs: 1200 });

describe("a Run ending", () => {
  it("fails on an error, running out of time or printing too much, not on being stopped", () => {
    expect(runFailed(exit("exit", 0))).toBe(false);
    expect(runFailed(exit("exit", 1))).toBe(true);
    expect(runFailed(exit("timeout", null))).toBe(true);
    expect(runFailed(exit("output-limit", null))).toBe(true);
    expect(runFailed(exit("error", null))).toBe(true);
    expect(runFailed(exit("stopped", null))).toBe(false);
    expect(runFailed(exit("reset", null))).toBe(false);
  });

  it("gives the flow the file, how it ended, who ran it and the end of its output as plain text", () => {
    const event = runEventOf("ABC123", run, exit("exit", 1), `\u001b]0;title\u0007${"x".repeat(5000)}\r\n\u001b[31mTraceback: boom\u001b[0m\r\n`);
    expect(event).toMatchObject({ room: "ABC123", event: "run.finished", by: [{ id: "u1", name: "Asha" }], data: { path: "src/main.py", command: "python3 src/main.py", runId: "run-1", code: 1, reason: "exit", durationMs: 1200, failed: true } });
    const output = (event.data as { output: string }).output;
    expect(output).toHaveLength(4000);
    expect(output.endsWith("x\nTraceback: boom\n")).toBe(true);
    expect(output).not.toMatch(/\u001b/);
  });

  it("keeps short output whole", () => {
    expect(plainTail("\u001b[1;32mok\u001b[0m\n", 4000)).toBe("ok\n");
  });
});

describe("the Tests tab's tests", () => {
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;

  it("reads the stream in any pieces and says what they came to", () => {
    const watcher = new TestsWatcher("a.cpp", 3);
    const stream =
      line({ type: "compiling" }) +
      line({ type: "case", index: 0, verdict: "passed", stdout: "3\n", stderr: "", exitCode: 0, timeMs: 12 }) +
      line({ type: "case", index: 1, verdict: "failed", stdout: "4\n", stderr: "", exitCode: 0, timeMs: 10 }) +
      line({ type: "case", index: 2, verdict: "timeout", stdout: "", stderr: "", exitCode: null, timeMs: 2000 }) +
      line({ type: "done", passed: 1, total: 3 });
    for (let at = 0; at < stream.length; at += 7) watcher.feed(Buffer.from(stream.slice(at, at + 7)));
    expect(watcher.result()).toEqual({
      path: "a.cpp",
      passed: 1,
      total: 3,
      failed: true,
      cases: [
        { index: 0, verdict: "passed", timeMs: 12, stdout: "3\n", stderr: "" },
        { index: 1, verdict: "failed", timeMs: 10, stdout: "4\n", stderr: "" },
        { index: 2, verdict: "timeout", timeMs: 2000, stdout: "", stderr: "" },
      ],
    });
  });

  it("passes when every test does, and fails when it doesn't compile", () => {
    const passing = new TestsWatcher("a.py", 1);
    passing.feed(line({ type: "case", index: 0, verdict: "passed", stdout: "", stderr: "", exitCode: 0, timeMs: 5 }) + line({ type: "done", passed: 1, total: 1 }));
    expect(passing.result()).toMatchObject({ passed: 1, total: 1, failed: false });

    const broken = new TestsWatcher("a.cpp", 2);
    broken.feed(line({ type: "compiling" }) + line({ type: "compile-error", output: "a.cpp:3: error: expected ';'" }));
    expect(broken.result()).toEqual({ path: "a.cpp", passed: 0, total: 2, failed: true, compileError: "a.cpp:3: error: expected ';'", cases: [] });
  });

  it("says nothing when they didn't finish", () => {
    const watcher = new TestsWatcher("a.py", 2);
    watcher.feed(line({ type: "case", index: 0, verdict: "passed", stdout: "", stderr: "", exitCode: 0, timeMs: 5 }));
    expect(watcher.result()).toBeNull();
  });
});
