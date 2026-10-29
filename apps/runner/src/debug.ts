import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";

import { breakpointLines, breakpointMap, findByPath, listTree, pathOf, type TreeNode } from "@codechatter/workspace-model";
import WebSocket from "ws";
import type * as Y from "yjs";
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
  /** The compiler, for languages that need a build first: from the file (or Go package folder) to `out`. */
  compile?: (file: string, out: string) => string[];
  /** How long a build may take (60 seconds unless said). */
  compileSeconds?: number;
  /** Commands (or files) the sandbox must have, and what to say when it hasn't: only the full image has some. */
  needs?: { have: string[]; missing: string };
  /** The adapter's command, or one made for the file being debugged. */
  adapter: string[] | ((file: string | null) => string[]);
  /** How long it may take to get ready and start the program (30 seconds unless said). */
  readySeconds?: number;
  /** The adapter's `launch` arguments: `file` is the source, `program` what was built from it. */
  launch: (start: StartOptions, at: { file: string | null; cwd: string; program: string }) => Record<string, unknown>;
  /** Stop on these exceptions (the adapter's filter names). */
  exceptions: string[];
  /** Where "stop on entry" stops, as a function breakpoint, for adapters whose own entry is before any source. */
  entryFunction?: string;
};

/**
 * Delve only serves the Debug Adapter Protocol on a TCP port, so this runs it on a free
 * one and passes stdin and stdout through, as the other adapters talk. Delve's own
 * chatter goes to stderr, which nobody reads.
 */
const DELVE_BRIDGE = `
import os, re, socket, subprocess, sys, threading
dlv = subprocess.Popen(["dlv", "dap", "--listen=127.0.0.1:0"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
port = None
for line in dlv.stdout:
    found = re.search(rb"listening at: \\S*:(\\d+)", line)
    if found:
        port = int(found.group(1))
        break
if port is None:
    sys.exit(1)
threading.Thread(target=lambda: [sys.stderr.buffer.write(line) for line in dlv.stdout], daemon=True).start()
sock = socket.create_connection(("127.0.0.1", port))
def upstream():
    while True:
        data = os.read(0, 65536)
        if not data:
            break
        sock.sendall(data)
    try:
        sock.shutdown(socket.SHUT_WR)
    except OSError:
        pass
threading.Thread(target=upstream, daemon=True).start()
while True:
    data = sock.recv(65536)
    if not data:
        break
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
dlv.wait()
`;

/**
 * Go's build for Delve, with optimisations and inlining off: a folder is a package, and a
 * file builds its folder's package when it's in a module (other files of the package
 * with it), else on its own.
 */
const GO_BUILD = `if [ -d "$1" ]; then cd "$1" && set -- . "$2"; else cd "$(dirname "$1")" || exit 1; case "$(go env GOMOD)" in ""|/dev/null) ;; *) set -- . "$2" ;; esac; fi
exec go build -gcflags='all=-N -l' -o "$2" "$1"`;

const JS_DEBUG_BRIDGE = "/usr/local/lib/codechatter/js-debug-bridge.mjs";

/** java-debug's plugin for JDT LS, from the full image (sandbox/image/Dockerfile). */
const JAVA_DEBUG_PLUGIN = "/usr/local/lib/java-debug/com.microsoft.java.debug.plugin.jar";

/**
 * java-debug runs inside JDT LS, Java's language server: this starts one (sandbox/image/jdtls)
 * with the plugin, waits until it's ready, asks it for a debug server, and passes the Debug
 * Adapter Protocol through stdin and stdout as the other adapters talk. The launch request's
 * `mainFile` becomes `mainClass`, from the file's package and name. The language server's
 * own requests get empty answers; its chatter goes nowhere.
 */
