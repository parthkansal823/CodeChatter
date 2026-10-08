// Runner end-to-end: real collab server, real runner, real Docker sandbox.
//   node --env-file=../../.env test/runner.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Joins the test room (E2ETST) as a service peer (like the runner does), writes files
// into it, and drives runs and a terminal through the runner's internal API.
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, textOf, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 140)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

// --- a peer on the room's files document ------------------------------------
const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out (is the collab server running with SERVICE_SECRET?)")), 15000);
});
record("serviceTokenOpensRoomDoc", true, docName);

const dir = `e2e-${Date.now().toString(36)}`;
const put = (name, content) => createFileAtPath(doc, `${dir}/${name}`, content, null);
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

/** Start a run and collect its NDJSON events. `onStarted(runId)` can send input or stop. */
async function run(path, { onStarted, timeoutMs = 60000 } = {}) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const events = [];
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      events.push(event);
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      if (event.type === "started" && onStarted) void onStarted(event.run.id);
    }
  }
  const exit = events.find((e) => e.type === "exit")?.exit;
  const error = events.find((e) => e.type === "error")?.message;
  return { events, output, exit, error };
}
const post = (path, body) =>
  fetch(`${RUNNER}/rooms/${ROOM}${path}`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify(body) });

try {
  // 1. Auth: no token, wrong room.
  const anonymous = await fetch(`${RUNNER}/rooms/${ROOM}/runs/current`);
  const wrongRoom = await fetch(`${RUNNER}/rooms/ZZZZZZ/runs/current`, { headers: { authorization: token() } });
  record("rejectsMissingOrForeignToken", anonymous.status === 401 && wrongRoom.status === 401, `${anonymous.status}/${wrongRoom.status}`);

  // 2. A file created a moment ago runs (state-vector barrier), and fast.
  put("hello.py", 'print("hello from the sandbox", 6 * 7)\n');
  const t0 = Date.now();
  const hello = await run(`${dir}/hello.py`);
  record("runsJustCreatedPython", hello.output.includes("hello from the sandbox 42") && hello.exit?.code === 0, `${Date.now() - t0}ms ${hello.error ?? ""} ${hello.output}`);

  // 3. Every sandbox language.
  put("hello.js", 'console.log("js", [1, 2, 3].map((x) => x * 2).join(","));\n');
  put("hello.ts", 'enum Color { Red = "red" }\nconst n: number = 5;\nconsole.log("ts", Color.Red, n * 2);\n');
  put("hello.c", '#include <stdio.h>\nint main(void) { printf("c %d\\n", 40 + 2); return 0; }\n');
  put("hello.cpp", '#include <iostream>\n#include <vector>\nint main() { std::vector<int> v{1,2,3}; std::cout << "cpp " << v.size() << "\\n"; }\n');
  put("Hello.java", 'public class Hello { public static void main(String[] a) { System.out.println("java " + (20 + 22)); } }\n');
  put("hello.sh", 'echo "bash $((6 * 7))"\n');
  for (const [file, expected] of [
    ["hello.js", "js 2,4,6"],
    ["hello.ts", "ts red 10"],
    ["hello.c", "c 42"],
    ["hello.cpp", "cpp 3"],
    ["Hello.java", "java 42"],
    ["hello.sh", "bash 42"],
  ]) {
    const r = await run(`${dir}/${file}`, { timeoutMs: 120000 });
    record(`runs ${file}`, r.output.includes(expected) && r.exit?.code === 0, `${r.error ?? ""} ${r.output}`);
  }

  // 4. Security: no server secrets, no network, not root.
  put(
    "probe.py",
    [
      "import os, socket",
      "print('ENV', ','.join(sorted(os.environ)))",
      "print('UID', os.getuid())",
      "try:",
      "    socket.create_connection(('1.1.1.1', 53), timeout=2); print('NET open')",
      "except OSError:",
      "    print('NET blocked')",
      "try:",
      "    open('/etc/hacked', 'w'); print('ROOT writable')",
      "except OSError:",
      "    print('ROOT readonly')",
    ].join("\n"),
  );
  const probe = await run(`${dir}/probe.py`);
  const envLine = /ENV (.*)/.exec(probe.output)?.[1] ?? "";
  record("noSecretsInSandboxEnv", envLine && !/SECRET|DATABASE|VALKEY|SMTP|TOKEN|PASS/.test(envLine), envLine.trim());
  record("noNetworkInSandbox", probe.output.includes("NET blocked"));
  record("userCodeIsNotRootAndRootfsReadonly", probe.output.includes("UID 10001") && probe.output.includes("ROOT readonly"));

  // 5. Typed input reaches the program (only from the person who started it).
  put("ask.py", 'name = input("Your name? ")\nprint("Hi", name)\n');
  const asked = await run(`${dir}/ask.py`, {
    onStarted: async (runId) => {
      await sleep(800);
      await post("/runs/input", { runId, data: "Ananya\r" });
    },
  });
  record("stdinReachesProgram", asked.output.includes("Hi Ananya"), asked.output);

  // 6. Files a program writes appear in the room (up-sync).
  put("writer.py", `import os\nos.makedirs("${dir}/out", exist_ok=True)\nwith open("${dir}/out/result.txt", "w") as f:\n    f.write("sum=" + str(sum(range(10))))\n`);
  await run(`${dir}/writer.py`);
  let synced = null;
  for (let i = 0; i < 20 && !synced; i++) {
    await sleep(250);
    const node = findByPath(doc, `${dir}/out/result.txt`);
    if (node) synced = textOf(doc, node.id)?.toString();
  }
  record("programOutputFileSyncsIntoRoom", synced === "sum=45", synced ?? "not synced");

  // 7. Edits in the room reach the sandbox without a run (down-sync), seen from a terminal.
  const ws = new WebSocket(`${RUNNER.replace("http", "ws")}/rooms/${ROOM}/terminal?session=e2e&cols=100&rows=30`, { headers: { authorization: token() } });
  let screen = "";
  let status = "";
  ws.on("message", (data, isBinary) => {
    if (isBinary) screen += data.toString();
    else status = JSON.parse(data.toString()).state;
  });
  await new Promise((resolve) => ws.once("open", resolve));
  for (let i = 0; i < 40 && status !== "ready"; i++) await sleep(250);
  await sleep(700);
  const type = (text) => ws.send(JSON.stringify({ t: "in", d: text }));
  put("note.txt", "from the editor\n");
  await sleep(600);
  type(`cat ${dir}/note.txt && echo "calc=$((6*7))"\r`);
  await sleep(1500);
  record("terminalRunsCommands", screen.includes("calc=42"), screen.slice(-160));
  record("roomEditsReachSandboxLive", screen.includes("from the editor"));

  // 8. Files made in the terminal appear in the room.
  type(`echo 'made in terminal' > ${dir}/term.txt\r`);
  let fromTerminal = null;
  for (let i = 0; i < 20 && !fromTerminal; i++) {
    await sleep(250);
    const node = findByPath(doc, `${dir}/term.txt`);
    if (node) fromTerminal = textOf(doc, node.id)?.toString();
  }
  record("terminalFilesSyncIntoRoom", fromTerminal === "made in terminal\n", JSON.stringify(fromTerminal));

  // 8b. The terminal stays inside the workspace: cd explains, and the kernel (cc-jail) denies the rest.
  const mark = screen.length;
  type(`cd .. ; ls / ; cat /opt/ccagent/agent.mjs ; echo "end=$((2+3))"\r`);
  for (let i = 0; i < 20 && !screen.slice(mark).includes("end=5"); i++) await sleep(250);
  const jailed = screen.slice(mark);
  record(
    "terminalStaysInWorkspace",
    jailed.includes("outside the workspace") && (jailed.match(/Permission denied/g) ?? []).length >= 2 && !jailed.includes("lib64"),
    jailed.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").slice(-200),
  );

  // 9. tmux keeps the session: reconnect and find the earlier output.
  ws.close();
  await sleep(500);
  const ws2 = new WebSocket(`${RUNNER.replace("http", "ws")}/rooms/${ROOM}/terminal?session=e2e&cols=100&rows=30`, { headers: { authorization: token() } });
  let screen2 = "";
  ws2.on("message", (data, isBinary) => isBinary && (screen2 += data.toString()));
  await new Promise((resolve) => ws2.once("open", resolve));
  await sleep(2000);
  record("terminalSurvivesReconnect", screen2.includes("calc=42"), screen2.slice(-120));
  ws2.close();

  // 10. Stop ends a program that never finishes.
  put("forever.py", "import time\nwhile True:\n    print('tick', flush=True)\n    time.sleep(0.2)\n");
  const stopped = await run(`${dir}/forever.py`, {
    onStarted: async () => {
      await sleep(1200);
      await post("/runs/stop", {});
    },
  });
  record("stopEndsRun", stopped.exit?.reason === "stopped" && stopped.output.includes("tick"), JSON.stringify(stopped.exit));

  // 11. A fork bomb can't take the sandbox down for good.
  // setsid escapes the run's session, so Stop's Ctrl-C and the hangup at exit can't reach it.
  put("bomb.sh", "setsid bash -c ':(){ :|:& };:' >/dev/null 2>&1 &\nsleep 2\necho bomb planted\n");
  const bomb = await run(`${dir}/bomb.sh`, { timeoutMs: 90000 });
  const after = await run(`${dir}/hello.py`, { timeoutMs: 90000 });
  record("recoversFromForkBomb", after.output.includes("hello from the sandbox 42"), `bomb exit ${JSON.stringify(bomb.exit)}; after: ${after.error ?? after.output}`);

  // 12. Unsupported files get a clear message.
  put("notes.md", "# hi\n");
  const md = await run(`${dir}/notes.md`);
  record("unsupportedFileExplained", /can't run/.test(md.error ?? ""), md.error);
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(800);
  provider.destroy();
  socket.destroy();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
