// DuckDB in the Databases tool (duckdb.ts) through the real runner, in E2ETST: a CSV and a JSON-lines file made in
// the room, a Parquet file and a DuckDB file made in the sandbox; all found (not those in node_modules); the data
// files as the table browser's list, previewed and queried by path from the room's folder (a CSV, a JSON-lines file,
// Parquet, and a join of two); a DuckDB file's tables and views, statements in turn (rows changed, "Done.", rows
// written by COPY, the first error ending them), 500 rows at most; a missing file and paths outside the room. The
// test's files are removed. Docker driver only (it makes the binary files with docker exec).
//   node --env-file=../../.env test/duckdb.e2e.mjs        (from apps/runner, with the dev stack running)
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
const health = await fetch(`${RUNNER}/healthz`).then((r) => r.json());
const NAMESPACE = health.namespace ?? process.env.SANDBOX_NAMESPACE ?? "dev";

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 240)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
async function call(method, path, body) {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/${path}`, {
    method,
    headers: { authorization: token(), "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
const rows = (answer) => answer.body?.results?.[0]?.rows;

const docker = new Docker();
/** A command in the room's sandbox, as the room's user (umask 002, as the runner's own). */
async function inSandbox(script) {
  const exec = await docker.getContainer(`cc-${NAMESPACE}-room-${ROOM.toLowerCase()}`).exec({
    Cmd: ["sh", "-c", `umask 002; ${script}`],
    User: "10001",
    WorkingDir: "/workspace",
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({});
  let text = "";
  stream.on("data", (chunk) => (text += chunk.toString("latin1")));
  await new Promise((resolve) => stream.on("end", resolve));
  return text;
}

const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

const dir = `dk-${Date.now().toString(36)}`;
const db = `${dir}/shop.duckdb`;
const setup = `
import duckdb, os
os.makedirs("${dir}/sub", exist_ok=True)
os.makedirs("${dir}/node_modules/pkg", exist_ok=True)
duckdb.sql("copy (select * from (values ('north', 'pen'), ('south', 'cup')) t(region, item)) to '${dir}/sub/items.parquet'")
open("${dir}/node_modules/pkg/skip.csv", "w").write("a\\n1\\n")
con = duckdb.connect("${db}")
con.execute("create table items (name varchar, price double)")
con.execute("insert into items values ('pen', 1.5), ('cup', 4.0)")
con.execute("create view cheap as select * from items where price < 2")
con.close()
print("made")
`;

try {
  await call("GET", "duckdb");
  doc.transact(() => {
    createFileAtPath(doc, `${dir}/sales.csv`, "region,amount\nnorth,10\nsouth,5\nnorth,7\n");
    createFileAtPath(doc, `${dir}/events.jsonl`, '{"kind":"click","n":2}\n{"kind":"view","n":5}\n');
  });
  const made = await inSandbox(`python3 -c '${setup.replace(/'/g, `'"'"'`)}'`);
  check("setup", made.includes("made"), made);

  // The room's files reach the sandbox a moment after they're made here.
  let listing = null;
  for (let i = 0; i < 40; i++) {
    listing = await call("GET", "duckdb");
    if ((listing.body?.data ?? []).some((f) => f.path === `${dir}/events.jsonl`)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const data = (listing.body?.data ?? []).map((f) => f.path);
  check("findsTheDuckdbFile", listing.body?.files?.some((f) => f.path === db && f.bytes > 0), JSON.stringify(listing.body?.files));
  check("findsTheDataFiles", [`${dir}/sales.csv`, `${dir}/events.jsonl`, `${dir}/sub/items.parquet`].every((p) => data.includes(p)), data.join(", "));
  check("skipsDependencies", !data.some((p) => p.includes("node_modules")), data.join(", "));

  // Without a path: the room's data files.
  const tables = await call("POST", "duckdb/tables", {});
  check("dataFilesAsTables", tables.body?.some?.((t) => t.name === `${dir}/sales.csv` && t.detail === "csv") && tables.body.some((t) => t.name === `${dir}/sub/items.parquet` && t.detail === "parquet"), JSON.stringify(tables.body).slice(0, 200));
  const preview = await call("POST", "duckdb/preview", { name: `${dir}/sales.csv` });
  check("previewsACsv", JSON.stringify(preview.body?.results?.[0]?.columns) === '["region","amount"]' && rows(preview)?.length === 3 && preview.body.query === `select * from '${dir}/sales.csv' limit 100;`, JSON.stringify(preview.body));
  const grouped = await call("POST", "duckdb/query", { query: `select region, sum(amount) as total from '${dir}/sales.csv' group by region order by region` });
  check("queriesACsv", JSON.stringify(rows(grouped)) === '[["north","17"],["south","5"]]', JSON.stringify(grouped.body));
  const json = await call("POST", "duckdb/query", { query: `select sum(n) from '${dir}/events.jsonl'` });
  check("queriesJsonLines", rows(json)?.[0]?.[0] === "7", JSON.stringify(json.body));
  const joined = await call("POST", "duckdb/query", { query: `select i.item, sum(s.amount) from '${dir}/sales.csv' s join '${dir}/sub/items.parquet' i using (region) group by i.item order by i.item` });
  check("joinsCsvAndParquet", JSON.stringify(rows(joined)) === '[["cup","5"],["pen","17"]]', JSON.stringify(joined.body));

  // A DuckDB file.
  const fileTables = await call("POST", "duckdb/tables", { path: db });
  check("tablesAndViews", JSON.stringify(fileTables.body) === '[{"name":"cheap","detail":"view"},{"name":"items"}]', JSON.stringify(fileTables.body));
  const several = await call("POST", "duckdb/query", {
    path: db,
    query: "insert into items values ('ink', 0.5); create table notes (x int); select count(*) as n from cheap; copy items to '/tmp/cc-items.csv'; select * from nope; select 1",
  });
  const texts = (several.body?.results ?? []).map((r) => r.text ?? JSON.stringify(r.rows));
  check("statementsInTurn", JSON.stringify(texts) === JSON.stringify(["1 row changed.", "Done.", '[["2"]]', "3 rows written."]), JSON.stringify(several.body));
  check("firstErrorEnds", /nope/.test(several.body?.error ?? ""), several.body?.error);
  const filePreview = await call("POST", "duckdb/preview", { path: db, name: "items" });
  check("changesSaved", rows(filePreview)?.length === 3 && filePreview.body.query === 'select * from "items" limit 100;', JSON.stringify(filePreview.body));
  const long = await call("POST", "duckdb/query", { query: "select * from range(600)" });
  check("cutAt500", rows(long)?.length === 500 && long.body.results[0].truncated === true, String(rows(long)?.length));

  const missing = await call("POST", "duckdb/query", { path: `${dir}/nothing.duckdb`, query: "create table t (x int)" });
  const created = await inSandbox(`test -e ${dir}/nothing.duckdb && echo there || echo absent`);
  check("missingNeverMade", missing.status === 409 && created.includes("absent"), `${JSON.stringify(missing.body)} ${created}`);
  const outside = await call("POST", "duckdb/tables", { path: "../etc/passwd" });
  check("outsideRefused", outside.status === 400, JSON.stringify(outside));
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  for (const name of ["sales.csv", "events.jsonl"]) {
    const node = findByPath(doc, `${dir}/${name}`);
    if (node) trash(doc, node.id);
  }
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await inSandbox(`rm -rf ${dir} /tmp/cc-items.csv`).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1000));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
