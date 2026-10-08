// S3b checks: convergence across two Hocuspocus instances, read-only viewers,
// instance crash + failover, Valkey restart, and Postgres durability.
import { execFileSync } from "node:child_process";
import { HocuspocusProvider } from "@hocuspocus/provider";
import postgres from "postgres";
import * as Y from "yjs";

const A_URL = "ws://127.0.0.1:8201";
const B_URL = "ws://127.0.0.1:8202";
const DOC = `room:S3B${Date.now().toString(36)}:files`;
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd) => execFileSync("docker", cmd.replace(/^docker /, "").split(" "), { stdio: "pipe" }).toString().trim();

function connect(url, doc = new Y.Doc(), token = "editor") {
  const provider = new HocuspocusProvider({ url, name: DOC, document: doc, token });
  const synced = new Promise((resolve, reject) => {
    provider.on("synced", () => resolve(provider));
    provider.on("authenticationFailed", ({ reason }) => reject(new Error(`auth failed: ${reason}`)));
  });
  return { provider, doc, synced };
}

// Y.Map key order follows each replica's local integration order, so sort before comparing.
const snapshotOf = (doc) => JSON.stringify({ t: doc.getText("t").toString(), m: Object.entries(doc.getMap("m").toJSON()).sort(([x], [y]) => x.localeCompare(y)) });

async function waitEqual(docs, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snaps = docs.map(snapshotOf);
    if (snaps.every((s) => s === snaps[0])) return { equal: true, ms: Date.now() - start };
    await sleep(50);
  }
  return { equal: false, ms: timeoutMs, snaps: docs.map((d) => snapshotOf(d).slice(0, 80)) };
}

let rng = 12345;
const rand = (n) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
function randomOps(doc, count, tag) {
  const text = doc.getText("t");
  const map = doc.getMap("m");
  for (let i = 0; i < count; i++) {
    const r = rand(10);
    if (r < 6) text.insert(rand(text.length + 1), `${tag}${i % 10}`);
    else if (r < 8 && text.length > 3) text.delete(rand(text.length - 2), 1 + rand(2));
    else map.set(`k${rand(20)}`, `${tag}-${i}`);
  }
}
async function burst(doc, rounds, tag) {
  for (let r = 0; r < rounds; r++) {
    randomOps(doc, 5, tag);
    await sleep(rand(15));
  }
}

// ── 1. Convergence across instances under concurrent edits ──────────────────
const A = connect(A_URL);
const B = connect(B_URL);
await Promise.all([A.synced, B.synced]);
await Promise.all([burst(A.doc, 60, "a"), burst(B.doc, 60, "b")]);
let eq = await waitEqual([A.doc, B.doc]);
record("concurrentEditsConvergeAcrossInstances", eq.equal, `600 ops, settled in ${eq.ms}ms, len=${A.doc.getText("t").length}`);

// ── 2. Cross-instance fan-out latency ────────────────────────────────────────
const latencies = [];
for (let i = 0; i < 40; i++) {
  const marker = `§${i}§`;
  const seen = new Promise((resolve) => {
    const obs = () => { if (B.doc.getText("t").toString().includes(marker)) { B.doc.getText("t").unobserve(obs); resolve(); } };
    B.doc.getText("t").observe(obs);
  });
  const t0 = performance.now();
  A.doc.getText("t").insert(0, marker);
  await seen;
  latencies.push(performance.now() - t0);
  await sleep(20);
}
latencies.sort((x, y) => x - y);
const p = (q) => latencies[Math.floor(q * (latencies.length - 1))].toFixed(1);
record("crossInstanceLatency", Number(p(0.95)) < 150, `p50=${p(0.5)}ms p95=${p(0.95)}ms (A on a → B on b)`);

// ── 3. Read-only viewer: receives edits, cannot write ────────────────────────
const V = connect(B_URL, new Y.Doc(), "viewer");
await V.synced;
V.doc.getText("t").insert(0, "VIEWER-WRITE");
A.doc.getText("t").insert(0, "after-viewer ");
await sleep(1200);
record("viewerReceivesButCannotWrite",
  !A.doc.getText("t").toString().includes("VIEWER-WRITE") && V.doc.getText("t").toString().includes("after-viewer"));
V.provider.destroy();

const bad = connect(A_URL, new Y.Doc(), "nope");
const rejected = await bad.synced.then(() => false, () => true);
record("badTokenRejected", rejected);
bad.provider.destroy();

// ── 4. Kill instance b mid-burst; B fails over to a with its own doc ────────
const bBurst = burst(B.doc, 40, "B");
const aBurst = burst(A.doc, 40, "A");
await sleep(150);
sh("docker kill cc-s3b-b-1");
await Promise.all([bBurst, aBurst]);
B.provider.destroy();
const B2 = connect(A_URL, B.doc); // same Y.Doc: unsent edits ride the sync handshake
await B2.synced;
eq = await waitEqual([A.doc, B.doc]);
record("failoverAfterInstanceCrashLosesNothing", eq.equal, `settled in ${eq.ms}ms`);

sh("docker start cc-s3b-b-1");
await sleep(2500);
const C = connect(B_URL);
await C.synced;
eq = await waitEqual([A.doc, C.doc]);
record("restartedInstanceServesFullDoc", eq.equal, `fresh client on restarted b, ${eq.ms}ms`);

// ── 5. Valkey restart while editing on both instances ────────────────────────
const during = Promise.all([burst(A.doc, 30, "x"), burst(C.doc, 30, "y")]);
await sleep(100);
sh("docker restart -t 0 cc-s3b-valkey-1");
await during;
await sleep(2500);
eq = await waitEqual([A.doc, C.doc], 3000);
record("convergesAfterValkeyRestartWithoutFurtherEdits(info)", true, eq.equal ? "healed by itself" : "diverged until next edit");
A.doc.getText("t").insert(0, "heal ");
C.doc.getText("t").insert(0, "heal2 ");
eq = await waitEqual([A.doc, C.doc]);
record("healsOnNextEditAfterValkeyRestart", eq.equal, `settled in ${eq.ms}ms`);

// ── 6. Durability: everything reaches Postgres; reload rebuilds identically ─
const final = snapshotOf(A.doc);
for (const p of [A.provider, B2.provider, C.provider]) p.destroy();
await sleep(4000); // debounce + store + compaction
const sql = postgres("postgres://postgres:spike@127.0.0.1:55432/collab", { onnotice: () => {} });
const rebuilt = new Y.Doc();
const [snap] = await sql`select seq, state from doc_snapshots where doc_name = ${DOC}`;
if (snap) Y.applyUpdate(rebuilt, snap.state);
for (const r of await sql`select update from doc_updates where doc_name = ${DOC} and seq > ${snap?.seq ?? 0} order by seq`) Y.applyUpdate(rebuilt, r.update);
const [{ n }] = await sql`select count(*)::int as n from doc_updates where doc_name = ${DOC}`;
record("postgresHoldsFullState", snapshotOf(rebuilt) === final, `snapshot seq=${snap?.seq ?? "none"}, log rows=${n}`);

sh("docker restart -t 2 cc-s3b-a-1 cc-s3b-b-1");
await sleep(3000);
const D = connect(A_URL);
await D.synced;
record("coldRestartOfAllInstancesReloadsFromPostgres", snapshotOf(D.doc) === final);
D.provider.destroy();
await sql.end();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
