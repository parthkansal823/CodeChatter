/**
 * Room events for automations from what people do in a room rather than its audit log (packages/contracts/src/room-events.ts): a Run ending, the Tests tab's
 * tests, a chat message, and commits in the sandbox (from the runner). Each is queued in Valkey for AutomationTriggersService.drain, which runs the flows
 * listening for it; the queue is kept to its last 1,000.
 */
import { ROOM_EVENTS_QUEUE, type JudgeEvent, type QueuedRoomEvent, type RunEventData, type RunExit, type RunInfo, type TestsEventData } from "@codechatter/contracts";
import type { Redis } from "ioredis";

export async function queueRoomEvent(redis: Redis, event: QueuedRoomEvent): Promise<void> {
  await redis.multi().rpush(ROOM_EVENTS_QUEUE, JSON.stringify(event)).ltrim(ROOM_EVENTS_QUEUE, -1000, -1).exec();
}

const RUN_OUTPUT = 4000;
const CASE_OUTPUT = 1000;
// Colours, cursor moves and window titles: what a terminal reads, not what a flow wants.
// eslint-disable-next-line no-control-regex
const TERMINAL_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-Za-z]|\u001b[=>78]/g;

/** The end of what was printed, as text: its last `most` characters, without a terminal's codes. */
export function plainTail(output: string, most: number): string {
  const plain = output.slice(-most * 2).replace(TERMINAL_CODES, "").replace(/\r\n/g, "\n");
  return plain.slice(-most);
}

/** Whether a Run failed: an error, out of time, too much output, or the sandbox failing it. Stopped by a person, or by a restart, isn't failing. */
export const runFailed = (exit: RunExit): boolean => (exit.reason === "exit" ? exit.code !== 0 : exit.reason === "timeout" || exit.reason === "output-limit" || exit.reason === "error");

/** A Run that ended, as the room event "run.finished" (and "run.failed" when it failed). */
export function runEventOf(roomId: string, run: RunInfo, exit: RunExit, output: string): QueuedRoomEvent {
  const data: RunEventData = { path: run.path, command: run.command, runId: run.id, code: exit.code, reason: exit.reason, durationMs: exit.durationMs, failed: runFailed(exit), output: plainTail(output, RUN_OUTPUT) };
  return { room: roomId, event: "run.finished", at: Date.now(), by: [{ id: run.startedBy.id, name: run.startedBy.name }], data };
}

/** Reads the Tests tab's stream as it goes past (one JSON line per event) and says what happened, once it has. */
export class TestsWatcher {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private readonly cases: TestsEventData["cases"] = [];
  private compileError: string | undefined;
  private error: string | undefined;
  private done: { passed: number; total: number } | undefined;

  constructor(
    private readonly path: string,
    private readonly asked: number,
  ) {}

  feed(chunk: string | Uint8Array): void {
    // The runner's stream is bytes: a character can be split between two of them.
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    for (let newline = this.buffer.indexOf("\n"); newline !== -1; newline = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.read(line);
    }
    // A runaway line isn't one of the judge's.
    if (this.buffer.length > 4 * 1024 * 1024) this.buffer = "";
  }

  private read(line: string): void {
    let event: JudgeEvent;
    try {
      event = JSON.parse(line) as JudgeEvent;
    } catch {
      return;
    }
    if (event.type === "case" && this.cases.length < 30)
      this.cases.push({ index: event.index, verdict: event.verdict, timeMs: event.timeMs, stdout: plainTail(event.stdout ?? "", CASE_OUTPUT), stderr: plainTail(event.stderr ?? "", CASE_OUTPUT) });
    else if (event.type === "compile-error") this.compileError = plainTail(event.output ?? "", RUN_OUTPUT);
    else if (event.type === "error") this.error = String(event.message ?? "");
    else if (event.type === "done") this.done = { passed: event.passed, total: event.total };
  }

  /** What the tests came to, or null when they didn't finish (the person went away first). */
  result(): TestsEventData | null {
    if (!this.done && this.compileError === undefined && this.error === undefined) return null;
    const passed = this.done?.passed ?? this.cases.filter((each) => each.verdict === "passed").length;
    const failed = this.compileError !== undefined || this.error !== undefined || this.cases.some((each) => each.verdict === "failed" || each.verdict === "error" || each.verdict === "timeout");
    return {
      path: this.path,
      passed,
      total: this.done?.total ?? this.asked,
      failed,
      ...(this.compileError !== undefined && { compileError: this.compileError }),
      ...(this.error !== undefined && { error: this.error }),
      cases: this.cases,
    };
  }
}
