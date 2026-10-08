import { z } from "zod";

import { RoomCode } from "./rooms.js";

/**
 * Running code in the room's sandbox (apps/runner). One run at a time per
 * room, shared: everyone sees the same output, and starting a new run stops
 * the current one, like pressing Run again in an IDE.
 */

export type RunnableLanguage = { language: string; label: string };

// What the sandbox image can run, by file extension (commands: apps/runner/src/plans.ts).
const RUNNABLE: Record<string, RunnableLanguage> = {
  py: { language: "python", label: "Python" },
  js: { language: "javascript", label: "Node.js" },
  mjs: { language: "javascript", label: "Node.js" },
  cjs: { language: "javascript", label: "Node.js" },
  ts: { language: "typescript", label: "TypeScript" },
  mts: { language: "typescript", label: "TypeScript" },
  c: { language: "c", label: "C" },
  cpp: { language: "cpp", label: "C++" },
  cc: { language: "cpp", label: "C++" },
  cxx: { language: "cpp", label: "C++" },
  java: { language: "java", label: "Java" },
  sh: { language: "shell", label: "Bash" },
};

export function runnableLanguage(path: string): RunnableLanguage | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return RUNNABLE[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Workspace-relative path: no leading slash, no "..", no empty segments. */
export const WorkspacePath = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/") && p.split("/").every((s) => s !== "" && s !== "." && s !== ".."), "Invalid path.");

export const RunStartInput = z.object({
  roomId: RoomCode,
  path: WorkspacePath,
  /** The caller's Yjs state vector (base64). The sandbox waits until it has every edit in it, so a run never uses stale code. */
  stateVector: z.string().max(200_000).default(""),
});
export type RunStartInput = z.infer<typeof RunStartInput>;

export const RunStopInput = z.object({ roomId: RoomCode });

export const RunInput = z.object({
  roomId: RoomCode,
  runId: z.string().min(1).max(64),
  data: z.string().min(1).max(4096),
});
export type RunInput = z.infer<typeof RunInput>;

export type RunInfo = {
  id: string;
  roomId: string;
  path: string;
  /** What ran, as shown in the output header, e.g. "python3 main.py". */
  command: string;
  startedBy: { id: string; name: string };
  startedAt: string;
};

export type RunExitReason = "exit" | "stopped" | "timeout" | "output-limit" | "reset" | "error";

export type RunExit = {
  runId: string;
  code: number | null;
  reason: RunExitReason;
  durationMs: number;
  message?: string;
};

/** Current state for someone who opens the room mid-run (or after it). */
export type RunSnapshot = { run: RunInfo | null; output: string; exit: RunExit | null };

/** Newline-delimited JSON the runner streams back for one run (apps/runner → apps/api). */
export type RunnerEvent =
  | { type: "started"; run: RunInfo }
  | { type: "output"; runId: string; data: string }
  | { type: "exit"; exit: RunExit }
  | { type: "error"; message: string };

/**
 * Test cases for a file (competitive programming): run the program once per
 * case with the case's input, compare with the expected output.
 */
export const JudgeCase = z.object({
  input: z.string().max(256 * 1024),
  /** Missing = just show the output (custom input). */
  expected: z.string().max(256 * 1024).optional(),
});
export type JudgeCase = z.infer<typeof JudgeCase>;

export const JudgeInput = z.object({
  path: WorkspacePath,
  stateVector: z.string().max(200_000).default(""),
  cases: z.array(JudgeCase).min(1).max(30),
  timeLimitMs: z.number().int().min(500).max(20_000).default(2000),
});
export type JudgeInput = z.infer<typeof JudgeInput>;

export type JudgeVerdict = "passed" | "failed" | "error" | "timeout" | "ran";

/** Newline-delimited JSON streamed while tests run. */
export type JudgeEvent =
  | { type: "compiling" }
  | { type: "compile-error"; output: string }
  | { type: "case"; index: number; verdict: JudgeVerdict; stdout: string; stderr: string; exitCode: number | null; timeMs: number }
  | { type: "done"; passed: number; total: number }
  | { type: "error"; message: string };

/**
 * Terminal WebSocket (/ws/terminal?room=ID&n=1). Output arrives as binary
 * frames; everything else is small JSON text frames.
 */
export type TerminalClientMessage = { t: "in"; d: string } | { t: "resize"; cols: number; rows: number };
export type TerminalServerMessage = { t: "status"; state: "starting" | "ready" | "reset" | "closed"; message?: string };
