/**
 * Room binary files through the API (dev stack running): upload, download with safe
 * headers, caching and ranges, copying into another room, and who may do what. Uses
 * the test room E2ETST and a disposable room, and deletes the objects it stored.
 * From apps/api: node --env-file=../../.env test/blobs.e2e.mjs
 */
import { createHash, randomBytes } from "node:crypto";

import { objectStoreFromEnv } from "@codechatter/auth/s3";
import { blobKey, roomBlobPrefix } from "@codechatter/contracts";

const BASE = process.env.APP_URL ?? "http://localhost:8080";
const ROOM = "E2ETST";
const results = [];
function check(name, passed, detail = "") {
  results.push(Boolean(passed));
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 180)}` : ""}`);
}

function person() {
  const cookies = new Map();
  return async (path, { method = "GET", json, raw, headers = {} } = {}) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: AbortSignal.timeout(60_000),
      headers: {
        origin: BASE,
        ...(json !== undefined && { "content-type": "application/json" }),
        ...(raw !== undefined && { "content-type": "application/octet-stream" }),
        ...(cookies.size && { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") }),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : raw,
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let body;
    try { body = JSON.parse(bytes.toString("utf8")); } catch { /* binary */ }
    return { status: response.status, headers: response.headers, bytes, body };
  };
}

async function signIn(email) {
  const call = person();
  const res = await call("/api/auth/sign-in/email", { method: "POST", json: { email, password: "codechatter123" } });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`);
  return call;
}

// A real 1×1 PNG, plus random bytes so every run stores new objects.
const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f6f1d20000000049454e44ae426082", "hex"),
  randomBytes(16),
]);
const SHA = createHash("sha256").update(PNG).digest("hex");
const store = objectStoreFromEnv(process.env);
const stored = [];
let other = null;
const owner = await signIn("test1@codechatter.local");
const editor = await signIn("test2@codechatter.local");

try {
  const up = await owner(`/api/rooms/${ROOM}/blobs?type=image%2Fpng&name=dot.png`, { method: "POST", raw: PNG });
  check("upload returns the blob", up.status === 201 && up.body?.sha256 === SHA && up.body?.size === PNG.length && up.body?.type === "image/png", `${up.status} ${JSON.stringify(up.body)}`);
  stored.push(blobKey(ROOM, SHA));
  const again = await owner(`/api/rooms/${ROOM}/blobs?name=dot.png`, { method: "POST", raw: PNG });
  check("the same bytes again give the same blob", again.status === 201 && again.body?.sha256 === SHA && again.body?.type === "image/png", again.status);

  const got = await editor(`/api/rooms/${ROOM}/blobs/${SHA}`);
  check("an editor reads the bytes back", got.status === 200 && Buffer.compare(got.bytes, PNG) === 0, got.status);
  check("served as an image, inline", got.headers.get("content-type") === "image/png" && got.headers.get("content-disposition") === "inline");
  check("no sniffing, sandboxed, same-origin", got.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(got.headers.get("content-security-policy") ?? "") && got.headers.get("cross-origin-resource-policy") === "same-origin");
  check("cached for good by its hash", /immutable/.test(got.headers.get("cache-control") ?? "") && got.headers.get("etag") === `"${SHA}"`);

  const cached = await editor(`/api/rooms/${ROOM}/blobs/${SHA}`, { headers: { "if-none-match": `"${SHA}"` } });
  check("a cached copy gets 304", cached.status === 304, cached.status);
  const part = await editor(`/api/rooms/${ROOM}/blobs/${SHA}`, { headers: { range: "bytes=1-3" } });
  check("a range gets 206 and those bytes", part.status === 206 && part.bytes.toString("hex") === PNG.subarray(1, 4).toString("hex") && part.headers.get("content-range") === `bytes 1-3/${PNG.length}`, part.status);
  const named = await editor(`/api/rooms/${ROOM}/blobs/${SHA}?download=dot%20copy.png`);
  check("download names the file", /^attachment; filename="dot copy.png"/.test(named.headers.get("content-disposition") ?? ""), named.headers.get("content-disposition"));

  const html = Buffer.from("<script>alert(1)</script>");
  const htmlUp = await owner(`/api/rooms/${ROOM}/blobs?type=text%2Fhtml&name=x.html`, { method: "POST", raw: html });
  stored.push(blobKey(ROOM, htmlUp.body?.sha256));
  const htmlGot = await owner(`/api/rooms/${ROOM}/blobs/${htmlUp.body?.sha256}`);
  check("HTML is never served as a page", htmlGot.headers.get("content-type") === "application/octet-stream" && htmlGot.headers.get("content-disposition") === "attachment", htmlGot.headers.get("content-type"));

  const missing = await owner(`/api/rooms/${ROOM}/blobs/${"0".repeat(64)}`);
  check("an unknown blob is 404", missing.status === 404, missing.status);
  const badSha = await owner(`/api/rooms/${ROOM}/blobs/not-a-hash`);
  check("a malformed hash is 400", badSha.status === 400, badSha.status);
  const big = await owner(`/api/rooms/${ROOM}/blobs?name=big.bin`, { method: "POST", raw: Buffer.alloc(20 * 1024 * 1024 + 1) });
  check("over 20 MB is refused with 413", big.status === 413, big.status);
  const empty = await owner(`/api/rooms/${ROOM}/blobs?name=empty.bin`, { method: "POST", raw: Buffer.alloc(0) });
  check("an empty file is fine", empty.status === 201 && empty.body?.size === 0, empty.status);
  if (empty.body?.sha256) stored.push(blobKey(ROOM, empty.body.sha256));

  const made = await owner("/api/rooms", { method: "POST", json: { name: `Blobs e2e ${Date.now().toString(36)}` } });
  other = made.body?.id;
  check("make a disposable room", made.status === 201 && /^[A-Z0-9]{6}$/.test(other ?? ""), made.status);
  const notThere = await owner(`/api/rooms/${other}/blobs/${SHA}`);
  check("another room can't read this room's blob", notThere.status === 404, notThere.status);
  const outsider = await editor(`/api/rooms/${other}/blobs/${SHA}`);
  check("someone outside the room is refused", outsider.status === 403 || outsider.status === 404, outsider.status);
  const outsiderUp = await editor(`/api/rooms/${other}/blobs?name=x.png`, { method: "POST", raw: PNG });
  check("someone outside the room can't upload", outsiderUp.status === 403 || outsiderUp.status === 404, outsiderUp.status);

  const copy = await owner(`/api/rooms/${other}/blobs/copy`, { method: "POST", json: { from: ROOM, sha256: [SHA, "1".repeat(64)] } });
  check("copy brings blobs along and names the missing", copy.status === 200 && copy.body?.copied === 1 && copy.body?.missing?.[0] === "1".repeat(64), `${copy.status} ${JSON.stringify(copy.body)}`);
  stored.push(blobKey(other, SHA));
  const copied = await owner(`/api/rooms/${other}/blobs/${SHA}`);
  check("the copy reads back the same", copied.status === 200 && Buffer.compare(copied.bytes, PNG) === 0, copied.status);
  const stealCopy = await editor(`/api/rooms/${ROOM}/blobs/copy`, { method: "POST", json: { from: other, sha256: [SHA] } });
  check("copying from a room you can't see is refused", stealCopy.status === 403 || stealCopy.status === 404, stealCopy.status);
} catch (error) {
  check("no unexpected error", false, error instanceof Error ? error.stack : String(error));
} finally {
  if (other) {
    const gone = await owner(`/api/rooms/${other}`, { method: "DELETE" });
    check("delete the disposable room", gone.status === 204, gone.status);
    const left = await store?.list(roomBlobPrefix(other));
    check("deleting a room deletes its stored files", left?.keys.length === 0, JSON.stringify(left?.keys));
  }
  for (const key of stored) await store?.delete(key).catch(() => undefined);
  check("stored objects cleaned up", store !== null);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
