import type { RunExit, RunExitReason, RunInfo, RunnerEvent, RunSnapshot } from "@codechatter/contracts";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";

import { log } from "./log.js";
import { commandFor, planFor } from "./plans.js";
import type { ExecHandle, Sandbox } from "./sandbox.js";

const OUTPUT_LIMIT = 2 * 1024 * 1024; // per run; then the run is stopped
const SNAPSHOT_BYTES = 64 * 1024; // kept for people who open the room mid-run
const FLUSH_MS = 25; // output is sent in small batches, not per write()

type Active = {
  info: RunInfo;
  handle: ExecHandle;
  startedAt: number;
  bytes: number;
  stopReason: RunExitReason | null;
  done: Promise<RunExit>;
  timeout: NodeJS.Timeout;
};

export class RunError extends Error {}

/**
 * The room's runs: one at a time, shared by everyone in the room. Starting a
 * new run stops the current one (like pressing Run again in an IDE).
 */
export class RunManager {
  private active: Active | null = null;
  private last: { info: RunInfo; output: string; exit: RunExit | null } | null = null;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly timeoutMs: number,
  ) {}

  get running(): boolean {
    return this.active !== null;
  }

  snapshot(): RunSnapshot {
    return { run: this.last?.info ?? null, output: this.last?.output ?? "", exit: this.last?.exit ?? null };
  }

  /**
   * Start a run and stream its events. `prepare` brings the sandbox's files
   * up to date first (the state-vector barrier); it runs after the previous
   * run has stopped, so the new one never overlaps it.
   */
  async start(
    request: { roomId: string; path: string; user: { id: string; name: string } },
    prepare: () => Promise<{ fileExists: boolean }>,
    emit: (event: RunnerEvent) => void,
  ): Promise<RunExit> {
    const plan = planFor(request.path);
    if (!plan) throw new RunError(`CodeChatter can't run ${request.path} yet. Supported: Python, JavaScript, TypeScript, C, C++, Java, Bash.`);
    if (this.active) await this.stop("stopped");

    const { fileExists } = await prepare();
    if (!fileExists) throw new RunError(`${request.path} doesn't exist any more.`);

    const id = randomUUID().slice(0, 8);
    const info: RunInfo = {
      id,
      roomId: request.roomId,
      path: request.path,
      command: plan.display,
      startedBy: request.user,
      startedAt: new Date().toISOString(),
    };
    const handle = await this.sandbox.exec(commandFor(plan, request.path, id), { tty: true, cols: 120, rows: 30 });
    this.last = { info, output: "", exit: null };
    emit({ type: "started", run: info });

    let resolveDone!: (exit: RunExit) => void;
    const active: Active = {
      info,
      handle,
      startedAt: Date.now(),
      bytes: 0,
      stopReason: null,
      done: new Promise((resolve) => (resolveDone = resolve)),
      timeout: setTimeout(() => void this.stop("timeout"), this.timeoutMs),
    };
    this.active = active;
    this.pump(active, handle.stream, emit, resolveDone);
    return active.done;
  }

  /** Keystrokes for the running program. Only the person who started it may type. */
  input(runId: string, userId: string, data: string): boolean {
    const active = this.active;
    if (!active || active.info.id !== runId || active.info.startedBy.id !== userId) return false;
    active.handle.stream.write(data);
    return true;
  }

  /** Ctrl-C first (programs can clean up), then kill the process group, then give up on it. */
  async stop(reason: RunExitReason = "stopped"): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.stopReason ??= reason;
    active.handle.stream.write("\x03");
    if (await settlesWithin(active.done, 1500)) return;

    const pidFile = `/tmp/cc-run-${active.info.id}.pid`;
    try {
      const killer = await this.sandbox.exec(["sh", "-c", `kill -KILL -- -"$(cat ${pidFile})" 2>/dev/null; kill -KILL "$(cat ${pidFile})" 2>/dev/null; true`], { tty: false });
      killer.stream.resume();
    } catch (error) {
      // Can't even exec: the sandbox is out of processes. Restart it.
      log.warn(`stop via kill failed (${String(error)}); resetting the sandbox`);
      active.stopReason = "reset";
      await this.sandbox.reset().catch((e) => log.error("sandbox reset failed", e));
    }
    if (!(await settlesWithin(active.done, 1500))) active.handle.stream.destroy();
    await settlesWithin(active.done, 1000);
  }

  private pump(active: Active, stream: Duplex, emit: (event: RunnerEvent) => void, resolveDone: (exit: RunExit) => void): void {
    const decoder = new TextDecoder("utf-8");
    let pending = "";
    let timer: NodeJS.Timeout | null = null;

    const flush = () => {
      timer = null;
      if (!pending) return;
      emit({ type: "output", runId: active.info.id, data: pending });
      if (this.last?.info.id === active.info.id) this.last.output = (this.last.output + pending).slice(-SNAPSHOT_BYTES);
      pending = "";
    };

    stream.on("data", (chunk: Buffer) => {
      if (active.bytes > OUTPUT_LIMIT) return;
      active.bytes += chunk.length;
      pending += decoder.decode(chunk, { stream: true });
      if (active.bytes > OUTPUT_LIMIT) {
        pending += "\r\n\x1b[33m[CodeChatter] Output limit reached (2 MB). Stopping the run.\x1b[0m\r\n";
        void this.stop("output-limit");
      }
      if (pending.length > 16_384) flush();
      else timer ??= setTimeout(flush, FLUSH_MS);
    });

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      pending += decoder.decode();
      flush();
      clearTimeout(active.timeout);
      const inspect = await active.handle.exec.inspect().catch(() => null);
      const code = inspect && !inspect.Running ? inspect.ExitCode : null;
      const output = this.last?.info.id === active.info.id ? this.last.output : "";
      const exhausted = code !== null && code >= 126 && /Resource temporarily unavailable|unable to start container process/i.test(output);
      const exit: RunExit = {
        runId: active.info.id,
        code,
        reason: exhausted ? "reset" : (active.stopReason ?? "exit"),
        durationMs: Date.now() - active.startedAt,
        ...(exhausted && { message: "The sandbox ran out of processes and was restarted." }),
      };
      if (exhausted) await this.sandbox.reset().catch((e) => log.error("sandbox reset failed", e));
      if (this.last?.info.id === active.info.id) this.last.exit = exit;
      if (this.active === active) this.active = null;
      emit({ type: "exit", exit });
      resolveDone(exit);
    };
    stream.on("end", () => void finish());
    stream.on("close", () => void finish());
    stream.on("error", () => void finish());
  }
}

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);
}