const JAVA_DEBUG_BRIDGE = String.raw`
import json, os, re, signal, socket, subprocess, sys, threading

PLUGIN, SOURCE = sys.argv[1], sys.argv[2]

def source_root(path, text):
    """The folder the file's package starts in (where javac's -sourcepath points too)."""
    root = os.path.dirname(path)
    package = re.search(r"^\s*package\s+([\w.]+)\s*;", text, re.M)
    for _ in (package.group(1).split(".") if package else []):
        root = os.path.dirname(root)
    return root

with open(SOURCE, encoding="utf-8", errors="replace") as handle:
    SOURCE_TEXT = handle.read()
ROOT = source_root(SOURCE, SOURCE_TEXT)

def frame(message):
    body = json.dumps(message).encode()
    return b"Content-Length: %d\r\n\r\n" % len(body) + body

def messages(read):
    buffer = b""
    while True:
        while b"\r\n\r\n" not in buffer:
            chunk = read()
            if not chunk:
                return
            buffer += chunk
        head, buffer = buffer.split(b"\r\n\r\n", 1)
        length = int(re.search(rb"content-length:\s*(\d+)", head, re.I).group(1))
        while len(buffer) < length:
            chunk = read()
            if not chunk:
                return
            buffer += chunk
        body, buffer = buffer[:length], buffer[length:]
        yield json.loads(body)

server = subprocess.Popen(["jdtls"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=ROOT)
# Stopping the session stops this bridge; the language server goes with it.
signal.signal(signal.SIGTERM, lambda *_: (server.kill(), os._exit(0)))
waiting, ready, lock, ids = {}, threading.Event(), threading.Lock(), iter(range(1, 1 << 30))

def tell(message):
    with lock:
        server.stdin.write(frame(message))
        server.stdin.flush()

def ask(method, params):
    number, done = next(ids), threading.Event()
    waiting[number] = [done, None]
    tell({"jsonrpc": "2.0", "id": number, "method": method, "params": params})
    done.wait(240)
    return waiting.pop(number)[1] or {}

def listen():
    for message in messages(lambda: server.stdout.read1(65536)):
        if "method" in message and "id" in message:
            tell({"jsonrpc": "2.0", "id": message["id"], "result": [] if message["method"] == "workspace/configuration" else None})
        elif "id" in message and message["id"] in waiting:
            waiting[message["id"]][1] = message
            waiting[message["id"]][0].set()
        elif message.get("method") == "language/status" and message.get("params", {}).get("type") == "ServiceReady":
            ready.set()
    os._exit(0)

threading.Thread(target=listen, daemon=True).start()
ask("initialize", {
    "processId": os.getpid(),
    "rootUri": "file://" + ROOT,
    "capabilities": {"workspace": {"executeCommand": {}}},
    "initializationOptions": {
        "bundles": [PLUGIN],
        # Its project's sources start at the root (its own guess is the file's folder, whatever the package).
        "settings": {"java": {
            "configuration": {"runtimes": [{"name": "JavaSE-21", "path": "/usr/lib/jvm/java-21-openjdk-amd64", "default": True}]},
            "project": {"sourcePaths": ["."]},
        }},
    },
})
tell({"jsonrpc": "2.0", "method": "initialized", "params": {}})
ready.wait(240)
port = ask("workspace/executeCommand", {"command": "vscode.java.startDebugSession", "arguments": []}).get("result")
if not isinstance(port, int):
    sys.stderr.write("java-debug didn't start\n")
    server.kill()
    sys.exit(1)
adapter = socket.create_connection(("127.0.0.1", port))

def project_of(source):
    """The language server's project for the file, and its main class as the project sees it:
    java-debug needs the project to find sources for the stack and to evaluate expressions.
    Opening the file is what makes a project for a loose one."""
    tell({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {"uri": "file://" + source, "languageId": "java", "version": 1, "text": SOURCE_TEXT}}})
    for _ in range(20):
        for entry in ask("workspace/executeCommand", {"command": "vscode.java.resolveMainClass", "arguments": []}).get("result") or []:
            if os.path.realpath(entry.get("filePath") or "") == os.path.realpath(source) and entry.get("projectName"):
                return entry["projectName"], entry.get("mainClass")
        threading.Event().wait(1)
    return None, None

def upstream():
    for message in messages(lambda: os.read(0, 65536)):
        if message.get("type") == "request" and message.get("command") == "launch":
            arguments = message.setdefault("arguments", {})
            source = arguments.pop("mainFile", None)
            if source:
                package = re.search(r"^\s*package\s+([\w.]+)\s*;", SOURCE_TEXT, re.M)
                name = os.path.splitext(os.path.basename(source))[0]
                arguments.setdefault("mainClass", (package.group(1) + "." if package else "") + name)
                project, _ = project_of(source)
                if project:
                    arguments.setdefault("projectName", project)
        adapter.sendall(frame(message))
    try:
        adapter.shutdown(socket.SHUT_WR)
    except OSError:
        pass

threading.Thread(target=upstream, daemon=True).start()
for message in messages(lambda: adapter.recv(65536)):
    sys.stdout.buffer.write(frame(message))
    sys.stdout.buffer.flush()
server.kill()
`;

