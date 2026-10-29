// The room's debugger (debug.ts) through the real runner, two people on one session: Ana drives, Ben watches.
// Python (debugpy): breakpoints set in the files document stop the program for both; stack, variables and evaluate;
// Ben can look but not step or start; a step; a breakpoint added while it runs is sent at once and hit; output and
// the end reach Ben. C (gdb): compiled with debug information, stopped at a breakpoint, a variable read, run to the
// end. A compile error is explained, and a second session waits for the first. JavaScript and TypeScript (js-debug,
// through the bridge that makes its child session one): stopped at a breakpoint with a variable and a watch, output
// from console.log and stdout; a .ts file as it is; stop on entry with arguments. Go (Delve, full image only): a
// module's package built with the other file in it, stopped at a breakpoint, a variable and a watch, its output; a
// file on its own with arguments, stopping at main.main; a package by its folder; a compile error. The sandbox is
// restarted first, so it runs the image as built now. The test's files are removed.
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
// Go and Delve come with the full image only.
const GO = (process.env.SANDBOX_IMAGE ?? "").endsWith(":full");

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

// A sandbox from an older image is only replaced when it restarts.
const restarted = await fetch(`${RUNNER.replace(/^ws/, "http")}/rooms/${ROOM}/sandbox/restart`, {
  method: "POST",
  headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-Ana", name: "Ana" })}` },
});
if (!restarted.ok) throw new Error(`restarting the sandbox failed: ${restarted.status}`);

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
  ids.js = createFileAtPath(doc, `${dir}/prog.js`, ["const x = 1;", "const y = x + 1;", 'console.log("js y is", y);', 'process.stdout.write("js done\\n");', ""].join("\n"));
  ids.ts = createFileAtPath(doc, `${dir}/prog.ts`, ["const n: number = 20;", "const total: number = n * 2 + 2;", 'console.log("ts total", total);', ""].join("\n"));
  ids.jsArgs = createFileAtPath(doc, `${dir}/args.js`, ['console.log("js args", process.argv[2], process.env.MODE);', ""].join("\n"));
  if (GO) {
    ids.goMod = createFileAtPath(doc, `${dir}/gomod/go.mod`, "module example.com/dbg\n\ngo 1.24\n");
    ids.goMain = createFileAtPath(doc, `${dir}/gomod/main.go`, ["package main", "", 'import "fmt"', "", "func main() {", "\tx := 1", "\ty := double(x)", '\tfmt.Println("go y is", y)', "}", ""].join("\n"));
    ids.goUtil = createFileAtPath(doc, `${dir}/gomod/util.go`, ["package main", "", "func double(n int) int { return n * 2 }", ""].join("\n"));
    ids.goLone = createFileAtPath(doc, `${dir}/lone/args.go`, ["package main", "", 'import (\n\t"fmt"\n\t"os"\n)', "", "func main() {", '\tfmt.Println("go args", os.Args[1], os.Getenv("MODE"))', "}", ""].join("\n"));
    ids.goBad = createFileAtPath(doc, `${dir}/gobad/bad.go`, ["package main", "", "func main() { nope() }", ""].join("\n"));
    ids.javaMain = createFileAtPath(doc, `${dir}/java/app/Main.java`, ["package app;", "", "public class Main {", "    public static void main(String[] args) {", "        int x = 20;", "        int y = Helper.twice(x) + 2;", '        System.out.println("java y is " + y);', "    }", "}", ""].join("\n"));
    ids.javaHelper = createFileAtPath(doc, `${dir}/java/app/Helper.java`, ["package app;", "", "public class Helper {", "    static int twice(int n) { return n * 2; }", "}", ""].join("\n"));
    ids.javaBad = createFileAtPath(doc, `${dir}/javabad/Bad.java`, ["public class Bad {", "    public static void main(String[] args) { nope(); }", "}", ""].join("\n"));
  }
});
toggleBreakpoint(doc, ids.py, 2);
toggleBreakpoint(doc, ids.c, 4);

