/**
 * Binary room files through the sandbox (dev stack running, base image rebuilt with the
 * current agent): a binary file in the room reaches the sandbox byte for byte, new bytes
 * replace old ones, a binary a program makes comes back into the room and the object
 * store, text written over a binary turns it back into text, and a binary over 5 MB stays
 * in the sandbox. Uses the test room E2ETST and cleans up its files and objects.
 * From apps/runner: node --env-file=../../.env test/blobs.e2e.mjs
 */
import { createHash, randomBytes } from "node:crypto";

import { objectStoreFromEnv } from "@codechatter/auth/s3";
import { signServiceToken } from "@codechatter/auth/service-token";
import { blobKey } from "@codechatter/contracts";
import { createBinaryFileAtPath, createFileAtPath, filesDocName, findByPath, setBlob, textOf, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST";
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");
const store = objectStoreFromEnv(process.env);
if (!store) throw new Error("S3_* missing: binary files need the object store");

const results = [];
const record = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
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

const dir = `e2e-blobs-${Date.now().toString(36)}`;
const stored = [];
const stateVector = () => Buffer.from(Y.encodeStateVector(doc)).toString("base64");

async function run(path, timeoutMs = 90000) {
  const res = await fetch(`${RUNNER}/rooms/${ROOM}/runs`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/json" },
    body: JSON.stringify({ path, stateVector: stateVector() }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let output = "";
  let buffer = "";
  let exit;
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      const event = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (event.type === "output") output += event.data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      if (event.type === "exit") exit = event.exit;
    }
  }
  return { output, exit };
}

async function putBlob(bytes, type = "application/octet-stream") {
  const blob = { sha256: sha256(bytes), size: bytes.length, type };
  await store.put(blobKey(ROOM, blob.sha256), bytes, type);
  stored.push(blobKey(ROOM, blob.sha256));
  return blob;
}

async function waitFor(predicate, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    await sleep(250);
  }
  return null;
}

try {
  // In: a binary file (with NUL bytes, so never mistaken for text) reaches the sandbox intact.
  const first = Buffer.concat([Buffer.from([0, 1, 2, 0xff]), randomBytes(4096)]);
  const blob = await putBlob(first);
  createBinaryFileAtPath(doc, `${dir}/data.bin`, blob, null);
  createFileAtPath(
    doc,
    `${dir}/check.py`,
    [
      "import hashlib, os",
      `data = open("${dir}/data.bin", "rb").read()`,
      'print("SHA", hashlib.sha256(data).hexdigest(), len(data))',
      "",
    ].join("\n"),
    null,
  );
  const checked = await run(`${dir}/check.py`);
  record("binaryReachesSandboxByteForByte", checked.output.includes(`SHA ${blob.sha256} ${first.length}`), checked.output.trim().slice(-120));

  // New bytes replace the old ones.
  const second = Buffer.concat([Buffer.from([0, 9, 9, 9]), randomBytes(2048)]);
  const replaced = await putBlob(second);
  setBlob(doc, findByPath(doc, `${dir}/data.bin`).id, replaced);
  const again = await run(`${dir}/check.py`);
  record("replacedBytesReachSandbox", again.output.includes(`SHA ${replaced.sha256} ${second.length}`), again.output.trim().slice(-120));

  // Out: a binary a program writes becomes a binary file in the room, with its bytes stored.
  createFileAtPath(
    doc,
    `${dir}/make.py`,
    [
      `open("${dir}/out.bin", "wb").write(bytes(range(256)) * 4)`,
      `open("${dir}/big.bin", "wb").write(os.urandom(6 * 1024 * 1024))`,
      'print("MADE")',
      "",
    ]
      .join("\n")
      .replace(/^/, "import os\n"),
    null,
  );
  const made = await run(`${dir}/make.py`);
  record("programRan", made.output.includes("MADE"), made.output.trim().slice(-100));
  const expected = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
  const outNode = await waitFor(() => findByPath(doc, `${dir}/out.bin`)?.blob ?? null);
  record("programsBinaryComesBack", outNode?.sha256 === sha256(expected) && outNode?.size === 1024, JSON.stringify(outNode));
  if (outNode) stored.push(blobKey(ROOM, outNode.sha256));
  const object = outNode ? await store.get(blobKey(ROOM, outNode.sha256)) : null;
  record("itsBytesAreInTheStore", object !== null && Buffer.compare(object.body, expected) === 0);
  await sleep(2500);
  record("binaryOver5MbStaysInSandbox", !findByPath(doc, `${dir}/big.bin`));

  // Text over a binary turns the file back into text.
  createFileAtPath(doc, `${dir}/retext.py`, `open("${dir}/out.bin", "w").write("now text\\n")\nprint("RETEXT")\n`, null);
  const retext = await run(`${dir}/retext.py`);
  const textNode = await waitFor(() => {
    const node = findByPath(doc, `${dir}/out.bin`);
    return node && !node.blob && textOf(doc, node.id)?.toString() === "now text\n" ? node : null;
  });
  record("textOverBinaryBecomesText", retext.output.includes("RETEXT") && textNode !== null);
} catch (error) {
  record("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await sleep(1500);
  for (const key of stored) await store.delete(key).catch(() => undefined);
  provider.destroy();
  socket.destroy();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
