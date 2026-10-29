import type { DatabaseTable, QueryResult, SqliteFile } from "@codechatter/contracts";
import { once } from "node:events";
import { PassThrough } from "node:stream";

import { MAX_ROWS, PREVIEW_ROWS } from "./database-queries.js";
import { Collector, ended } from "./databases.js";
import { JAIL } from "./plans.js";
import { exitCodeOnceEnded, type ExecHandle, type RoomSandbox } from "./sandbox.js";

/** A query (or a search for files) that takes longer than this is stopped. */
const TIMEOUT_SECONDS = 30;
/** Backups and loads get as long as the servers' (databases.ts). */
const LONG_SECONDS = 600;
/** Most of a result that comes back: MAX_ROWS rows of wide text. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * SQLite in the Databases tool (roadmap §14 D): the room's SQLite files, read with
 * Python's sqlite3 (in both images, unlike the sqlite3 command), in the sandbox inside
 * the jail like a Run, as the room's user. It opens files that exist and never makes
 * one. The request comes on stdin as one line of JSON (a file to load follows it), and
 * the answer goes to stdout as JSON, or as SQL for a backup.
 *
 *   files     every file under /workspace that starts with SQLite's header (dependency
 *             and build folders skipped), at most 50
 *   tables    its tables and views
 *   query     each statement in turn, rows or how many changed; the first error ends it
 *   dump      a backup as SQL: Python's iterdump, after dropping each table and view, so
 *             loading it again replaces them (as the servers' backups do)
 *   load      SQL run as a script: a seed, or a backup to restore
 */
const SCRIPT = String.raw`
import json, os, sqlite3, sys, urllib.parse

request = json.loads(sys.stdin.buffer.readline())
op = request["op"]
SKIP = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", "dist", "build", "target", ".cache", ".npm"}
CELL = 2000

def done(value):
    sys.stdout.write(json.dumps(value))
    sys.exit(0)

def cell(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return "<%d bytes>" % len(value)
    text = repr(value) if isinstance(value, float) else str(value)
    return text if len(text) <= CELL else text[:CELL] + "…"

if op == "files":
    found, looked = [], 0
    for root, dirs, files in os.walk("/workspace"):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        for name in sorted(files):
            looked += 1
            if looked > 20000 or len(found) >= 50:
                done(found)
            full = os.path.join(root, name)
            try:
                with open(full, "rb") as handle:
                    if handle.read(16) != b"SQLite format 3\x00":
                        continue
                found.append({"path": os.path.relpath(full, "/workspace"), "bytes": os.path.getsize(full)})
            except OSError:
                pass
    done(found)

path = "/workspace/" + request["path"]
if not os.path.isfile(path):
    done({"missing": request["path"] + " isn't in the sandbox."})
try:
    db = sqlite3.connect("file:" + urllib.parse.quote(path) + "?mode=rw", uri=True, timeout=5, isolation_level=None)
    schema = db.execute("select type, name from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by type = 'table', name").fetchall()
except sqlite3.Error as error:
    done({"missing": request["path"] + " isn't a database SQLite can read: " + str(error)})

if op == "tables":
    done([dict(name=name, **({"detail": "view"} if kind == "view" else {})) for kind, name in sorted(schema, key=lambda row: row[1])])

if op == "dump":
    out = sys.stdout
    out.write("-- " + request["path"] + ", from CodeChatter. Loading it again replaces these tables and views.\n")
    out.write("BEGIN TRANSACTION;\n")
    for kind, name in schema:
        out.write('DROP %s IF EXISTS "%s";\n' % (kind.upper(), name.replace('"', '""')))
    for i, line in enumerate(db.iterdump()):
        if i == 0 and line == "BEGIN TRANSACTION;":
            continue
        out.write(line + "\n")
    sys.exit(0)

if op == "load":
    data = sys.stdin.buffer.read()
    if data.startswith(b"SQLite format 3\x00"):
        done({"results": [], "error": "That's a SQLite database file. Load a .sql file (a backup from here is one)."})
    if data.startswith(b"\x1f\x8b"):
        done({"results": [], "error": "That's a compressed archive. Load a .sql file."})
    before = db.total_changes
    try:
        db.executescript(data.decode("utf-8", "replace"))
    except sqlite3.Error as error:
        done({"results": [], "error": str(error)})
    count = db.total_changes - before
    done({"results": [{"type": "message", "text": "Loaded: %d %s changed." % (count, "row" if count == 1 else "rows")}], "error": None})

def statements(sql):
    pieces, current = sql.split(";"), ""
    for i, piece in enumerate(pieces):
        current += piece + (";" if i < len(pieces) - 1 else "")
        if sqlite3.complete_statement(current):
            if current.strip().strip(";").strip():
                yield current
            current = ""
    if current.strip():
        yield current

results = []
try:
    for statement in statements(request["query"]):
        cursor = db.execute(statement)
        if cursor.description:
            limit = request["maxRows"]
            rows = cursor.fetchmany(limit + 1)
            result = {"type": "rows", "columns": [d[0] for d in cursor.description], "rows": [[cell(v) for v in row] for row in rows[:limit]]}
            if len(rows) > limit:
                result["truncated"] = True
            results.append(result)
        else:
            count = cursor.rowcount
            results.append({"type": "message", "text": ("%d %s changed." % (count, "row" if count == 1 else "rows")) if count >= 0 else "Done."})
    done({"results": results, "error": None})
except sqlite3.Error as error:
    done({"results": results, "error": str(error)})
`;

