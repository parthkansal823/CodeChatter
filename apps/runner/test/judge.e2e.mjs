// Judge end-to-end against the real runner and sandbox (needs `pnpm dev`).
//   node --env-file=../../.env test/judge.e2e.mjs      (from apps/runner)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST", RUNNER = "http://127.0.0.1:4200", SECRET = process.env.SERVICE_SECRET;
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 140)}` : ""}`); };
const doc = new Y.Doc(); const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: "ws://127.0.0.1:4100", WebSocketPolyfill: WebSocket });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach(); await new Promise((r) => provider.on("synced", r));
const dir = `judge-${Date.now().toString(36)}`;
const put = (name, content) => createFileAtPath(doc, `${dir}/${name}`, content, null);

async function judge(path, cases, timeLimitMs = 2000) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/judge`, {
    method: "POST",
    headers: { authorization: `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e", name: "E2E" })}`, "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64"), cases, timeLimitMs }),
  });
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
}

try {
  put("sum.cpp", "#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;if(a<0)return 3;if(a==7)while(true){}std::cout<<a+b<<std::endl;}\n");
  const events = await judge(`${dir}/sum.cpp`, [
    { input: "2 3\n", expected: "5" },
    { input: "10 20\n", expected: "31\n" },
    { input: "-1 1\n", expected: "0" },
    { input: "7 0\n", expected: "7" },
    { input: "40 2\n" },
  ]);
  const cases = events.filter((e) => e.type === "case");
  check("compilesOnce", events[0]?.type === "compiling", events[0]?.type);
  check("passedVerdict", cases[0]?.verdict === "passed");
  check("wrongAnswerVerdict", cases[1]?.verdict === "failed" && cases[1].stdout.trim() === "30");
  check("runtimeErrorVerdict", cases[2]?.verdict === "error" && cases[2].exitCode === 3);
  check("timeLimitVerdict", cases[3]?.verdict === "timeout", `${cases[3]?.verdict} ${cases[3]?.timeMs}ms`);
  check("customInputShowsOutput", cases[4]?.verdict === "ran" && cases[4].stdout.trim() === "42");
  check("summary", events.at(-1)?.type === "done" && events.at(-1).passed === 1 && events.at(-1).total === 4, JSON.stringify(events.at(-1)));

  put("broken.c", "int main( { return 0; }\n");
  const broken = await judge(`${dir}/broken.c`, [{ input: "", expected: "" }]);
  check("compileErrorShown", broken.some((e) => e.type === "compile-error" && /error/.test(e.output)), broken.map((e) => e.type).join(","));

  put("echo.py", "import sys\nprint(sys.stdin.read().upper(), end='')\n");
  const py = await judge(`${dir}/echo.py`, [{ input: "héllo 'quotes' $HOME\n", expected: "HÉLLO 'QUOTES' $HOME" }]);
  check("inputPassedByteForByte", py.find((e) => e.type === "case")?.verdict === "passed", JSON.stringify(py.find((e) => e.type === "case")?.stdout));
} finally {
  const folder = findByPath(doc, dir); if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 600)); provider.destroy(); socket.destroy();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
