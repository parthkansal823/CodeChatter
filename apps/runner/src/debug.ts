import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";

import { breakpointLines, breakpointMap, findByPath, pathOf } from "@codechatter/workspace-model";
import WebSocket from "ws";
import { z } from "zod";

import { Collector, ended } from "./databases.js";
import { log, messageOf } from "./log.js";
import { frame, LspFrames } from "./lsp.js";
import { JAIL } from "./plans.js";
import type { RoomSession } from "./room-session.js";
import { exitCodeOnceEnded } from "./sandbox.js";

type Dap = { seq?: number; type: string; command?: string; event?: string; request_seq?: number; success?: boolean; message?: string; body?: Record<string, unknown>; arguments?: Record<string, unknown> };

type Debugger = {
  name: string;
  /** Files whose breakpoints this debugger takes. */
  sources: RegExp;
  /** The compiler, for languages that need a build first: from the file to `out`. */
  compile?: (file: string, out: string) => string[];
  adapter: string[];
  /** The adapter's `launch` arguments: `file` is the source, `program` what was built from it. */
  launch: (start: StartOptions, at: { file: string | null; cwd: string; program: string }) => Record<string, unknown>;
  /** Stop on these exceptions (the adapter's filter names). */
  exceptions: string[];
};

/** The debuggers in the sandbox: debugpy for Python, gdb's own DAP mode (gdb 14+) for C and C++. */
export const DEBUGGERS: Record<string, Debugger> = {
  python: {
    name: "debugpy",
    sources: /\.py$/i,
    adapter: ["python3", "-m", "debugpy.adapter"],
    // Unbuffered, so a print shows when it runs, not when the program ends.
    launch: (start, at) => ({
      type: "python",
      request: "launch",
      ...(start.module ? { module: start.module } : { program: at.file }),
      args: start.args,
      cwd: at.cwd,
      console: "internalConsole",
      justMyCode: start.justMyCode,
      stopOnEntry: start.stopOnEntry,
      env: { PYTHONUNBUFFERED: "1", ...start.env },
    }),
    exceptions: ["uncaught"],
  },
  c: {
    name: "gdb",
    sources: /\.(c|h)$/i,
    compile: (file, out) => ["gcc", "-g", "-O0", "-std=c17", file, "-o", out, "-lm"],
    adapter: ["gdb", "-i=dap", "-q"],
    launch: (start, at) => ({ program: at.program, args: start.args, cwd: at.cwd, env: start.env, stopAtBeginningOfMainSubprogram: start.stopOnEntry }),
    exceptions: [],
  },
  cpp: {
    name: "gdb",
    sources: /\.(cc|cpp|cxx|c\+\+|h|hh|hpp|hxx)$/i,
    compile: (file, out) => ["g++", "-g", "-O0", "-std=c++20", file, "-o", out],
    adapter: ["gdb", "-i=dap", "-q"],
    launch: (start, at) => ({ program: at.program, args: start.args, cwd: at.cwd, env: start.env, stopAtBeginningOfMainSubprogram: start.stopOnEntry }),
    exceptions: [],
  },
};

/** A path of the room's: relative, and staying inside it. */
const RoomPath = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => !path.startsWith("/") && !path.split("/").includes(".."), "That isn't a path in the room.");

/**
 * What to debug, from Run and debug: the open file, or a launch.json configuration (the
 * browser fills in its ${file} and the rest). A Python module runs with `-m`.
 */
const StartOptions = z
  .object({
    path: RoomPath.optional(),
    module: z.string().regex(/^[A-Za-z_][\w.]*$/, "That isn't a Python module name.").max(200).optional(),
    name: z.string().max(200).optional(),
    args: z.array(z.string().max(4000)).max(200).default([]),
    cwd: RoomPath.optional(),
    env: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "That isn't an environment variable's name."), z.string().max(8000))
      .refine((env) => Object.keys(env).length <= 100, "That's too many environment variables.")
      .default({}),
    stopOnEntry: z.boolean().default(false),
    justMyCode: z.boolean().default(true),
    stateVector: z.string().max(4_000_000).default(""),
  })
  .refine((start) => start.path || start.module, "Say which file (or Python module) to debug.");