/** Why a database file couldn't answer (SQLite's here, DuckDB's in duckdb.ts), in words for the room. */
export class FileDatabaseError extends Error {}

/** What the script is asked, as one line of JSON: an `op` and what it needs. */
type Request = { op: string } & Record<string, unknown>;

/**
 * The script, started with the request on stdin, followed by `extra` more bytes (a file
 * to load). As formatters read their text (format.ts), it reads exactly that many: the
 * exec's stdin can't be closed on its own on every Docker.
 */
async function start(sandbox: RoomSandbox, script: string, request: Request, extra: number, seconds: number): Promise<{ handle: ExecHandle; head: Buffer }> {
  const head = Buffer.from(`${JSON.stringify(request)}\n`, "utf8");
  const shell = `n=$1; shift; head -c "$n" | timeout ${seconds} python3 -c "$1"`;
  const handle = await sandbox.exec([JAIL, "sh", "-c", shell, "cc-database", String(head.length + extra), script], { tty: false, stdin: true });
  return { handle, head };
}

/** A Python script's JSON answer, once it has read `input` (if any) after the request; `{ missing }` is a FileDatabaseError. */
export async function askPython<T>(sandbox: RoomSandbox, script: string, request: Request, input?: { chunks: AsyncIterable<Buffer | string>; bytes: number }): Promise<T> {
  const { handle, head } = await start(sandbox, script, request, input?.bytes ?? 0, input ? LONG_SECONDS : TIMEOUT_SECONDS);
  const stdout = new Collector(MAX_OUTPUT_BYTES);
  const stderr = new Collector(16 * 1024);
  handle.demux(stdout, stderr);
  const finished = ended(handle.stream);
  handle.stream.write(head);
  if (input) {
    try {
      for await (const chunk of input.chunks) {
        if (handle.stream.destroyed) break;
        if (!handle.stream.write(Buffer.from(chunk))) await once(handle.stream, "drain");
      }
    } catch {
      // It stopped reading (an error part-way); its answer says why.
    }
  }
  await finished;
  const code = await exitCodeOnceEnded(handle);
  handle.stream.destroy();
  if (code === 124) throw new FileDatabaseError(`It took longer than ${input ? LONG_SECONDS : TIMEOUT_SECONDS} seconds and was stopped.`);
  if (code !== 0 || stdout.cut) throw new FileDatabaseError(stderr.text().trim().split("\n").at(-1) || "The database couldn't answer in the sandbox.");
  const answer = JSON.parse(stdout.text()) as T | { missing: string };
  if (answer && typeof answer === "object" && "missing" in answer) throw new FileDatabaseError(answer.missing);
  return answer as T;
}

/** The room's SQLite files, as the sandbox has them. */
export function sqliteFiles(sandbox: RoomSandbox): Promise<SqliteFile[]> {
  return askPython<SqliteFile[]>(sandbox, SCRIPT, { op: "files" });
}

export function sqliteTables(sandbox: RoomSandbox, path: string): Promise<DatabaseTable[]> {
  return askPython<DatabaseTable[]>(sandbox, SCRIPT, { op: "tables", path });
}

/** The console: statements in turn, as for the server databases (a QueryResult). */
export async function sqliteQuery(sandbox: RoomSandbox, path: string, query: string, maxRows = MAX_ROWS): Promise<QueryResult> {
  const started = Date.now();
  const answer = await askPython<Omit<QueryResult, "ms">>(sandbox, SCRIPT, { op: "query", path, query, maxRows });
  return { ...answer, ms: Date.now() - started };
}

/** A table's first rows, with the query that made them to edit in the console. */
export async function sqlitePreview(sandbox: RoomSandbox, path: string, name: string): Promise<QueryResult> {
  const query = `select * from "${name.replace(/"/g, '""')}" limit ${PREVIEW_ROWS};`;
  return { ...(await sqliteQuery(sandbox, path, query, PREVIEW_ROWS)), query };
}

/**
 * A backup as SQL, streamed as it's written: its file name, the dump, and (when it ends)
 * how it went. The file is checked first, so a missing or unreadable one is a
 * FileDatabaseError before anything is sent.
 */
export async function openSqliteDump(
  sandbox: RoomSandbox,
  path: string,
): Promise<{ file: string; body: PassThrough; done: Promise<{ exitCode: number | null; stderr: string }> }> {
  await sqliteTables(sandbox, path);
  const { handle, head } = await start(sandbox, SCRIPT, { op: "dump", path }, 0, LONG_SECONDS);
  const body = new PassThrough();
  const stderr = new Collector(64 * 1024);
  handle.demux(body, stderr);
  const done = ended(handle.stream).then(async () => {
    body.end();
    const exitCode = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    return { exitCode, stderr: stderr.text().trim() };
  });
  handle.stream.write(head);
  const name = path.split("/").at(-1)!.replace(/\.(db|sqlite3?)$/i, "");
  return { file: `${name}-${new Date().toISOString().slice(0, 10)}.sql`, body, done };
}

/** Run SQL through the file as a script: a seed, or a backup to restore. `bytes` is exactly how much `input` holds. */
export async function loadIntoSqlite(sandbox: RoomSandbox, path: string, input: AsyncIterable<Buffer | string>, bytes: number): Promise<QueryResult> {
  const started = Date.now();
  const answer = await askPython<Omit<QueryResult, "ms">>(sandbox, SCRIPT, { op: "load", path }, { chunks: input, bytes });
  return { ...answer, ms: Date.now() - started };
}