/**
 * Java's build for java-debug: the file with debug information into the output folder,
 * with the sources around it (by its package, the folder its package starts in) built as
 * it needs them.
 */
const JAVA_BUILD = `package=$(sed -n 's/^[[:space:]]*package[[:space:]]\\{1,\\}\\([A-Za-z0-9_.]*\\)[[:space:]]*;.*/\\1/p' "$1" | head -n 1)
root=$(dirname "$1")
if [ -n "$package" ]; then for part in $(echo "$package" | tr . ' '); do root=$(dirname "$root"); done; fi
mkdir -p "$2" && exec javac -g -encoding UTF-8 -d "$2" -sourcepath "$root" "$1"`;

/** The debuggers in the sandbox: debugpy for Python, gdb's own DAP mode (gdb 14+) for C and C++, Delve for Go, js-debug for JavaScript and TypeScript. */
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
  go: {
    name: "Delve",
    sources: /\.go$/i,
    needs: { have: ["go", "dlv"], missing: "it comes with the full image (pnpm sandbox:build:full)." },
    compile: (target, out) => ["sh", "-c", GO_BUILD, "cc-go", target, out],
    // The first build of a module compiles its dependencies too (then Go's cache keeps them).
    compileSeconds: 300,
    adapter: ["python3", "-c", DELVE_BRIDGE],
    // The program's output comes as output events ("remote"), not on Delve's own stdout.
    launch: (start, at) => ({ mode: "exec", program: at.program, args: start.args, cwd: at.cwd, env: start.env, outputMode: "remote" }),
    exceptions: [],
    // Delve's own entry is in the runtime's start-up code, before any of yours.
    entryFunction: "main.main",
  },
  java: {
    name: "java-debug",
    sources: /\.java$/i,
    needs: { have: ["javac", "jdtls", JAVA_DEBUG_PLUGIN], missing: "it comes with the full image (pnpm sandbox:build:full)." },
    // `program` is a folder of classes here, built with debug information.
    compile: (file, out) => ["sh", "-c", JAVA_BUILD, "cc-java", file, out],
    compileSeconds: 120,
    // The bridge starts JDT LS at the file's source root, so its project for loose files is right.
    adapter: (file) => ["python3", "-c", JAVA_DEBUG_BRIDGE, JAVA_DEBUG_PLUGIN, file ?? ""],
    // JDT LS starts, then finds the file's project, before java-debug can launch it.
    readySeconds: 120,
    launch: (start, at) => ({
      type: "java",
      request: "launch",
      name: "CodeChatter",
      mainFile: at.file,
      classPaths: [at.program],
      // One string, which java-debug splits as a command line would (quotes keep spaces in).
      args: start.args.map((arg) => (/[\s"]/.test(arg) || !arg ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg)).join(" "),
      cwd: at.cwd,
      env: start.env,
      stopOnEntry: start.stopOnEntry,
      console: "internalConsole",
    }),
    exceptions: ["uncaught"],
  },
  javascript: {
    name: "js-debug",
    sources: /\.(m|c)?(js|ts)$/i,
    needs: { have: [JS_DEBUG_BRIDGE], missing: "rebuild the sandbox image (pnpm sandbox:build) to get it." },
    // The image's js-debug and the bridge that makes its sessions one (sandbox/image/js-debug-bridge.mjs).
    adapter: ["node", JS_DEBUG_BRIDGE],
    // TypeScript runs as it is: Node strips the types, keeping every line and column where it was.
    // The program's own stdout and stderr come as output events ("std"), not only console.log.
    launch: (start, at) => ({
      type: "pwa-node",
      request: "launch",
      name: "CodeChatter",
      program: at.file,
      args: start.args,
      cwd: at.cwd,
      env: start.env,
      stopOnEntry: start.stopOnEntry,
      console: "internalConsole",
      outputCapture: "std",
      skipFiles: ["<node_internals>/**"],
    }),
    exceptions: ["uncaught"],
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

/** What's in a folder of the room ("." is the top); null when it isn't a folder. */
function folderChildren(doc: Y.Doc, path: string): TreeNode[] | null {
  if (path === ".") return listTree(doc);
  const folder = findByPath(doc, path);
  return folder?.kind === "folder" ? folder.children : null;
}

/** Which debugger a file takes, by its extension. */
export function debuggerFor(path: string): string | null {
  if (/\.py$/i.test(path)) return "python";
  if (/\.c$/i.test(path)) return "c";
  if (/\.(cc|cpp|cxx|c\+\+)$/i.test(path)) return "cpp";
  if (/\.go$/i.test(path)) return "go";
  if (/\.java$/i.test(path)) return "java";
  if (/\.(m|c)?(js|ts)$/i.test(path)) return "javascript";
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
    const language = start.module ? "python" : (debuggerFor(start.path!) ?? (this.isGoPackage(start.path!) ? "go" : null));
    if (!language) return this.broadcast({ type: "cc", event: "error", body: { message: "The debugger works on Python, C, C++, Go, Java, JavaScript and TypeScript files (or a Go package's folder)." } });
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

  /** A folder of the room with .go files in it ("." for the top): launch.json's "${fileDirname}" or "${workspaceFolder}" for Go. */
  private isGoPackage(path: string): boolean {
    return (folderChildren(this.room.sync.doc, path) ?? []).some((child) => child.kind === "file" && /\.go$/i.test(child.name));
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
  /** The adapter's stderr, last part kept: shown only if it ends before it's ready. */
  private readonly adapterErrors = new Collector(16 * 1024);
  private seq = 1;
  /** Requests waiting for their answer: the runner's own, or a person's (their socket and their seq). */
  private readonly pending = new Map<number, ((message: Dap) => void) | { ws: WebSocket; seq: number }>();
  private readonly waiting: Array<{ event: string; done: (message: Dap) => void }> = [];
  private readonly id = randomUUID().slice(0, 8);
  private stopping = false;
  private terminated = false;
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
      // A file, or for Go a package's folder.
      const kind = path && folderChildren(doc, path) ? "folder" : path ? findByPath(doc, path)?.kind : undefined;
      if (path && kind !== "file" && !(kind === "folder" && this.info.language === "go")) throw new Error(`${path} isn't in the room.`);
      if (folder && findByPath(doc, folder)?.kind !== "folder") throw new Error(`The folder ${folder} (cwd) isn't in the room.`);
      const file = path ? `/workspace/${path}` : null;
      // The configuration's folder, else the file's (or the package's), else the room's.
      const slash = path?.lastIndexOf("/") ?? -1;
      const cwd = folder ? `/workspace/${folder}` : kind === "folder" ? file! : path && slash !== -1 ? `/workspace/${path.slice(0, slash)}` : "/workspace";
      await this.checkNeeds();
      const program = `/tmp/cc-debug-${this.id}/program`;
      if (this.debuggerInfo.compile && file) await this.compile(this.debuggerInfo.compile(file, program), program);
      await this.launchAdapter(cwd, file);

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
      const ready = (this.debuggerInfo.readySeconds ?? 30) * 1000;
      await withTimeout(initialized, ready, `${this.debuggerInfo.name} didn't get ready.`);
      await this.sendAllBreakpoints();
      const entry = this.debuggerInfo.entryFunction;
      if (this.options.stopOnEntry && entry) await this.request("setFunctionBreakpoints", { breakpoints: [{ name: entry }] });
      const filters = ((this.info.capabilities.exceptionBreakpointFilters as Array<{ filter: string }> | undefined) ?? []).map((f) => f.filter);
      if (filters.length) await this.request("setExceptionBreakpoints", { filters: this.debuggerInfo.exceptions.filter((f) => filters.includes(f)) });
      await this.request("configurationDone", {});
      const launch = await withTimeout(launched, ready, `${this.debuggerInfo.name} didn't start the program.`);
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

  /** The debugger's commands and files are in this sandbox (some come with the full image only), or say so. */
  private async checkNeeds(): Promise<void> {
    const needs = this.debuggerInfo.needs;
    if (!needs) return;
    const handle = await this.room.sandbox.exec(["sh", "-c", 'for c in "$@"; do command -v "$c" >/dev/null || [ -e "$c" ] || exit 1; done', "cc-debug", ...needs.have], { tty: false });
    handle.stream.resume();
    await ended(handle.stream);
    const code = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    if (code !== 0) throw new Error(`${this.debuggerInfo.name} isn't in this sandbox: ${needs.missing}`);
  }

  /** Build the program with debug information; a compile error ends the session with the compiler's words. */
  private async compile(command: string[], program: string): Promise<void> {
    this.output("console", `Compiling ${this.info.path} with debug information…\n`);
    const script = `umask 002; mkdir -p "$(dirname "$1")"; seconds=$2; shift 2; exec timeout "$seconds" "$@"`;
    const seconds = String(this.debuggerInfo.compileSeconds ?? 60);
    const handle = await this.room.sandbox.exec([JAIL, "sh", "-c", script, "cc-debug", program, seconds, ...command], { tty: false });
    const out = new Collector(64 * 1024);
    handle.demux(out, out);
    await ended(handle.stream);
    const code = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    if (code !== 0) throw new Error(`It didn't compile:\n${out.text().trim().split("\n").slice(0, 30).join("\n")}`);
  }

  private async launchAdapter(cwd: string, file: string | null): Promise<void> {
    const adapter = typeof this.debuggerInfo.adapter === "function" ? this.debuggerInfo.adapter(file) : this.debuggerInfo.adapter;
    const script = `umask 002; echo $$ > ${this.pidFile}; cd "$1"; shift; exec "$@"`;
    const handle = await this.room.sandbox.exec([JAIL, "sh", "-c", script, "cc-debug", cwd, ...adapter], { tty: false, stdin: true });
    this.stream = handle.stream;
    const stdout = new PassThrough();
    handle.demux(stdout, this.adapterErrors);
    const frames = new LspFrames((json) => this.receive(json));
    stdout.on("data", (chunk: Buffer) => frames.push(chunk));
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
      // Delve's notes for its own terminal, and on letting go of the program.
      if (body.category === "console" && /^(Type 'dlv help' for list of commands\.|Detaching.*)\n?$/.test(body.output ?? "")) return;
      // Node's notes on the inspector, on its stderr: they'd read as the program's errors.
      if (body.category === "stderr" && /^(Debugger attached\.|Waiting for the debugger to disconnect\.\.\.)\n?$/.test(body.output ?? "")) return;
    }
    if (QUIET_EVENTS.has(message.event)) return;
    // Once is enough (Delve says it again when the runner disconnects).
    if (message.event === "terminated") {
      if (this.terminated) return;
      this.terminated = true;
    }
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
    // An adapter that ends before it's ready says why on its stderr (otherwise its own chatter, kept from people).
    const why = this.adapterErrors.text().trim().split("\n").slice(-6).join("\n");
    if (this.info.state === "starting" && !this.stopping && why) this.output("stderr", `${this.debuggerInfo.name} stopped:\n${why}\n`);
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
