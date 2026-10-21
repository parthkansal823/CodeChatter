"use client";

import { toast } from "sonner";
import { create } from "zustand";

import { openRoomFile } from "@/components/room/editor/editor-opener";

/** The room's debug session, as the runner tells it (debug.ts). */
export type DebugSession = {
  language: string;
  path: string;
  /** The launch.json configuration it was started from, if any. */
  name: string | null;
  startedBy: string;
  state: "starting" | "running" | "stopped";
  stopped: { threadId?: number; reason?: string; description?: string; text?: string } | null;
  capabilities: Record<string, unknown> | null;
};

export type Frame = { id: number; name: string; line: number; column: number; path: string | null };
export type Variable = {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  evaluateName?: string;
};
export type Scope = { name: string; variablesReference: number; expensive: boolean };
export type ConsoleLine = {
  id: number;
  category: "stdout" | "stderr" | "console" | "input" | "result" | "error";
  text: string;
};

type Message = {
  seq?: number;
  type: string;
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: Record<string, unknown> | null;
};

type State = {
  connected: boolean;
  session: DebugSession | null;
  threadId: number | null;
  frames: Frame[];
  frameId: number | null;
  scopes: Scope[];
  /** Variables loaded so far, by their reference (a scope's or an expanded variable's). */
  children: Record<number, Variable[]>;
  watches: string[];
  /** The launch.json configuration Run and debug (and F5) starts; null for the open file. */
  configName: string | null;
  watchValues: Record<string, { value: string; failed: boolean }>;
  output: ConsoleLine[];
};

const MAX_OUTPUT_LINES = 2000;
const WATCHES_KEY = "cc-debug-watches";
const readWatches = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHES_KEY) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((w): w is string => typeof w === "string") : [];
  } catch {
    return [];
  }
};

export const useDebug = create<State>()(() => ({
  connected: false,
  session: null,
  threadId: null,
  frames: [],
  frameId: null,
  scopes: [],
  children: {},
  watches: [],
  watchValues: {},
  output: [],
  configName: null,
}));

/** Which pause (or frame) the variables on show belong to; answers for an older one are dropped. */
let current = 0;
const loading = new Set<number>();
function nextPause(): number {
  current += 1;
  loading.clear();
  return current;
}

const cleared = {
  threadId: null,
  frames: [],
  frameId: null,
  scopes: [],
  children: {},
  watchValues: {},
} satisfies Partial<State>;
/** Forget where the program was: it's running again, or the session ended. */
function resetPause(): void {
  nextPause();
  useDebug.setState(cleared);
}
/** The room path of an adapter's /workspace/... path; null for files outside the room (the standard library). */
const roomPath = (path: unknown) =>
  typeof path === "string" && path.startsWith("/workspace/") ? path.slice("/workspace/".length) : null;

let socket: WebSocket | null = null;
let roomOf: string | null = null;
let seq = 1;
let lineIds = 1;
let retry: ReturnType<typeof setTimeout> | null = null;
let reveal = false;
const pending = new Map<number, (message: Message) => void>();

function append(category: ConsoleLine["category"], text: string): void {
  if (!text) return;
  const output = [...useDebug.getState().output, { id: lineIds++, category, text }];
  useDebug.setState({ output: output.length > MAX_OUTPUT_LINES ? output.slice(-MAX_OUTPUT_LINES) : output });
}

/** A request to the adapter, through the runner; the answer is the adapter's response. */
export function request(command: string, args: Record<string, unknown> = {}): Promise<Message> {
  return new Promise((resolve) => {
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return resolve({ type: "response", success: false, message: "Not connected to the debugger." });
    const id = seq++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ seq: id, type: "request", command, arguments: args }));
  });
}

/**
 * Join the room's debugger: everyone in the room is connected while the room is open,
 * so a session anyone starts shows for everyone. Reconnects while the room stays open.
 */
