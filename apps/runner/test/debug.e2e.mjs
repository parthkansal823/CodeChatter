// The room's debugger (debug.ts) through the real runner, two people on one session: Ana drives, Ben watches.
// Python (debugpy): breakpoints set in the files document stop the program for both; stack, variables and evaluate;
// Ben can look but not step or start; a step; a breakpoint added while it runs is sent at once and hit; output and
// the end reach Ben. C (gdb): compiled with debug information, stopped at a breakpoint, a variable read, run to the
// end. A compile error is explained, and a second session waits for the first. The test's files are removed.
//   node --env-file=../../.env test/debug.e2e.mjs        (from apps/runner, with the dev stack running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, toggleBreakpoint, trash, clearBreakpoints } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = (process.env.RUNNER_URL ?? "http://127.0.0.1:4200").replace(/^http/, "ws");
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

/** One person's connection: everything they receive, and a way to wait for the next thing that matches. */
function connect(name, mode) {
  const token = signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: `e2e-${name}`, name });
  const ws = new WebSocket(`${RUNNER}/rooms/${ROOM}/debug?mode=${mode}`, { headers: { authorization: `Bearer ${token}` } });
  const client = { ws, seen: [], waiters: [], seq: 1 };
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    client.seen.push(message);
    for (const waiter of [...client.waiters]) if (waiter.test(message)) (client.waiters.splice(client.waiters.indexOf(waiter), 1), waiter.done(message));
  });
  client.open = new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
  client.next = (test, ms = 30_000) =>
    new Promise((done, fail) => {
      const waiter = { test, done };
      client.waiters.push(waiter);
      setTimeout(() => (client.waiters.includes(waiter) ? fail(new Error(`timed out waiting (${name})`)) : null), ms);
    });
  client.cc = (command, args) => ws.send(JSON.stringify({ type: "cc", command, arguments: args }));
  client.request = (command, args) => {
    const seq = client.seq++;
    const answer = client.next((m) => m.type === "response" && m.request_seq === seq);
    ws.send(JSON.stringify({ seq, type: "request", command, arguments: args }));
    return answer;
  };
  return client;
}
const isEvent = (name, test = () => true) => (m) => m.type === "event" && m.event === name && test(m.body ?? {});
const isSession = (test) => (m) => m.type === "cc" && m.event === "session" && test(m.body);

const dir = `dbg-${Date.now().toString(36)}`;
const python = ["x = 1", "y = x + 1", 'print("y is", y)', "for i in range(2):", "    print('i', i)", ""].join("\n");
const c = ["#include <stdio.h>", "int main(void) {", "  int x = 1;", "  int y = x + 1;", '  printf("y is %d\\n", y);', "  return 0;", "}", ""].join("\n");
const ids = {};
doc.transact(() => {
  ids.py = createFileAtPath(doc, `${dir}/prog.py`, python);
  ids.c = createFileAtPath(doc, `${dir}/prog.c`, c);
  ids.bad = createFileAtPath(doc, `${dir}/bad.c`, "int main(void) { return nope; }\n");
  ids.args = createFileAtPath(doc, `${dir}/args.py`, ["import os, sys", "print(sys.argv[1:], os.environ['MODE'], os.getcwd())", ""].join("\n"));
  ids.sub = createFileAtPath(doc, `${dir}/sub/keep.txt`, "a folder to run in\n");
  ids.init = createFileAtPath(doc, `${dir}/pkg/__init__.py`, "");
  ids.hello = createFileAtPath(doc, `${dir}/pkg/hello.py`, 'print("module ok")\n');
  ids.argv = createFileAtPath(doc, `${dir}/argv.c`, ["#include <stdio.h>", "int main(int argc, char **argv) {", '  printf("argc %d %s\\n", argc, argv[1]);', "  return 0;", "}", ""].join("\n"));
});
toggleBreakpoint(doc, ids.py, 2);
toggleBreakpoint(doc, ids.c, 4);

