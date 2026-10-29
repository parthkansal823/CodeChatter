// The room's JavaScript and TypeScript debugger (apps/runner/src/debug.ts): js-debug, VS Code's
// Node debugger, as one Debug Adapter Protocol session on stdin and stdout, as the runner
// talks to every debugger.
//
// js-debug serves on a TCP port, and runs each Node process as a child session: its first
// session only launches, then asks for a child ("startDebugging") with a configuration to
// launch on a second connection. This bridge opens that child itself, gives it the
// breakpoints and exception filters the runner sent so far, and from then on sends the
// runner's requests to it, and its answers and events back. Only the first process is
// debugged; js-debug's later children (processes it starts) are declined.
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";

const SERVER = "/usr/local/lib/js-debug/src/dapDebugServer.js";
/** The bridge's own requests are numbered from here, apart from the runner's. */
const OWN = 1_000_000_000;

function reader(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/content-length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
      if (!Number.isFinite(length)) {
        buffer = buffer.subarray(end + 4);
        continue;
      }
      if (buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString();
      buffer = buffer.subarray(end + 4 + length);
      onMessage(JSON.parse(body));
    }
  };
}

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

const toRunner = (message) => process.stdout.write(frame(message));

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const server = spawn(process.execPath, [SERVER, String(port), "127.0.0.1"], { stdio: ["ignore", "ignore", "inherit"] });
const quit = () => {
  server.kill();
  process.exit(0);
};
server.on("exit", quit);

async function open() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("js-debug didn't start.");
}

let ownSeq = OWN;
const answers = new Map();

/** One connection to js-debug: the first (parent) or the child. */
function session(socket, onMessage) {
  socket.on("data", reader(onMessage));
  socket.on("error", () => {});
  const send = (message) => socket.write(frame(message));
  return {
    socket,
    send,
    /** A request of the bridge's own; its answer comes back to the bridge, not the runner. */
    request(command, args) {
      const seq = ownSeq++;
      send({ seq, type: "request", command, arguments: args });
      return new Promise((resolve) => answers.set(seq, resolve));
    },
  };
}

// What the runner said so far, for the child: how it introduced itself, and its breakpoints.
let initializeArgs = {};
const breakpoints = new Map();
let exceptionArgs = null;
let functionArgs = null;
let child = null;
let childAsked = false;

function own(message) {
  if (message.type !== "response" || message.request_seq < OWN) return false;
  answers.get(message.request_seq)?.(message);
  answers.delete(message.request_seq);
  return true;
}

function decline(from, message, why) {
  from.send({ seq: ownSeq++, type: "response", request_seq: message.seq, command: message.command, success: false, message: why });
}

const parent = session(await open(), (message) => {
  if (own(message)) return;
  if (message.type === "request") {
    if (message.command === "startDebugging" && !childAsked) {
      childAsked = true;
      parent.send({ seq: ownSeq++, type: "response", request_seq: message.seq, command: message.command, success: true });
      void startChild(message.arguments ?? {});
    } else decline(parent, message, "The room debugs one process at a time.");
    return;
  }
  // Until the child takes over, the parent answers; its "initialized" starts the runner's setup.
  if (message.type === "response" || !child || message.event === "output" || message.event === "terminated" || message.event === "exited") toRunner(message);
});
parent.socket.on("close", quit);

async function startChild({ configuration = {}, request = "launch" }) {
  const socket = await open();
  const next = session(socket, (message) => {
    if (own(message)) return;
    if (message.type === "request") return decline(next, message, "The room debugs one process at a time.");
    if (message.type === "event" && message.event === "initialized") return void configure(next);
    toRunner(message);
  });
  await next.request("initialize", initializeArgs);
  void next.request(request, configuration);
}

async function configure(next) {
  await Promise.all([...breakpoints.values()].map((args) => next.request("setBreakpoints", args)));
  if (exceptionArgs) await next.request("setExceptionBreakpoints", exceptionArgs);
  if (functionArgs) await next.request("setFunctionBreakpoints", functionArgs);
  await next.request("configurationDone", {});
  child = next;
}

process.stdin.on(
  "data",
  reader((message) => {
    if (message.type !== "request") return;
    const args = message.arguments ?? {};
    if (message.command === "initialize") initializeArgs = args;
    if (message.command === "setBreakpoints" && args.source?.path) breakpoints.set(args.source.path, args);
    if (message.command === "setExceptionBreakpoints") exceptionArgs = args;
    if (message.command === "setFunctionBreakpoints") functionArgs = args;
    if (message.command === "disconnect" || message.command === "terminate") {
      // Both end; the answer the runner gets is from whichever was serving it.
      (child ?? parent).send(message);
      if (child) void parent.request(message.command, args);
      return;
    }
    (child ?? parent).send(message);
  }),
);
process.stdin.on("end", quit);