export function connectDebugger(roomId: string): () => void {
  roomOf = roomId;
  useDebug.setState({ watches: readWatches() });
  const open = () => {
    if (roomOf !== roomId) return;
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws/debug?room=${roomId}`);
    socket = ws;
    ws.onopen = () => useDebug.setState({ connected: true });
    ws.onmessage = (event) => receive(JSON.parse(String(event.data)) as Message);
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      for (const resolve of pending.values())
        resolve({ type: "response", success: false, message: "The debugger connection closed." });
      pending.clear();
      useDebug.setState({ connected: false, session: null, ...cleared });
      if (roomOf === roomId) retry = setTimeout(open, 3000);
    };
  };
  open();
  return () => {
    roomOf = null;
    if (retry) clearTimeout(retry);
    socket?.close();
    socket = null;
    useDebug.setState({ connected: false, session: null, output: [], ...cleared });
  };
}

function receive(message: Message): void {
  if (message.type === "response" && typeof message.request_seq === "number") {
    const resolve = pending.get(message.request_seq);
    pending.delete(message.request_seq);
    resolve?.(message);
    return;
  }
  if (message.type === "cc") {
    if (message.event === "error")
      toast.error(
        String((message.body as { message?: string } | null)?.message ?? "The debugger couldn't do that."),
      );
    if (message.event === "session") {
      const session = (message.body ?? null) as DebugSession | null;
      const was = useDebug.getState().session;
      useDebug.setState({ session });
      if (!session) resetPause();
      // Someone joining a paused session, or a session that paused: find where.
      else if (session.state === "stopped" && session.stopped && (!was || was.state !== "stopped"))
        void loadStop(session.stopped.threadId ?? null);
      else if (session.state !== "stopped") resetPause();
    }
    return;
  }
  if (message.type !== "event") return;
  const body = (message.body ?? {}) as Record<string, unknown>;
  if (message.event === "output") {
    const category =
      body.category === "stderr"
        ? "stderr"
        : body.category === "console" || body.category === "important"
          ? "console"
          : "stdout";
    append(category, String(body.output ?? ""));
  } else if (message.event === "continued") {
    resetPause();
  } else if (message.event === "terminated") {
    append("console", "The program ended.\n");
  }
}

/** Where the program stopped: its threads' first, the stack, the top frame's variables; the file opens there. */
async function loadStop(threadId: number | null): Promise<void> {
  let thread = threadId;
  if (thread === null) {
    const threads = await request("threads");
    thread = ((threads.body?.threads as Array<{ id: number }> | undefined) ?? [])[0]?.id ?? null;
  }
  if (thread === null) return;
  const stack = await request("stackTrace", { threadId: thread, startFrame: 0, levels: 50 });
  const frames = (
    (stack.body?.stackFrames as
      | Array<{ id: number; name: string; line: number; column: number; source?: { path?: string } }>
      | undefined) ?? []
  ).map((frame): Frame => ({
    id: frame.id,
    name: frame.name,
    line: frame.line,
    column: frame.column,
    path: roomPath(frame.source?.path),
  }));
  useDebug.setState({ threadId: thread, frames });
  const top = frames.find((frame) => frame.path) ?? frames[0];
  if (top) await selectFrame(top.id);
}

/** Open the room's debug view's files where the program is, for people looking at it. */
export function setRevealOnStop(on: boolean): void {
  reveal = on;
}

export async function selectFrame(frameId: number): Promise<void> {
  const frame = useDebug.getState().frames.find((f) => f.id === frameId);
  const pause = nextPause();
  useDebug.setState({ frameId, scopes: [], children: {} });
  if (reveal && frame?.path)
    openRoomFile(frame.path, { startLine: frame.line, startColumn: 1, endLine: frame.line, endColumn: 1 });
  const scopes = await request("scopes", { frameId });
  if (pause !== current) return;
  const list = ((scopes.body?.scopes as Scope[] | undefined) ?? []).map((s) => ({
    name: s.name,
    variablesReference: s.variablesReference,
    expensive: Boolean(s.expensive),
  }));
  useDebug.setState({ scopes: list });
  const first = list.find((s) => !s.expensive);
  if (first) await loadChildren(first.variablesReference);
  await refreshWatches();
}

export async function loadChildren(reference: number): Promise<void> {
  if (!reference || useDebug.getState().children[reference] || loading.has(reference)) return;
  const pause = current;
  loading.add(reference);
  const answer = await request("variables", { variablesReference: reference });
  // Adapters reuse references from one pause to the next: an answer from an earlier one is stale.
  if (pause !== current) return;
  loading.delete(reference);
  const variables = (answer.body?.variables as Variable[] | undefined) ?? [];
  useDebug.setState((state) => ({ children: { ...state.children, [reference]: variables } }));
}

async function evaluate(
  expression: string,
  context: "watch" | "repl",
): Promise<{ value: string; failed: boolean }> {
  const { frameId } = useDebug.getState();
  const answer = await request("evaluate", { expression, context, ...(frameId !== null && { frameId }) });
  return answer.success === false
    ? { value: answer.message ?? "Couldn't evaluate it.", failed: true }
    : { value: String(answer.body?.result ?? ""), failed: false };
}

export async function refreshWatches(): Promise<void> {
  const { watches, session } = useDebug.getState();
  if (!session || session.state !== "stopped") return;
  const values = await Promise.all(watches.map(async (w) => [w, await evaluate(w, "watch")] as const));
  useDebug.setState({ watchValues: Object.fromEntries(values) });
}

export function setWatches(watches: string[]): void {
  useDebug.setState({ watches });
  try {
    localStorage.setItem(WATCHES_KEY, JSON.stringify(watches));
  } catch {
    // Storage blocked: the watches last for this visit.
  }
  void refreshWatches();
}

/** The debug console: an expression (or, for gdb, a command) in the selected frame. */
export async function consoleEvaluate(expression: string): Promise<void> {
  append("input", `${expression}\n`);
  const result = await evaluate(expression, "repl");
  append(result.failed ? "error" : "result", `${result.value}\n`);
}

export function clearConsole(): void {
  useDebug.setState({ output: [] });
}

/** Start debugging a file of the room; `stateVector` makes the sandbox wait for your latest edits. */
/** What to debug: a file, or a launch.json configuration's settings (the runner checks them). */
export type StartRequest = {
  path?: string;
  module?: string;
  name?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stopOnEntry?: boolean;
  justMyCode?: boolean;
};

export function startDebugging(start: StartRequest, stateVector: string): void {
  if (!socket || socket.readyState !== WebSocket.OPEN)
    return void toast.error("The debugger isn't connected yet. Try again in a moment.");
  useDebug.setState({ output: [] });
  socket.send(JSON.stringify({ type: "cc", command: "start", arguments: { ...start, stateVector } }));
}

export function stopDebugging(): void {
  socket?.send(JSON.stringify({ type: "cc", command: "stop" }));
}

/** Continue, step over (next), step into, step out, or pause, on the stopped thread. */
export async function step(command: "continue" | "next" | "stepIn" | "stepOut" | "pause"): Promise<void> {
  const { threadId, session } = useDebug.getState();
  if (!session) return;
  const thread =
    threadId ??
    (((await request("threads")).body?.threads as Array<{ id: number }> | undefined) ?? [])[0]?.id;
  if (thread === undefined) return;
  const answer = await request(command, { threadId: thread });
  if (answer.success === false) toast.error(answer.message ?? "The debugger couldn't do that.");
}

/** Files the debugger takes (the runner's debug.ts says the same). */
export const isDebuggable = (path: string) => /\.(py|c|cc|cpp|cxx)$/i.test(path);
