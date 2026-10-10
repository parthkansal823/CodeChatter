// Rooms can't read each other's files: a file only another room has is in that room's sandbox, and
// nowhere this room's sandbox can read; and this room's sandbox mounts only its own storage.
//   node --env-file=../../.env test/isolation.e2e.mjs      (from apps/runner, with `pnpm dev` running)
// Against either driver: RUNNER_URL picks the runner, and the runner says which driver it runs.
// The other room is made through the API (APP_URL) and deleted at the end, with its sandbox.
import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as k8s from "@kubernetes/client-node";
import Docker from "dockerode";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const APP = process.env.APP_URL ?? "http://localhost:8080";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const health = await fetch(`${RUNNER}/healthz`).then((r) => r.json());
const KUBE = health.driver === "kubernetes";
const NAMESPACE = health.namespace ?? "dev";
console.log(`runner ${RUNNER}: ${health.driver ?? "docker"}, namespace ${NAMESPACE}`);

const results = [];
const record = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const stamp = Date.now().toString(36);
const MARKER = `only-in-the-other-room-${stamp}`;

/** The API, signed in as test1 (the room's owner). */
const jar = new Map();
async function api(path, method = "GET", body) {
  const res = await fetch(new URL(path, APP), {
    method,
    headers: { origin: APP, ...(body && { "content-type": "application/json" }), ...(jar.size && { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }) },
    body: body && JSON.stringify(body),
  });
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const [name, value] = pair.split("=");
    if (value) jar.set(name, value);
  }
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A peer on a room's files document, as the runner is. */
async function filesOf(roomId) {
  const doc = new Y.Doc();
  const name = filesDocName(roomId);
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: name }) });
  provider.attach();
  await new Promise((resolve, reject) => {
    provider.on("synced", resolve);
    setTimeout(() => reject(new Error(`collab sync timed out for ${roomId}`)), 15000);
  });
  return { doc, close: () => (provider.destroy(), socket.destroy()) };
}

const token = (roomId) => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: roomId, uid: "e2e-user", name: "E2E" })}`;
async function run(roomId, doc, path) {
  const res = await fetch(`${RUNNER}/rooms/${roomId}/runs`, {
    method: "POST",
    headers: { authorization: token(roomId), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: Buffer.from(Y.encodeStateVector(doc)).toString("base64") }),
    signal: AbortSignal.timeout(240_000),
  });
  let output = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data;
      if (event.type === "error") output += `ERROR ${event.message}`;
    }
  }
  return output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// Looks for the marker in every file it can read outside /proc, /sys and /dev, and names the places it may read.
// The marker in two halves, so this file itself doesn't contain it.
const PROBE = `import os
MARKER = ${JSON.stringify(MARKER.slice(0, 10))} + ${JSON.stringify(MARKER.slice(10))}
hits, readable = [], []
for top in ["/", "/home", "/tmp", "/var", "/mnt", "/media", "/srv", "/opt", "/data", "/run", "/workspace"]:
    try:
        os.listdir(top)
        readable.append(top)
    except OSError:
        pass
for top in readable:
    if top == "/":
        continue
    for root, dirs, files in os.walk(top):
        dirs[:] = [d for d in dirs if not (root == "/" and d in ("proc", "sys", "dev"))]
        for name in files:
            path = os.path.join(root, name)
            try:
                with open(path, "rb") as f:
                    if MARKER.encode() in f.read(1 << 20):
                        hits.append(path)
            except OSError:
                pass
print("READABLE", ",".join(readable))
print("HITS", ",".join(hits) or "none")
`;

let other = null;
let a = null;
let b = null;
const dir = `iso-${stamp}`;
try {
  const signedIn = await api("/api/auth/sign-in/email", "POST", { email: "test1@codechatter.local", password: "codechatter123" });
  const made = await api("/api/rooms", "POST", { name: `Isolation test ${stamp}` });
  other = made.json?.id ?? made.json?.room?.id ?? null;
  record("otherRoomMade", signedIn.status === 200 && Boolean(other), `${signedIn.status} ${made.status} ${other}`);

  // The other room has a file with the marker, and its own sandbox reads it.
  b = await filesOf(other);
  createFileAtPath(b.doc, `${dir}/secret.txt`, `${MARKER}\n`, null);
  createFileAtPath(b.doc, `${dir}/read.py`, `print(open("${dir}/secret.txt").read().strip())\n`, null);
  const theirs = await run(other, b.doc, `${dir}/read.py`);
  record("theOtherRoomReadsItsFile", theirs.includes(MARKER), theirs.trim().slice(-120));

  // This room looks everywhere it can read for it.
  a = await filesOf(ROOM);
  createFileAtPath(a.doc, `${dir}/probe.py`, PROBE, null);
  const mine = await run(ROOM, a.doc, `${dir}/probe.py`);
  const hits = /HITS (.*)/.exec(mine)?.[1];
  const readable = /READABLE (.*)/.exec(mine)?.[1] ?? "";
  record("probeRan", hits !== undefined, mine.trim().slice(-200));
  record("thisRoomCantFindTheOtherRoomsFile", hits === "none", `found in: ${hits}; it may read ${readable}`);

  // And this room's sandbox has only its own storage.
  if (KUBE) {
    const config = new k8s.KubeConfig();
    config.loadFromDefault();
    const core = config.makeApiClient(k8s.CoreV1Api);
    const pod = await core.readNamespacedPod({ name: "sandbox", namespace: `cc-${NAMESPACE}-${ROOM.toLowerCase()}` });
    const claims = (pod.spec?.volumes ?? []).map((v) => v.persistentVolumeClaim?.claimName).filter(Boolean);
    record("mountsOnlyItsOwnStorage", claims.sort().join(",") === "home,workspace" && pod.metadata?.namespace !== `cc-${NAMESPACE}-${other.toLowerCase()}`, `${pod.metadata?.namespace}: ${claims.join(",")}`);
  } else {
    const info = await new Docker().getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).inspect();
    const volumes = info.Mounts.filter((m) => m.Type === "volume").map((m) => m.Name);
    const own = [`cc-${NAMESPACE}-ws-${ROOM.toLowerCase()}`, `cc-${NAMESPACE}-home-${ROOM.toLowerCase()}`];
    record("mountsOnlyItsOwnStorage", volumes.length > 0 && volumes.every((name) => own.includes(name)), volumes.join(","));
  }
} finally {
  for (const peer of [a, b]) {
    if (!peer) continue;
    const folder = findByPath(peer.doc, dir);
    if (folder) trash(peer.doc, folder.id);
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const peer of [a, b]) peer?.close();
  if (other) {
    // Its sandbox on this runner, then the room itself (the API also tells its own runner).
    await fetch(`${RUNNER}/rooms/${other}`, { method: "DELETE", headers: { authorization: token(other) } }).catch(() => {});
    const removed = await api(`/api/rooms/${other}`, "DELETE");
    record("otherRoomDeleted", removed.status < 300, String(removed.status));
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
