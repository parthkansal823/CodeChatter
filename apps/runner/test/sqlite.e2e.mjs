// SQLite files in the Databases tool (sqlite.ts) through the real runner: a database made in the E2ETST sandbox is
// found by its header (one in node_modules and a file that only looks like one are not); its tables and views; a
// table's first rows, with NULLs, floats, blobs and an awkward name; several statements in turn, the first error
// ending them with the earlier results kept; changes saved; a long result cut at 500 rows; paths outside the room
// refused, a missing file never made, and a file that isn't SQLite explained. Backups: SQL that drops each table and
// view first, which restores the file when loaded again; loading one of the room's files, bad SQL, and a database
// file instead of SQL. The test's folder is removed. Docker driver only (it makes the file with docker exec).
//   node --env-file=../../.env test/sqlite.e2e.mjs        (from apps/runner, with the dev stack running)
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
/** SQL loaded into the file, from the request's body. */
const load = (path, sql) =>
  fetch(`${RUNNER}/rooms/${ROOM}/sqlite/load?path=${encodeURIComponent(path)}&bytes=${Buffer.byteLength(sql)}`, {
    method: "POST",
    headers: { authorization: token(), "content-type": "application/octet-stream" },
    body: sql,
  }).then((r) => r.json());

// The room's files document, for a seed file the room has.
const doc = new Y.Doc();
const docName = filesDocName(ROOM);
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: docName }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});

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

const dir = `sq-${Date.now().toString(36)}`;
const db = `${dir}/app.db`;
const setup = `
import os, sqlite3
os.makedirs("${dir}/node_modules/pkg", exist_ok=True)
db = sqlite3.connect("${db}")
db.executescript('''
create table notes (id integer primary key, body text, score real, data blob);
insert into notes (body, score, data) values ('first', 1.5, x'00ff'), (null, 2.0, null);
create view recent as select id, body from notes order by id desc;
create table "we""ird" (x);
insert into "we""ird" values (7);
''')
db.commit()
skipped = sqlite3.connect("${dir}/node_modules/pkg/skip.db")
skipped.execute("create table t (x)")
skipped.commit()
open("${dir}/fake.sqlite", "wb").write(b"\\x00\\x01 not a database")
print("made")
`;

