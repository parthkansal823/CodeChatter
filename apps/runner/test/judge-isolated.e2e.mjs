/**
 * Tests that run in a throwaway container (judge-box.ts), as an interview's hidden tests do,
 * against the real runner (dev stack running). The program being judged tries to cheat: it
 * saves the input in the workspace and in /tmp, tries the network, and leaves a process
 * running. None of that may reach the room or its sandbox, and the container must be gone.
 * Uses the test room E2ETST and cleans up after itself.
 * From apps/runner: node --env-file=../../.env test/judge-isolated.e2e.mjs
 */
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import Docker from "dockerode";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 170)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const doc = new Y.Doc();
const name = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: name }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15_000);
});
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

/** Judge a file and collect its events. */
async function judge(path, cases, isolated = true) {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/judge`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, cases, stateVector: stateVector(), timeLimitMs: 5000, isolated }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const dir = `e2e-judgebox-${Date.now().toString(36)}`;
const SECRET_INPUT = `hidden-${Date.now().toString(36)}`;
const docker = new Docker();
try {
  createFileAtPath(doc, `${dir}/helper.py`, "def shout(text):\n    return text.upper()\n", null);
  createFileAtPath(
    doc,
    `${dir}/solve.py`,
    [
      "import os, socket, subprocess, sys",
      `sys.path.insert(0, "${dir}")`,
      "from helper import shout",
      "data = sys.stdin.read().strip()",
      "# Everything a cheat would try: keep the input somewhere it can be read later.",
      `open("${dir}/leak.txt", "w").write(data)`,
      'open("/tmp/leak.txt", "w").write(data)',
      'open(os.path.expanduser("~/leak.txt"), "w").write(data)',
      `subprocess.Popen(["sh", "-c", "sleep 300"], start_new_session=True)`,
      "try:",
      '    socket.create_connection(("1.1.1.1", 53), 2)',
      '    print("network!", file=sys.stderr)',
      "except OSError:",
      '    print("no network", file=sys.stderr)',
      "print(shout(data))",
      "",
    ].join("\n"),
    null,
  );

  const events = await judge(`${dir}/solve.py`, [{ input: `${SECRET_INPUT}\n`, expected: SECRET_INPUT.toUpperCase() }, { input: "abc\n", expected: "wrong" }]);
  const cases = events.filter((e) => e.type === "case");
  record("readsTheRoomsFilesAndPasses", cases[0]?.verdict === "passed", JSON.stringify(cases[0] ?? events).slice(0, 170));
  record("aWrongAnswerFails", cases[1]?.verdict === "failed", cases[1]?.verdict);
  record("doneCountsThem", events.at(-1)?.type === "done" && events.at(-1).passed === 1 && events.at(-1).total === 2, JSON.stringify(events.at(-1)));
  record("noNetwork", /no network/.test(cases[0]?.stderr ?? ""), (cases[0]?.stderr ?? "").trim());

  const c = await judge(`${dir}/hello.c`, [{ input: "", expected: "x" }]).catch(() => []);
  record("aMissingFileIsAnError", c[0]?.type === "error", JSON.stringify(c[0]));
  createFileAtPath(doc, `${dir}/hello.c`, '#include <stdio.h>\nint main(void) { puts("from c"); return 0; }\n', null);
  const compiled = await judge(`${dir}/hello.c`, [{ input: "", expected: "from c" }]);
  record("compilesInTheBox", compiled.some((e) => e.type === "compiling") && compiled.find((e) => e.type === "case")?.verdict === "passed", JSON.stringify(compiled.at(-1)));

  await sleep(2000);
  record("nothingCameBackToTheRoom", !findByPath(doc, `${dir}/leak.txt`));

  // The room's real sandbox has none of it, including the running process.
  createFileAtPath(
    doc,
    `${dir}/look.py`,
    [
      "import os, subprocess",
      `found = [p for p in ("${dir}/leak.txt", "/tmp/leak.txt", os.path.expanduser("~/leak.txt")) if os.path.exists(p)]`,
      'procs = subprocess.run(["sh", "-c", "ps -eo args | grep -c \'[s]leep 300\'"], capture_output=True, text=True).stdout.strip()',
      'print("FOUND", found, "PROCS", procs)',
      "",
    ].join("\n"),
    null,
  );
  const look = await judge(`${dir}/look.py`, [{ input: "" }], false);
  const said = look.find((e) => e.type === "case")?.stdout ?? "";
  record("sandboxHasNoLeak", /FOUND \[\] PROCS 0/.test(said), said.trim() || JSON.stringify(look));

  const left = await docker.listContainers({ all: true, filters: { label: [`codechatter.room=${ROOM}`, "codechatter.role=judge"] } });
  record("theContainerIsGone", left.length === 0, left.map((c) => c.Names[0]).join(","));
} catch (error) {
  record("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(1000);
  provider.destroy();
  socket.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
