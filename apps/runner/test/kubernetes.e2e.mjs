// The Kubernetes playground in the full sandbox image: the "Kubernetes playground" template's demo
// starts KWOK, rolls out a Deployment whose pods report Running, Helm installs the chart, and k8s down
// stops it, all offline inside the sandbox jail.
//   node --env-file=../../.env test/kubernetes.e2e.mjs      (from apps/runner, with `pnpm dev` running)
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, templateFiles, trash } from "@codechatter/workspace-model";
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
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
const dir = `k8s-${Date.now().toString(36)}`;
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function run(path) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(240_000),
  });
  let output = "";
  let exit = null;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      if (event.type === "exit") exit = event.exit;
    }
  }
  return { output, exit };
}

try {
  // A rebuilt image reaches a running room only when its sandbox restarts (Restart sandbox in the Ports tab).
  const restarted = await fetch(`${RUNNER}/rooms/${ROOM}/sandbox/restart`, { method: "POST", headers: { authorization: token() } });
  record("sandboxRestarts", restarted.ok, String(restarted.status));

  // The template's own files, in a folder of their own.
  for (const file of templateFiles("kubernetes")) createFileAtPath(doc, `${dir}/${file.path}`, file.content, null);
  createFileAtPath(doc, `${dir}/helm.sh`, 'cd "$(dirname "$0")" && helm install shop ./chart --wait=false && helm list && kubectl get deploy shop\n', null);
  createFileAtPath(doc, `${dir}/down.sh`, "k8s down && k8s status\n", null);

  const t0 = Date.now();
  const demo = await run(`${dir}/demo.sh`);
  const running = (demo.output.match(/\bRunning\b/g) ?? []).length;
  record("demoRollsOut", demo.exit?.code === 0 && demo.output.includes('deployment "web" successfully rolled out') && running >= 3, `${Date.now() - t0}ms, ${running} running ${demo.output.slice(-200)}`);

  const helm = await run(`${dir}/helm.sh`);
  record("helmInstalls", helm.exit?.code === 0 && /shop\s+default\s+1\s+.*deployed/.test(helm.output), helm.output.slice(-200));

  const down = await run(`${dir}/down.sh`);
  record("k8sDown", down.exit?.code === 0 && down.output.includes("Not running"), down.output.slice(-120));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await new Promise((r) => setTimeout(r, 800));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
