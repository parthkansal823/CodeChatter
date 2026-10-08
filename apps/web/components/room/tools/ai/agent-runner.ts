"use client";

import { AI_LIMITS, type AgentAction, type JudgeEvent, type RunExit } from "@codechatter/contracts";
import { findByPath, textOf } from "@codechatter/workspace-model";
import * as Y from "yjs";

import type { useRun } from "@/components/room/run-context";

import type { StepState } from "./history";

type Run = ReturnType<typeof useRun>;
export type ActionStep = { index: number; action: AgentAction };

// Terminal colour and cursor codes. The runner's output is raw terminal data.
const ESCAPES = /\u001b\[[0-9;?]*[ -\/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Terminal output as plain text: no colours, and a redrawn progress line keeps only its last state. */
export function plainText(raw: string): string {
  return raw
    .replace(ESCAPES, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
}

const tail = (text: string, max: number) => (text.length <= max ? text : `… ${text.slice(text.length - max)}`);
const oneLine = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export const isDecided = (step: StepState | undefined): boolean => step?.state === "done" || step?.state === "failed" || step?.state === "skipped";

const fileText = (doc: Y.Doc, path: string): string | undefined => {
  const node = findByPath(doc, path);
  return node?.kind === "file" ? textOf(doc, node.id)?.toString() : undefined;
};

export function readStep(doc: Y.Doc, path: string): StepState {
  const text = fileText(doc, path);
  if (text === undefined) return { state: "failed", note: `Read ${path}: the file doesn't exist` };
  return { state: "done", note: `Read ${path} (${text.split("\n").length} lines, attached below)` };
}

/** Contents of the files the person let the agent read, in the shape the chat request carries them. */
export function filesToAttach(doc: Y.Doc, paths: string[]): Array<{ path: string; text: string }> {
  return paths.slice(0, AI_LIMITS.extraFiles).flatMap((path) => {
    const text = fileText(doc, path);
    return text === undefined ? [] : [{ path, text: text.slice(0, AI_LIMITS.extraFileChars) }];
  });
}

function exitNote(exit: RunExit, path: string): string {
  switch (exit.reason) {
    case "exit":
      return `Ran ${path}: exit code ${exit.code ?? "unknown"}`;
    case "timeout":
      return `Ran ${path}: stopped at the time limit`;
    case "output-limit":
      return `Ran ${path}: stopped for printing too much`;
    case "stopped":
      return `Ran ${path}: stopped by a person in the room`;
    default:
      return `Ran ${path}: ${exit.message ?? "the run failed"}`;
  }
}

const RUN_GUARD_MS = 120_000;

/** Press Run on a file and wait for its end, collecting the output. Anyone else's run in the room shows the same way. */
export function runStep(run: Run, path: string): Promise<StepState> {
  return new Promise((resolve) => {
    const previous = run.run?.id ?? null;
    let ownId: string | null = null;
    let output = "";
    let unsubscribe = () => {};
    const timer = setTimeout(() => finish({ state: "failed", note: `${path} didn't finish within 2 minutes` }), RUN_GUARD_MS);
    const finish = (state: StepState) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    };
    // Subscribing replays the previous run first; only a run that starts after this point is ours.
    unsubscribe = run.subscribe((event) => {
      if (event.kind === "reset") {
        ownId = event.run.id === previous ? null : event.run.id;
        output = "";
      } else if (event.kind === "data") {
        if (ownId) output += event.data;
      } else if (ownId && event.exit.runId === ownId) {
        finish({ state: "done", note: exitNote(event.exit, path), detail: tail(plainText(output).trim(), 3000) });
      }
    });
    void run.start(path).then((started) => {
      if (!started) finish({ state: "failed", note: `Couldn't start ${path}. The runner may be busy or the file type can't run.` });
    });
  });
}

type SavedCase = { input: string; expected: string };

/** Run the file's saved test cases (the Tests tab keeps them in the room's files document) through the judge. */
export async function testStep(doc: Y.Doc, roomId: string, path: string): Promise<StepState> {
  const node = findByPath(doc, path);
  if (!node || node.kind !== "file") return { state: "failed", note: `Tests for ${path}: the file doesn't exist` };
  const saved = doc.getMap<Y.Array<Y.Map<string>>>("tests").get(node.id)?.toArray() ?? [];
  const cases: SavedCase[] = saved.map((m) => ({ input: m.get("input") ?? "", expected: m.get("expected") ?? "" }));
  if (cases.length === 0) return { state: "done", note: `${path} has no saved test cases. Cases can be added in the Tests tab.` };

  let response: Response;
  try {
    response = await fetch(`/api/rooms/${roomId}/judge`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, stateVector: btoa(String.fromCharCode(...Y.encodeStateVector(doc))), cases }),
    });
  } catch {
    return { state: "failed", note: `Tests for ${path}: couldn't reach the server` };
  }
  if (!response.ok || !response.body) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    return { state: "failed", note: `Tests for ${path}: ${problem?.detail ?? "they couldn't start"}` };
  }

  const events: JudgeEvent[] = [];
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) events.push(JSON.parse(line) as JudgeEvent);
    }
  }

  const compile = events.find((e) => e.type === "compile-error");
  if (compile) return { state: "done", note: `Tests for ${path}: it doesn't compile`, detail: tail(plainText(compile.output).trim(), 3000) };
  const failure = events.find((e) => e.type === "error");
  if (failure) return { state: "failed", note: `Tests for ${path}: ${failure.message}` };
  const done = events.find((e) => e.type === "done");
  const problems = events.flatMap((e) =>
    e.type === "case" && e.verdict !== "passed"
      ? [
          `case ${e.index + 1}: ${e.verdict}. input: ${oneLine(cases[e.index]?.input ?? "")} | expected: ${oneLine(cases[e.index]?.expected ?? "")} | got: ${oneLine(e.stdout)}${e.stderr ? ` | error: ${oneLine(e.stderr)}` : ""}`,
        ]
      : [],
  );
  return {
    state: "done",
    note: `Tests for ${path}: ${done ? `${done.passed} of ${done.total} passed` : "didn't finish"}`,
    ...(problems.length > 0 && { detail: problems.slice(0, 6).join("\n") }),
  };
}

/** What happened to each approved or skipped step, as the AI's next message. */
export function resultsMessage(steps: ActionStep[], states: Record<number, StepState>): string {
  const lines = steps.map(({ index, action }) => {
    const state = states[index];
    const outcome = state?.state === "skipped" ? `skipped by the person${state.note && !state.note.startsWith("You") ? `: ${state.note}` : ""}` : (state?.note ?? state?.state ?? "no result");
    const head = `${action.kind} ${action.path}: ${outcome}`;
    return state?.detail ? `${head}\n<output>\n${state.detail}\n</output>` : head;
  });
  const message = `<results>\n${lines.join("\n")}\n</results>`;
  return message.length > AI_LIMITS.messageChars - 500 ? `${message.slice(0, AI_LIMITS.messageChars - 600)}\n… (results trimmed)\n</results>` : message;
}

/** Files whose read the person allowed: their content goes along with the results. */
export const readPaths = (steps: ActionStep[], states: Record<number, StepState>): string[] =>
  steps.flatMap(({ index, action }) => (action.kind === "read" && states[index]?.state === "done" ? [action.path] : []));
