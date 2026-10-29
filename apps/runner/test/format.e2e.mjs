// Format document in the sandbox (roadmap §14 A): Python (Ruff), C and C++ (clang-format, which follows a
// .clang-format file next to the code), shell (shfmt, with the editor's indentation), Go (gofmt), Rust
// (rustfmt) and Java (google-java-format). Code with a syntax error comes back with the formatter's message, not
// as a change.
//   node --env-file=../../.env test/format.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Go, Rust and Java need the full image (SANDBOX_IMAGE=codechatter-sandbox:full); with the base image they say so.
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import Docker from "dockerode";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");
const FULL = (process.env.SANDBOX_IMAGE ?? "").includes("full");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

async function format(language, path, text, options = {}) {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/format`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ language, path, text, tabSize: 4, insertSpaces: true, ...options }),
    signal: AbortSignal.timeout(120_000),
  });
  return { status: response.status, body: await response.json() };
}

const health = await fetch(`${RUNNER}/healthz`).then((r) => r.json());
const NAMESPACE = health.namespace ?? process.env.SANDBOX_NAMESPACE ?? "dev";
const docker = new Docker();
/** A command in the room's sandbox, as the room's user (Docker driver). */
async function inSandbox(script) {
  const exec = await docker.getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).exec({ Cmd: ["sh", "-c", `umask 002; ${script}`], User: "10001", WorkingDir: "/workspace", AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({});
  let text = "";
  stream.on("data", (chunk) => (text += chunk.toString("latin1")));
  await new Promise((resolve) => stream.on("end", resolve));
  return text;
}

const dir = `fmt-${Date.now().toString(36)}`;
const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

try {
  const py = await format("python", `${dir}/a.py`, "def f(a,b):\n  return {'x':a+b}\nprint( f(1,2) )\n");
  record("python", py.status === 200 && py.body.text === 'def f(a, b):\n    return {"x": a + b}\n\n\nprint(f(1, 2))\n', JSON.stringify(py.body));

  const broken = await format("python", `${dir}/b.py`, "def f(:\n  pass\n");
  record("syntaxErrorExplained", broken.status === 409 && /Expected a parameter/.test(broken.body.error ?? ""), JSON.stringify(broken.body));

  const c = await format("c", `${dir}/a.c`, "int main(){int x=1;if(x){return 0;}}\n");
  record("c", c.status === 200 && c.body.text.includes("int main() {\n  int x = 1;"), JSON.stringify(c.body));

  // A .clang-format file next to the code wins over the default style.
  createFileAtPath(doc, `${dir}/.clang-format`, "BasedOnStyle: LLVM\nIndentWidth: 8\n", null);
  await sleep(2500); // into the sandbox
  const cpp = await format("cpp", `${dir}/b.cpp`, "int main(){int x=1;return x;}\n");
  record("followsClangFormatFile", cpp.status === 200 && cpp.body.text.includes("\n        int x = 1;"), JSON.stringify(cpp.body));

  const sh = await format("shell", `${dir}/a.sh`, "if true; then\necho hi\nfi\n", { tabSize: 2 });
  record("shellWithEditorIndent", sh.status === 200 && sh.body.text === "if true; then\n  echo hi\nfi\n", JSON.stringify(sh.body));

  const go = await format("go", `${dir}/main.go`, "package main\nfunc main(){\nprintln(1)\n}\n");
  if (FULL) record("go", go.status === 200 && go.body.text === "package main\n\nfunc main() {\n\tprintln(1)\n}\n", JSON.stringify(go.body));
  else record("goNeedsFullImage", go.status === 409 && /full image/.test(go.body.error), JSON.stringify(go.body));

  const rs = await format("rust", `${dir}/main.rs`, "fn main(){let x=1;println!(\"{}\",x);}\n");
  if (FULL) record("rust", rs.status === 200 && rs.body.text.includes('fn main() {\n    let x = 1;\n    println!("{}", x);\n}'), JSON.stringify(rs.body));
  else record("rustNeedsFullImage", rs.status === 409 && /full image/.test(rs.body.error), JSON.stringify(rs.body));
  const java = await format("java", `${dir}/Main.java`, "public class Main{public static void main(String[] args){int x=1;System.out.println(x);}}\n");
  if (FULL) record("java", java.status === 200 && java.body.text === "public class Main {\n  public static void main(String[] args) {\n    int x = 1;\n    System.out.println(x);\n  }\n}\n", JSON.stringify(java.body));
  else record("javaNeedsFullImage", java.status === 409 && /full image/.test(java.body.error), JSON.stringify(java.body));

  // The project's own Prettier: the nearest node_modules/.bin/prettier above the file, given the file's path. A
  // stand-in made in the sandbox (dependency folders don't sync), so no download: it says what it was given.
  const noPrettier = await format("prettier", `${dir}/web/src/a.js`, "let x=1\n");
  record("prettierNotInstalledExplained", noPrettier.status === 409 && /npm install/.test(noPrettier.body.error ?? ""), JSON.stringify(noPrettier.body));
  await inSandbox(`mkdir -p ${dir}/web/node_modules/.bin && printf '#!/bin/sh\\necho "formatted $2: $(cat)"\\n' > ${dir}/web/node_modules/.bin/prettier && chmod +x ${dir}/web/node_modules/.bin/prettier`);
  const pretty = await format("prettier", `${dir}/web/src/a.js`, "let x=1");
  record("prettierFromTheProject", pretty.status === 200 && pretty.body.text.trim() === `formatted /workspace/${dir}/web/src/a.js: let x=1`, JSON.stringify(pretty.body));

  const unknown = await format("cobol", `${dir}/a.cob`, "x");
  record("unknownLanguage", unknown.status === 409, JSON.stringify(unknown.body));

  const noAuth = await fetch(`${RUNNER}/rooms/${ROOM}/format`, { method: "POST", body: "{}" });
  record("needsAToken", noAuth.status === 401, String(noAuth.status));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await inSandbox(`rm -rf ${dir}`).catch(() => {});
  await sleep(800);
  provider.destroy();
  socket.destroy();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
