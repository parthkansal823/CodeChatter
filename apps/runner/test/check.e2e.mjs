// Check all files (check.ts) through the real runner, in E2ETST: a Python file's type errors from Pyright, with
// their place; a TypeScript project with nothing installed is a note, not a failure; with the full image, go vet
// finds a Printf mistake in a Go module (and on the base image, a note says Go comes with the full one). The
// test's files are removed.
//   node --env-file=../../.env test/check.e2e.mjs        (from apps/runner, with the dev stack running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");
const FULL = (process.env.SANDBOX_IMAGE ?? "").includes("full");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const dir = `chk-${Date.now().toString(36)}`;
try {
  doc.transact(() => {
    createFileAtPath(doc, `${dir}/py/bad.py`, ['count: int = "three"', "print(undefined_name)", ""].join("\n"));
    createFileAtPath(doc, `${dir}/web/tsconfig.json`, '{ "compilerOptions": { "strict": true } }\n');
    createFileAtPath(doc, `${dir}/web/a.ts`, 'const n: number = "x";\n');
    if (FULL) {
      createFileAtPath(doc, `${dir}/gomod/go.mod`, "module example.com/chk\n\ngo 1.24\n");
      createFileAtPath(doc, `${dir}/gomod/main.go`, ["package main", "", 'import "fmt"', "", "func main() {", '\tfmt.Printf("%d\\n", "not a number")', "}", ""].join("\n"));
    }
  });
  // The files reach the sandbox a moment after they're made here.
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const response = await fetch(`${RUNNER}/rooms/${ROOM}/check`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: "{}" });
  const result = await response.json();
  check("answers", response.status === 200 && Array.isArray(result.problems) && typeof result.ms === "number", `${response.status} ${result.ms}ms`);
  const mine = (result.problems ?? []).filter((p) => p.path.startsWith(`${dir}/`));
  const py = mine.filter((p) => p.path === `${dir}/py/bad.py`);
  check("pyrightTypeError", py.some((p) => p.source === "Pyright" && p.severity === "error" && p.line === 1 && /three/.test(p.message)), JSON.stringify(py));
  check("pyrightUndefinedName", py.some((p) => p.line === 2 && /undefined_name/.test(p.message)), JSON.stringify(py.map((p) => p.message)));
  check("pyrightRan", result.checked?.includes("Pyright"), JSON.stringify(result.checked));
  check("typescriptNotInstalledIsANote", result.notes?.some((n) => n.includes(`${dir}/web`) && /npm install/.test(n)) && !mine.some((p) => p.source === "tsc"), JSON.stringify(result.notes));
  if (FULL) {
    const vet = mine.filter((p) => p.source === "go vet");
    check("goVetFindsPrintf", vet.some((p) => p.path === `${dir}/gomod/main.go` && p.line === 6 && /Printf/.test(p.message)), JSON.stringify(vet));
  }
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