const ana = connect("Ana", "drive");
const ben = connect("Ben", "watch");
try {
  await Promise.all([ana.open, ben.open]);
  check("nothingAtFirst", ana.seen.some(isSession((s) => s === null)), JSON.stringify(ana.seen.find(isSession(() => true))?.body ?? null));

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

  // JavaScript, with js-debug: its child session (the Node process) is the one that stops.
  toggleBreakpoint(doc, ids.js, 3);
  const jsStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"), 60_000);
  ana.cc("start", { path: `${dir}/prog.js`, stateVector: stateVector() });
  const jsStop = await jsStopped;
  const jsTop = (await ana.request("stackTrace", { threadId: jsStop.body.threadId })).body?.stackFrames?.[0];
  check("jsStoppedOnLine3", jsTop?.line === 3 && jsTop.source?.path === `/workspace/${dir}/prog.js`, JSON.stringify(jsTop));
  const jsScopes = await ana.request("scopes", { frameId: jsTop.id });
  const jsLocals = await ana.request("variables", { variablesReference: jsScopes.body.scopes[0].variablesReference });
  check("jsVariables", jsLocals.body?.variables?.some((v) => v.name === "y" && v.value === "2"), JSON.stringify(jsLocals.body?.variables?.slice(0, 8)));
  const jsWatch = await ana.request("evaluate", { expression: "x + 41", frameId: jsTop.id, context: "watch" });
  check("jsWatch", jsWatch.body?.result === "42", JSON.stringify(jsWatch.body ?? jsWatch));
  const jsEnded = ana.next(isSession((s) => s === null), 60_000);
  await ana.request("continue", { threadId: jsStop.body.threadId });
  await jsEnded;
  const jsOut = ana.seen.filter(isEvent("output")).map((m) => m.body.output ?? "").join("");
  check("jsOutput", jsOut.includes("js y is 2") && jsOut.includes("js done"), jsOut.slice(-200));

  // TypeScript, as it is: Node strips the types and keeps the lines.
  toggleBreakpoint(doc, ids.ts, 3);
  const tsStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"), 60_000);
  ana.cc("start", { path: `${dir}/prog.ts`, stateVector: stateVector() });
  const tsStop = await tsStopped;
  const tsTop = (await ana.request("stackTrace", { threadId: tsStop.body.threadId })).body?.stackFrames?.[0];
  check("tsStoppedOnLine3", tsTop?.line === 3 && tsTop.source?.path === `/workspace/${dir}/prog.ts`, JSON.stringify(tsTop));
  const tsTotal = await ana.request("evaluate", { expression: "total", frameId: tsTop.id, context: "watch" });
  check("tsWatch", tsTotal.body?.result === "42", JSON.stringify(tsTotal.body ?? tsTotal));
  const tsEnded = ana.next(isSession((s) => s === null), 60_000);
  await ana.request("continue", { threadId: tsStop.body.threadId });
  await tsEnded;
  check("tsOutput", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("ts total 42"))));

  // Stop on entry, with arguments and environment.
  const jsEntry = ana.next(isEvent("stopped"), 60_000);
  ana.cc("start", { path: `${dir}/args.js`, args: ["first"], env: { MODE: "dev" }, stopOnEntry: true, stateVector: stateVector() });
  const jsEntryStop = await jsEntry.catch(() => null);
  check("jsStopOnEntry", jsEntryStop !== null, jsEntryStop ? jsEntryStop.body.reason : "");
  const jsArgsEnded = ana.next(isSession((s) => s === null), 60_000);
  await ana.request("continue", { threadId: jsEntryStop?.body.threadId ?? 0 });
  await jsArgsEnded;
  check("jsArgs", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("js args first dev"))));

  if (GO) {
    // Go, with Delve: main.go is built with util.go (its module's package).
    toggleBreakpoint(doc, ids.goMain, 8);
    const goStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"), 300_000);
    ana.cc("start", { path: `${dir}/gomod/main.go`, stateVector: stateVector() });
    const goStop = await goStopped;
    const goTop = (await ana.request("stackTrace", { threadId: goStop.body.threadId })).body?.stackFrames?.[0];
    check("goStoppedOnLine8", goTop?.line === 8 && goTop.name === "main.main" && goTop.source?.path === `/workspace/${dir}/gomod/main.go`, JSON.stringify(goTop));
    const goScopes = await ana.request("scopes", { frameId: goTop.id });
    const goLocals = await ana.request("variables", { variablesReference: goScopes.body.scopes[0].variablesReference });
    check("goVariables", goLocals.body?.variables?.some((v) => v.name === "y" && v.value === "2"), JSON.stringify(goLocals.body?.variables));
    const goWatch = await ana.request("evaluate", { expression: "x + 41", frameId: goTop.id, context: "watch" });
    check("goWatch", goWatch.body?.result === "42", JSON.stringify(goWatch.body ?? goWatch));
    const goEnded = ana.next(isSession((s) => s === null), 60_000);
    await ana.request("continue", { threadId: goStop.body.threadId });
    await goEnded;
    check("goOutput", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("go y is 2"))));

    // A file with no module: built on its own, arguments and environment, stopping at main.main.
    const goEntry = ana.next(isEvent("stopped"), 120_000);
    ana.cc("start", { path: `${dir}/lone/args.go`, args: ["first"], env: { MODE: "dev" }, stopOnEntry: true, stateVector: stateVector() });
    const goEntryStop = await goEntry;
    const goEntryTop = (await ana.request("stackTrace", { threadId: goEntryStop.body.threadId })).body?.stackFrames?.[0];
    check("goStopOnEntry", goEntryTop?.name === "main.main", JSON.stringify(goEntryTop));
    const goArgsEnded = ana.next(isSession((s) => s === null), 60_000);
    await ana.request("continue", { threadId: goEntryStop.body.threadId });
    await goArgsEnded;
    check("goArgs", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("go args first dev"))));

    // A package by its folder (launch.json's ${fileDirname}), run to the end.
    clearBreakpoints(doc, ids.goMain);
    const goFolderEnded = ana.next(isSession((s) => s === null), 120_000);
    const goFolderSession = ana.next(isSession((s) => s?.path === `${dir}/gomod` && s.language === "go"));
    const before = ana.seen.length;
    ana.cc("start", { path: `${dir}/gomod`, stateVector: stateVector() });
    await goFolderEnded;
    const folderOut = ana.seen.slice(before).filter(isEvent("output")).map((m) => m.body.output ?? "").join("");
    check("goPackageFolder", (await goFolderSession.then(() => true, () => false)) && folderOut.includes("go y is 2"), folderOut.slice(-160));

    const goBad = ana.next(isEvent("output", (b) => (b.output ?? "").includes("It didn't compile")), 120_000);
    const goBadEnded = ana.next(isSession((s) => s === null), 120_000);
    ana.cc("start", { path: `${dir}/gobad/bad.go`, stateVector: stateVector() });
    const goBadMessage = await goBad.then((m) => m.body.output, () => "");
    await goBadEnded.catch(() => {});
    check("goCompileErrorExplained", /undefined: nope/.test(goBadMessage), goBadMessage);

    // Java, with java-debug inside JDT LS: Main.java built with the Helper beside it (its package's sources).
    toggleBreakpoint(doc, ids.javaMain, 7);
    const javaStopped = ana.next(isEvent("stopped", (b) => b.reason === "breakpoint"), 300_000);
    ana.cc("start", { path: `${dir}/java/app/Main.java`, stateVector: stateVector() });
    const javaStop = await javaStopped;
    const javaTop = (await ana.request("stackTrace", { threadId: javaStop.body.threadId })).body?.stackFrames?.[0];
    check("javaStoppedOnLine7", javaTop?.line === 7 && /main/.test(javaTop.name) && javaTop.source?.path?.endsWith(`${dir}/java/app/Main.java`), JSON.stringify(javaTop));
    const javaScopes = await ana.request("scopes", { frameId: javaTop.id });
    const javaLocals = await ana.request("variables", { variablesReference: javaScopes.body.scopes[0].variablesReference });
    check("javaVariables", javaLocals.body?.variables?.some((v) => v.name === "y" && v.value === "42"), JSON.stringify(javaLocals.body?.variables));
    const javaWatch = await ana.request("evaluate", { expression: "x + 22", frameId: javaTop.id, context: "watch" });
    check("javaWatch", javaWatch.body?.result === "42", JSON.stringify(javaWatch.body ?? javaWatch));
    const javaEnded = ana.next(isSession((s) => s === null), 60_000);
    await ana.request("continue", { threadId: javaStop.body.threadId });
    await javaEnded;
    check("javaOutput", ana.seen.some(isEvent("output", (b) => (b.output ?? "").includes("java y is 42"))));

    const javaBad = ana.next(isEvent("output", (b) => (b.output ?? "").includes("It didn't compile")), 120_000);
    const javaBadEnded = ana.next(isSession((s) => s === null), 120_000);
    ana.cc("start", { path: `${dir}/javabad/Bad.java`, stateVector: stateVector() });
    const javaBadMessage = await javaBad.then((m) => m.body.output, () => "");
    await javaBadEnded.catch(() => {});
    check("javaCompileErrorExplained", /cannot find symbol/.test(javaBadMessage), javaBadMessage);
  }

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