const ana = connect("Ana", "drive");
const ben = connect("Ben", "watch");
try {
  await Promise.all([ana.open, ben.open]);
  check("nothingAtFirst", ana.seen.some(isSession((s) => s === null)));

  // Python: both see it stop at the breakpoint.
  const anaStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"));
  const benStopped = ben.next(isEvent("stopped", (b) => b.reason === "breakpoint"));
  ana.cc("start", { path: `${dir}/prog.py`, stateVector: stateVector() });
  const [stopped] = await Promise.all([anaStopped, benStopped]);
  check("bothSeeTheStop", stopped.body.threadId !== undefined);
  check("sessionSaysWho", ben.seen.some(isSession((s) => s?.startedBy === "Ana" && s.path === `${dir}/prog.py` && s.language === "python")));

  const threadId = stopped.body.threadId;
  const stack = await ana.request("stackTrace", { threadId });
  const top = stack.body?.stackFrames?.[0];
  check("stoppedOnLine2", top?.line === 2 && top.source?.path === `/workspace/${dir}/prog.py`, JSON.stringify(top));
  const scopes = await ana.request("scopes", { frameId: top.id });
  const locals = await ana.request("variables", { variablesReference: scopes.body.scopes[0].variablesReference });
  check("variables", locals.body?.variables?.some((v) => v.name === "x" && v.value === "1"), JSON.stringify(locals.body?.variables?.map((v) => `${v.name}=${v.value}`)));
  const evaluated = await ana.request("evaluate", { expression: "x + 41", frameId: top.id, context: "repl" });
  check("evaluate", evaluated.body?.result === "42", JSON.stringify(evaluated.body));

  const benStack = await ben.request("stackTrace", { threadId });
  check("watcherCanLook", benStack.success && benStack.body?.stackFrames?.[0]?.line === 2);
  const benStep = await ben.request("next", { threadId });
  check("watcherCantStep", benStep.success === false && /watch/.test(benStep.message ?? ""), benStep.message);
  const benEval = await ben.request("evaluate", { expression: "1", context: "repl" });
  check("watcherCantEvaluate", benEval.success === false);
  ben.cc("start", { path: `${dir}/prog.py` });
  check("watcherCantStart", (await ben.next((m) => m.type === "cc" && m.event === "error")).body.message.includes("can watch"));
  ana.cc("start", { path: `${dir}/prog.c` });
  check("oneSessionAtATime", (await ana.next((m) => m.type === "cc" && m.event === "error")).body.message.includes("Ana is debugging"));

  const stepped = ana.next(isEvent("stopped", (b) => b.reason === "step"));
  await ana.request("next", { threadId });
  await stepped;
  check("stepped", (await ana.request("stackTrace", { threadId })).body?.stackFrames?.[0]?.line === 3);

  // A breakpoint added while it runs: sent to debugpy at once, and hit.
  const verified = ben.next((m) => m.type === "cc" && m.event === "breakpoints" && m.body.fileId === ids.py && m.body.breakpoints.some((b) => b.line === 5 && b.verified));
  toggleBreakpoint(doc, ids.py, 5);
  check("liveBreakpoint", await verified.then(() => true, () => false));
  const atFive = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"));
  await ana.request("continue", { threadId });
  await atFive;
  check("hitLiveBreakpoint", (await ana.request("stackTrace", { threadId })).body?.stackFrames?.[0]?.line === 5);
  // A print can come in pieces ("y is", " ", "2"): what the console shows is them joined.
  const printed = ben.seen.filter(isEvent("output")).map((m) => m.body.output ?? "").join("");
  check("outputReachesWatcher", printed.includes("y is 2"), printed.slice(-200));

  toggleBreakpoint(doc, ids.py, 5);
  const ended = ben.next(isSession((s) => s === null));
  await new Promise((r) => setTimeout(r, 300));
  await ana.request("continue", { threadId });
  await ended;
  check("endedForEveryone", ben.seen.some(isEvent("terminated")));

  // C, with gdb.
  const cStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"), 60_000);
  ana.cc("start", { path: `${dir}/prog.c`, stateVector: stateVector() });
  const cStop = await cStopped;
  check("compiledNote", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("Compiling"))));
  const cStack = await ana.request("stackTrace", { threadId: cStop.body.threadId });
  const cTop = cStack.body?.stackFrames?.[0];
  check("cStoppedOnLine4", cTop?.line === 4 && cTop.name === "main", JSON.stringify(cTop));
  const cScopes = await ana.request("scopes", { frameId: cTop.id });
  const cLocals = await ana.request("variables", { variablesReference: cScopes.body.scopes[0].variablesReference });
  check("cVariables", cLocals.body?.variables?.some((v) => v.name === "x" && v.value === "1"), JSON.stringify(cLocals.body?.variables));
  const watch = await ana.request("evaluate", { expression: "x + 41", frameId: cTop.id, context: "watch" });
  check("cWatch", watch.body?.result === "42", JSON.stringify(watch));
  const cEnded = ana.next(isSession((s) => s === null));
  await ana.request("continue", { threadId: cStop.body.threadId });
  await cEnded;
  check("cOutput", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("y is 2"))));

  // launch.json configurations: arguments, environment, folder, stopping on entry; a Python module.
  const entry = ana.next(isEvent("stopped", (b) => b.reason === "entry"), 60_000);
  const named = ana.next(isSession((s) => s?.name === "With args"));
  ana.cc("start", { path: `${dir}/args.py`, name: "With args", args: ["a b", "c"], env: { MODE: "dev" }, cwd: `${dir}/sub`, stopOnEntry: true, stateVector: stateVector() });
  const entryStop = await entry.catch(() => null);
  check("stopOnEntry", entryStop !== null && (await named.then(() => true, () => false)));
  const argsEnded = ana.next(isSession((s) => s === null));
  await ana.request("continue", { threadId: entryStop?.body.threadId ?? 1 });
  await argsEnded;
  const argsOut = ana.seen.filter(isEvent("output")).map((m) => m.body.output ?? "").join("");
  check("argsEnvCwd", argsOut.includes(`['a b', 'c'] dev /workspace/${dir}/sub`), argsOut.slice(-160));

  const moduleEnded = ana.next(isSession((s) => s === null), 60_000);
  const modulePath = ana.next(isSession((s) => s?.path === "python -m pkg.hello"));
  ana.cc("start", { module: "pkg.hello", cwd: dir, stateVector: stateVector() });
  await moduleEnded;
  const moduleOut = ana.seen.filter(isEvent("output")).map((m) => m.body.output ?? "").join("");
  check("module", (await modulePath.then(() => true, () => false)) && moduleOut.includes("module ok"), moduleOut.slice(-120));

  const cEntry = ana.next(isEvent("stopped"), 60_000);
  ana.cc("start", { path: `${dir}/argv.c`, args: ["first"], stopOnEntry: true, stateVector: stateVector() });
  const cEntryStop = await cEntry;
  const cEntryTop = (await ana.request("stackTrace", { threadId: cEntryStop.body.threadId })).body?.stackFrames?.[0];
  check("cStopOnEntry", cEntryTop?.name === "main", JSON.stringify(cEntryTop));
  const cArgsEnded = ana.next(isSession((s) => s === null));
  await ana.request("continue", { threadId: cEntryStop.body.threadId });
  await cArgsEnded;
  check("cArgs", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("argc 2 first"))));

  ana.cc("start", { path: "../etc/passwd" });
  check("outsideRefused", (await ana.next((m) => m.type === "cc" && m.event === "error")).body.message.startsWith("That can't be debugged"));
  const noFolder = ana.next(isEvent("output", (b) => (b.output ?? "").includes("isn't in the room")));
  ana.cc("start", { path: `${dir}/prog.py`, cwd: `${dir}/nowhere` });
  check("missingFolderExplained", await noFolder.then(() => true, () => false));
  await ana.next(isSession((s) => s === null)).catch(() => {});

  const bad = ana.next(isEvent("output", (b) => (b.output ?? "").includes("It didn't compile")), 60_000);
  const badEnded = ana.next(isSession((s) => s === null), 60_000);
  ana.cc("start", { path: `${dir}/bad.c`, stateVector: stateVector() });
  const badMessage = await bad.then((m) => m.body.output, () => "");
  await badEnded.catch(() => {});
  check("compileErrorExplained", /nope/.test(badMessage), badMessage);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  ana.ws.close();
  ben.ws.close();
  for (const id of Object.values(ids)) clearBreakpoints(doc, id);
  for (const id of Object.values(ids)) trash(doc, id);
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