export type StartOptions = z.infer<typeof StartOptions>;

/** Which debugger a file takes, by its extension. */
export function debuggerFor(path: string): string | null {
  if (/\.py$/i.test(path)) return "python";
  if (/\.c$/i.test(path)) return "c";
  if (/\.(cc|cpp|cxx|c\+\+)$/i.test(path)) return "cpp";
  return null;
}

/** What anyone in the room can ask of the session: reading where it is. */
const WATCH = new Set(["threads", "stackTrace", "scopes", "variables", "source", "exceptionInfo", "loadedSources"]);
/** What people who can run code can ask too: moving it, and running code in it. */
const DRIVE = new Set([...WATCH, "continue", "next", "stepIn", "stepOut", "pause", "evaluate", "setVariable", "setExpression", "completions", "stepBack", "goto"]);
/** Events nobody in the room needs (the adapter's own bookkeeping). */
const QUIET_EVENTS = new Set(["module", "loadedSource", "debugpySockets", "debugpyWaitingForServer", "process"]);

export type SessionInfo = {
  language: string;
  /** The file being debugged, or `python -m module`. */
  path: string;
  /** The launch.json configuration it came from, if any. */
  name: string | null;
  startedBy: string;
  state: "starting" | "running" | "stopped";
  /** The last `stopped` event's body while it's stopped, so someone who joins sees where. */
  stopped: Record<string, unknown> | null;
  capabilities: Record<string, unknown> | null;
};

type Client = { name: string; drive: boolean };

/**
 * The room's debugger (roadmap §14 A, the multiplayer debugger of §11): one session at a
 * time, shared by everyone in the room. The runner is the debug adapter's client: it
 * starts the session, sends the room's breakpoints (from the files document, as people
 * set them), and passes requests from the people watching to the adapter, each answer
 * back to whoever asked. Events (stopped, output, terminated) go to everyone. People who
 * can run code step and evaluate; the rest can only look.
 */
export class DebugHub {
  private readonly clients = new Map<WebSocket, Client>();
  private session: DebugSession | null = null;

  constructor(private readonly room: RoomSession) {}

  join(ws: WebSocket, client: Client): void {
    this.clients.set(ws, client);
    this.send(ws, { type: "cc", event: "session", body: this.session?.info ?? null });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.room.touch();
      let message: Dap;
      try {
        message = JSON.parse(data.toString()) as Dap;
      } catch {
        return;
      }
      void this.handle(ws, client, message).catch((error: unknown) => this.send(ws, { type: "cc", event: "error", body: { message: messageOf(error) } }));
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      // Nobody is watching: end it rather than leave a program paused in the sandbox.
      if (!this.clients.size) this.session?.stop();
    });
  }

  private async handle(ws: WebSocket, client: Client, message: Dap): Promise<void> {
    if (message.type === "cc") {
      if (!client.drive) return this.send(ws, { type: "cc", event: "error", body: { message: "You can watch this room's debugger but not start or stop it." } });
      if (message.command === "stop") return this.session?.stop();
      if (message.command === "start") {
        const start = StartOptions.safeParse(message.arguments ?? {});
        if (!start.success) return this.send(ws, { type: "cc", event: "error", body: { message: `That can't be debugged: ${start.error.issues[0]?.message ?? "the configuration isn't right"}` } });
        if (this.session) return this.send(ws, { type: "cc", event: "error", body: { message: `${this.session.info.startedBy} is debugging ${this.session.info.path}. Stop that first.` } });
        await this.start(start.data, client.name);
      }
      return;
    }
    if (message.type !== "request" || typeof message.command !== "string" || typeof message.seq !== "number") return;
    const refuse = (why: string) => this.send(ws, { type: "response", request_seq: message.seq, command: message.command, success: false, message: why });
    if (!this.session) return refuse("Nothing is being debugged.");
    if (!(client.drive ? DRIVE : WATCH).has(message.command)) return refuse(client.drive ? "The room's debugger doesn't take that request." : "You can watch this room's debugger but not control it.");
    this.session.forward(ws, message);
  }

  private async start(start: StartOptions, by: string): Promise<void> {
    const language = start.module ? "python" : debuggerFor(start.path!);
    if (!language) return this.broadcast({ type: "cc", event: "error", body: { message: "The debugger works on Python, C and C++ files." } });
    const session = new DebugSession(this.room, language, start, by, {
      broadcast: (message) => this.broadcast(message),
      send: (ws, message) => this.send(ws, message),
      changed: () => this.broadcast({ type: "cc", event: "session", body: this.session?.info ?? null }),
      ended: () => {
        if (this.session !== session) return;
        this.session = null;
        this.room.debugging = false;
        this.broadcast({ type: "cc", event: "session", body: null });
      },
    });
    this.session = session;
    this.room.debugging = true;
    this.broadcast({ type: "cc", event: "session", body: session.info });
    await session.start();
  }

  private send(ws: WebSocket, message: Dap | { type: "cc"; event: string; body: unknown }): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private broadcast(message: Dap | { type: "cc"; event: string; body: unknown }): void {
    for (const ws of this.clients.keys()) this.send(ws, message);
  }
}