try {
  // Ask once first, so the sandbox is up for docker exec.
  await call("GET", "sqlite");
  const made = await inSandbox(`python3 -c '${setup.replace(/'/g, `'"'"'`)}'`);
  check("setup", made.includes("made"), made);

  const files = await call("GET", "sqlite");
  const paths = (files.body ?? []).map((f) => f.path);
  check("findsTheFile", files.status === 200 && paths.includes(db) && files.body.find((f) => f.path === db)?.bytes > 0, JSON.stringify(files.body));
  check("skipsDependenciesAndLookalikes", !paths.some((p) => p.includes("node_modules") || p.endsWith("fake.sqlite")), paths.join(", "));

  const tables = await call("POST", "sqlite/tables", { path: db });
  check("tablesAndViews", JSON.stringify(tables.body) === JSON.stringify([{ name: "notes" }, { name: "recent", detail: "view" }, { name: 'we"ird' }]), JSON.stringify(tables.body));

  const preview = await call("POST", "sqlite/preview", { path: db, name: "notes" });
  const set = preview.body?.results?.[0];
  check("previewColumns", JSON.stringify(set?.columns) === JSON.stringify(["id", "body", "score", "data"]), JSON.stringify(set));
  check("previewValues", JSON.stringify(set?.rows) === JSON.stringify([["1", "first", "1.5", "<2 bytes>"], ["2", null, "2.0", null]]), JSON.stringify(set?.rows));
  check("previewQuery", preview.body?.query === 'select * from "notes" limit 100;', preview.body?.query);
  const weird = await call("POST", "sqlite/preview", { path: db, name: 'we"ird' });
  check("awkwardName", weird.body?.results?.[0]?.rows?.[0]?.[0] === "7", JSON.stringify(weird.body));

  const several = await call("POST", "sqlite/query", { path: db, query: "insert into notes (body) values ('third; with a semicolon');\nselect count(*) as n from notes;\nselect * from nope;\nselect 1;" });
  const [changed, counted, extra] = several.body?.results ?? [];
  check("statementsInTurn", changed?.type === "message" && changed.text === "1 row changed." && counted?.rows?.[0]?.[0] === "3" && extra === undefined, JSON.stringify(several.body));
  check("firstErrorEnds", several.body?.error === "no such table: nope" && typeof several.body?.ms === "number", several.body?.error);
  const again = await call("POST", "sqlite/query", { path: db, query: "select body from notes where id = 3" });
  check("changesSaved", again.body?.results?.[0]?.rows?.[0]?.[0] === "third; with a semicolon", JSON.stringify(again.body));

  const long = await call("POST", "sqlite/query", { path: db, query: "with recursive c(i) as (select 1 union all select i + 1 from c where i < 600) select i from c" });
  check("cutAt500", long.body?.results?.[0]?.rows?.length === 500 && long.body.results[0].truncated === true, String(long.body?.results?.[0]?.rows?.length));

  const outside = await call("POST", "sqlite/tables", { path: "../etc/passwd" });
  check("outsideRefused", outside.status === 400, JSON.stringify(outside));
  const missing = await call("POST", "sqlite/query", { path: `${dir}/nothing.db`, query: "create table t (x)" });
  const created = await inSandbox(`test -e ${dir}/nothing.db && echo there || echo absent`);
  check("missingNeverMade", missing.status === 409 && missing.body?.error?.includes("isn't in the sandbox") && created.includes("absent"), `${JSON.stringify(missing.body)} ${created}`);
  const fake = await call("POST", "sqlite/tables", { path: `${dir}/fake.sqlite` });
  check("notSqliteExplained", fake.status === 409 && /isn't a database SQLite can read/.test(fake.body?.error ?? ""), JSON.stringify(fake.body));

  // A backup, and loading it back after the table is emptied.
  const dump = await fetch(`${RUNNER}/rooms/${ROOM}/sqlite/dump?path=${encodeURIComponent(db)}`, { headers: { authorization: token() } });
  const sql = await dump.text();
  check("backupIsSql", dump.status === 200 && dump.headers.get("content-type") === "application/sql" && /filename="app-\d{4}-\d{2}-\d{2}\.sql"/.test(dump.headers.get("content-disposition") ?? ""), dump.headers.get("content-disposition"));
  check("backupDropsFirst", sql.includes('DROP VIEW IF EXISTS "recent";') && sql.includes('DROP TABLE IF EXISTS "notes";') && sql.includes("CREATE TABLE notes") && sql.trim().endsWith("COMMIT;"), sql.slice(0, 300));
  await call("POST", "sqlite/query", { path: db, query: "delete from notes" });
  const restored = await load(db, sql);
  const count = await call("POST", "sqlite/query", { path: db, query: "select count(*) from notes" });
  check("backupRestores", restored.error === null && /^Loaded: \d+ rows changed\.$/.test(restored.results?.[0]?.text ?? "") && count.body?.results?.[0]?.rows?.[0]?.[0] === "3", `${JSON.stringify(restored)} ${JSON.stringify(count.body)}`);

  const seed = createFileAtPath(doc, `${dir}/seed.sql`, "insert into notes (body) values ('seeded');\n");
  // The file reaches the runner's copy of the room's files a moment after it's made here.
  let seeded = null;
  for (let i = 0; i < 20 && !seeded?.results; i++) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 250));
    seeded = await fetch(`${RUNNER}/rooms/${ROOM}/sqlite/load?path=${encodeURIComponent(db)}&file=${encodeURIComponent(`${dir}/seed.sql`)}`, { method: "POST", headers: { authorization: token() } }).then((r) => r.json());
  }
  trash(doc, seed);
  check("loadsARoomFile", seeded.results?.[0]?.text === "Loaded: 1 row changed.", JSON.stringify(seeded));
  const bad = await load(db, "insert into nope values (1);");
  check("badSqlExplained", bad.error === "no such table: nope", JSON.stringify(bad));
  const binary = await load(db, `SQLite format 3\u0000${"x".repeat(100)}`);
  check("databaseFileRefused", /That's a SQLite database file/.test(binary.error ?? ""), JSON.stringify(binary));
  const noFile = await fetch(`${RUNNER}/rooms/${ROOM}/sqlite/dump?path=${encodeURIComponent(`${dir}/nothing.db`)}`, { headers: { authorization: token() } });
  check("missingBackupExplained", noFile.status === 409, String(noFile.status));
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  // The seed file made the folder in the room too.
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await inSandbox(`rm -rf ${dir}`).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1000));
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