type Hooks = {
  broadcast: (message: Dap | { type: "cc"; event: string; body: unknown }) => void;
  send: (ws: WebSocket, message: Dap) => void;
  changed: () => void;
  ended: () => void;
};

/** One debug adapter in the sandbox, inside the jail like a Run, with the runner as its client. */
class DebugSession {
  readonly info: SessionInfo;
  private readonly debuggerInfo: Debugger;
  private stream: NodeJS.ReadWriteStream & { destroyed?: boolean; destroy?: () => void } | null = null;
  private seq = 1;
  /** Requests waiting for their answer: the runner's own, or a person's (their socket and their seq). */
  private readonly pending = new Map<number, ((message: Dap) => void) | { ws: WebSocket; seq: number }>();
  private readonly waiting: Array<{ event: string; done: (message: Dap) => void }> = [];
  private readonly id = randomUUID().slice(0, 8);
  private stopping = false;
  private finished = false;
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly room: RoomSession,
    language: string,
    private readonly options: StartOptions,
    startedBy: string,
    private readonly hooks: Hooks,
  ) {
    this.debuggerInfo = DEBUGGERS[language]!;
    const path = options.module ? `python -m ${options.module}` : options.path!;
    this.info = { language, path, name: options.name ?? null, startedBy, state: "starting", stopped: null, capabilities: null };
  }

  private get pidFile() {
    return `/tmp/cc-debug-${this.id}.pid`;
  }

  async start(): Promise<void> {
    const { path, cwd: folder, stateVector } = this.options;
    try {
      await this.room.ready();
      const upToDate = await this.room.sync.waitFor(stateVector);
      await this.room.sync.flush();
      if (!upToDate) this.output("console", "Some of your latest edits hadn't reached the server; debugging what it has.\n");
      const doc = this.room.sync.doc;
      if (path && findByPath(doc, path)?.kind !== "file") throw new Error(`${path} isn't in the room.`);
      if (folder && findByPath(doc, folder)?.kind !== "folder") throw new Error(`The folder ${folder} (cwd) isn't in the room.`);
      const file = path ? `/workspace/${path}` : null;
      // The configuration's folder, else the file's, else the room's.
      const slash = path?.lastIndexOf("/") ?? -1;
      const cwd = folder ? `/workspace/${folder}` : path && slash !== -1 ? `/workspace/${path.slice(0, slash)}` : "/workspace";
      const program = `/tmp/cc-debug-${this.id}/program`;
      if (this.debuggerInfo.compile && file) await this.compile(this.debuggerInfo.compile(file, program), program);
      await this.launchAdapter(cwd);

      const initialized = this.nextEvent("initialized");
      const capabilities = await this.request("initialize", {
        clientID: "codechatter",
        clientName: "CodeChatter",
        adapterID: this.debuggerInfo.name,
        locale: "en",
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: "path",
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
      });
      this.info.capabilities = capabilities.body ?? {};
      const launched = this.request("launch", this.debuggerInfo.launch(this.options, { file, cwd, program }));
      await withTimeout(initialized, 30_000, `${this.debuggerInfo.name} didn't get ready.`);
      await this.sendAllBreakpoints();
      const filters = ((this.info.capabilities.exceptionBreakpointFilters as Array<{ filter: string }> | undefined) ?? []).map((f) => f.filter);
      if (filters.length) await this.request("setExceptionBreakpoints", { filters: this.debuggerInfo.exceptions.filter((f) => filters.includes(f)) });
      await this.request("configurationDone", {});
      const launch = await withTimeout(launched, 30_000, `${this.debuggerInfo.name} didn't start the program.`);
      if (launch.success === false) throw new Error(launch.message ?? "The program didn't start.");
      if (this.info.state === "starting") this.info.state = "running";
      this.hooks.changed();
      this.watchBreakpoints();
    } catch (error) {
      if (!this.finished) {
        this.output("stderr", `${messageOf(error)}\n`);
        this.stop();
      }
    }
  }

  /** Build the program with debug information; a compile error ends the session with the compiler's words. */
  private async compile(command: string[], program: string): Promise<void> {
    this.output("console", `Compiling ${this.info.path} with debug information…\n`);
    const script = `umask 002; mkdir -p "$(dirname "$1")"; shift; exec timeout 60 "$@"`;
    const handle = await this.room.sandbox.exec([JAIL, "sh", "-c", script, "cc-debug", program, ...command], { tty: false });
    const out = new Collector(64 * 1024);
    handle.demux(out, out);
    await ended(handle.stream);
    const code = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    if (code !== 0) throw new Error(`It didn't compile:\n${out.text().trim().split("\n").slice(0, 30).join("\n")}`);
  }

  private async launchAdapter(cwd: string): Promise<void> {
    const script = `umask 002; echo $$ > ${this.pidFile}; cd "$1"; shift; exec "$@"`;
    const handle = await this.room.sandbox.exec([JAIL, "sh", "-c", script, "cc-debug", cwd, ...this.debuggerInfo.adapter], { tty: false, stdin: true });
    this.stream = handle.stream;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    handle.demux(stdout, stderr);
    const frames = new LspFrames((json) => this.receive(json));
    stdout.on("data", (chunk: Buffer) => frames.push(chunk));
    // Its stderr is its own chatter; what matters reaches people as output events.
    stderr.resume();
    const end = () => this.finish();
    handle.stream.on("end", end);
    handle.stream.on("close", end);
    handle.stream.on("error", end);
  }

  private write(message: Dap): void {
    if (this.stream && !this.stream.destroyed) this.stream.write(frame(JSON.stringify(message)));
  }

  private request(command: string, args: Record<string, unknown>): Promise<Dap> {
    const seq = this.seq++;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.write({ seq, type: "request", command, arguments: args });
    });
  }

  private nextEvent(event: string): Promise<Dap> {
    return new Promise((done) => this.waiting.push({ event, done }));
  }

  /** A person's request, under the runner's own numbering; the answer goes back to them with theirs. */
  forward(ws: WebSocket, message: Dap): void {
    const seq = this.seq++;
    this.pending.set(seq, { ws, seq: message.seq! });
    this.write({ ...message, seq });
  }

  private receive(json: string): void {
    let message: Dap;
    try {
      message = JSON.parse(json) as Dap;
    } catch {
      return;
    }
    if (message.type === "response" && typeof message.request_seq === "number") {
      const waiter = this.pending.get(message.request_seq);
      this.pending.delete(message.request_seq);
      if (typeof waiter === "function") waiter(message);
      else if (waiter) this.hooks.send(waiter.ws, { ...message, request_seq: waiter.seq });
      return;
    }
    if (message.type === "request") {
      // Reverse requests (runInTerminal, startDebugging): the room doesn't offer them.
      this.write({ seq: this.seq++, type: "response", request_seq: message.seq, command: message.command, success: false, message: "Not supported." });
      return;
    }
    if (message.type !== "event" || !message.event) return;
    for (const waiter of this.waiting.filter((w) => w.event === message.event)) {
      this.waiting.splice(this.waiting.indexOf(waiter), 1);
      waiter.done(message);
    }
    if (message.event === "stopped") {
      this.info.state = "stopped";
      this.info.stopped = message.body ?? {};
      this.hooks.changed();
    } else if (message.event === "continued") {
      this.info.state = "running";
      this.info.stopped = null;
      this.hooks.changed();
    }
    if (message.event === "output") {
      const body = (message.body ?? {}) as { category?: string; output?: string };
      if (body.category === "telemetry") return;
      // gdb's notes on breakpoints set before the program loads; they resolve when it does.
      if (/^(No source file named .*\.|Breakpoint \d+ \(.*\) pending\.)\n?$/.test(body.output ?? "")) return;
    }
    if (QUIET_EVENTS.has(message.event)) return;
    this.hooks.broadcast(message);
    if (message.event === "terminated") this.stop();
  }

  private output(category: "console" | "stderr", text: string): void {
    this.hooks.broadcast({ type: "event", event: "output", body: { category, output: text } });
  }

  /** The room's breakpoints for this debugger's files, as they are in the files document. */
  private async sendAllBreakpoints(): Promise<void> {
    const doc = this.room.sync.doc;
    await Promise.all([...breakpointMap(doc).keys()].map((fileId) => this.sendBreakpoints(fileId)));
  }

  private async sendBreakpoints(fileId: string): Promise<void> {
    const path = pathOf(this.room.sync.doc, fileId);
    if (!path || !this.debuggerInfo.sources.test(path)) return;
    const lines = breakpointLines(this.room.sync.doc, fileId);
    const answer = await this.request("setBreakpoints", { source: { path: `/workspace/${path}` }, breakpoints: lines.map((line) => ({ line })), lines });
    this.hooks.broadcast({ type: "cc", event: "breakpoints", body: { fileId, breakpoints: answer.body?.breakpoints ?? [] } });
  }

  /** Breakpoints set or cleared while it runs reach the adapter at once. */
  private watchBreakpoints(): void {
    const map = breakpointMap(this.room.sync.doc);
    const handler = (events: Array<{ path: Array<string | number>; target: unknown; keysChanged?: Set<string> }>) => {
      const fileIds = new Set<string>();
      for (const event of events) {
        const first = event.path[0];
        if (typeof first === "string") fileIds.add(first);
        else for (const key of event.keysChanged ?? []) fileIds.add(key);
      }
      for (const fileId of fileIds) void this.sendBreakpoints(fileId).catch(() => {});
    };
    map.observeDeep(handler as Parameters<typeof map.observeDeep>[0]);
    this.unwatch = () => map.unobserveDeep(handler as Parameters<typeof map.observeDeep>[0]);
  }

  /** End the session: ask the adapter to end the program, then make sure. */
  stop(): void {
    if (this.stopping) return;
    this.stopping = true;
    this.unwatch?.();
    this.write({ seq: this.seq++, type: "request", command: "disconnect", arguments: { terminateDebuggee: true } });
    void this.room.sandbox
      .exec(["sh", "-c", `sleep 1; kill "$(cat ${this.pidFile})" 2>/dev/null; rm -rf ${this.pidFile} /tmp/cc-debug-${this.id}; true`], { tty: false })
      .then((killer) => killer.stream.resume())
      .catch((error: unknown) => log.warn(`debugger: stopping it failed: ${messageOf(error)}`))
      .finally(() => {
        this.stream?.destroy?.();
        this.finish();
      });
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.unwatch?.();
    for (const waiter of this.pending.values()) if (typeof waiter === "function") waiter({ type: "response", success: false, message: "The debugger stopped." });
    this.pending.clear();
    for (const waiter of this.waiting.splice(0)) waiter.done({ type: "event", event: waiter.event });
    this.hooks.ended();
    if (!this.stopping) this.stop();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
