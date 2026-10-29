import type { DatabaseTable, DuckdbListing, QueryResult } from "@codechatter/contracts";

import { MAX_ROWS, PREVIEW_ROWS } from "./database-queries.js";
import type { RoomSandbox } from "./sandbox.js";
import { askPython } from "./sqlite.js";

/**
 * DuckDB in the Databases tool (roadmap §14 D): the room's DuckDB files, and SQL over its
 * CSV, Parquet and JSON files, with DuckDB's Python package (in both images; the parquet
 * and json readers are built in, and nothing is downloaded). Like SQLite (sqlite.ts) it
 * runs in the sandbox inside the jail as the room's user, from the room's folder, so
 * `select * from 'data/sales.csv'` reads the room's file; without a path it's an empty
 * database in memory. A file is opened only if it exists. Its scratch space is in /tmp,
 * not the room.
 *
 *   files     DuckDB files (by their header) and data files (by their extension), at most
 *             50 and 200, dependency and build folders skipped
 *   tables    a file's tables and views, or without one the data files, by path
 *   query     each statement in turn; INSERT, UPDATE and DELETE say how many rows changed,
 *             other statements without rows say "Done."
 */
const SCRIPT = String.raw`
import json, os, sys

request = json.loads(sys.stdin.buffer.readline())
op = request["op"]
SKIP = {"node_modules", ".git", ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", "dist", "build", "target", ".cache", ".npm"}
DATA = (".csv", ".tsv", ".parquet", ".json", ".jsonl", ".ndjson")
CELL = 2000

def done(value):
    sys.stdout.write(json.dumps(value))
    sys.exit(0)

def cell(value):
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return "<%d bytes>" % len(value)
    if isinstance(value, float):
        text = repr(value)
    elif isinstance(value, (list, tuple, dict)):
        text = json.dumps(value, default=str)
    else:
        text = str(value)
    return text if len(text) <= CELL else text[:CELL] + "…"

def walk():
    looked = 0
    for root, dirs, files in os.walk("/workspace"):
        dirs[:] = sorted(d for d in dirs if d not in SKIP)
        for name in sorted(files):
            looked += 1
            if looked > 20000:
                return
            yield os.path.join(root, name)

def data_files():
    for full in walk():
        if full.lower().endswith(DATA):
            yield full

if op == "files":
    found, data = [], []
    for full in walk():
        relative = os.path.relpath(full, "/workspace")
        try:
            if full.lower().endswith(DATA):
                if len(data) < 200:
                    data.append({"path": relative, "bytes": os.path.getsize(full)})
                continue
            with open(full, "rb") as handle:
                if handle.read(12)[8:12] == b"DUCK" and len(found) < 50:
                    found.append({"path": relative, "bytes": os.path.getsize(full)})
        except OSError:
            pass
    done({"files": found, "data": data})

if op == "tables" and not request.get("path"):
    done([{"name": os.path.relpath(full, "/workspace"), "detail": full.rsplit(".", 1)[-1].lower()} for full, _ in zip(data_files(), range(200))])

import duckdb

os.makedirs("/tmp/cc-duckdb", exist_ok=True)
os.chdir("/workspace")
config = {"autoinstall_known_extensions": False, "temp_directory": "/tmp/cc-duckdb"}
path = request.get("path")
if path and not os.path.isfile(path):
    done({"missing": path + " isn't in the sandbox."})
try:
    db = duckdb.connect(path or ":memory:", config=config)
except Exception as error:
    done({"missing": "Couldn't open " + (path or "DuckDB") + ": " + str(error)})

if op == "tables":
    rows = db.execute("select table_name, table_type from information_schema.tables where table_schema = 'main' order by table_name").fetchall()
    done([dict(name=name, **({"detail": "view"} if kind == "VIEW" else {})) for name, kind in rows])

CHANGES = {"INSERT", "UPDATE", "DELETE"}
ROWS = {"SELECT", "EXPLAIN", "PRAGMA", "CALL", "RELATION"}
results = []
try:
    for statement in db.extract_statements(request["query"]):
        kind = getattr(statement.type, "name", "")
        cursor = db.execute(statement.query)
        columns = [d[0] for d in cursor.description or []]
        if kind in CHANGES or (columns == ["Count"] and kind not in ROWS):
            first = cursor.fetchone() if columns == ["Count"] else None
            count = first[0] if first else None
            if kind in CHANGES and count is not None:
                results.append({"type": "message", "text": "%d %s changed." % (count, "row" if count == 1 else "rows")})
            elif kind == "COPY" and count is not None:
                results.append({"type": "message", "text": "%d %s written." % (count, "row" if count == 1 else "rows")})
            else:
                results.append({"type": "message", "text": "Done."})
            continue
        if not columns:
            results.append({"type": "message", "text": "Done."})
            continue
        limit = request["maxRows"]
        rows = cursor.fetchmany(limit + 1)
        result = {"type": "rows", "columns": columns, "rows": [[cell(v) for v in row] for row in rows[:limit]]}
        if len(rows) > limit:
            result["truncated"] = True
        results.append(result)
    done({"results": results, "error": None})
except Exception as error:
    done({"results": results, "error": str(error)})
`;

/** The room's DuckDB files and data files, as the sandbox has them. */
export function duckdbFiles(sandbox: RoomSandbox): Promise<DuckdbListing> {
  return askPython<DuckdbListing>(sandbox, SCRIPT, { op: "files" });
}

/** A DuckDB file's tables and views, or (without a path) the room's data files. */
export function duckdbTables(sandbox: RoomSandbox, path: string | undefined): Promise<DatabaseTable[]> {
  return askPython<DatabaseTable[]>(sandbox, SCRIPT, { op: "tables", path: path ?? null });
}

export async function duckdbQuery(sandbox: RoomSandbox, path: string | undefined, query: string, maxRows = MAX_ROWS): Promise<QueryResult> {
  const started = Date.now();
  const answer = await askPython<Omit<QueryResult, "ms">>(sandbox, SCRIPT, { op: "query", path: path ?? null, query, maxRows });
  return { ...answer, ms: Date.now() - started };
}

/** A table's first rows, or a data file's (DuckDB reads it by its path), with the query to edit in the console. */
export async function duckdbPreview(sandbox: RoomSandbox, path: string | undefined, name: string): Promise<QueryResult> {
  const source = path ? `"${name.replace(/"/g, '""')}"` : `'${name.replace(/'/g, "''")}'`;
  const query = `select * from ${source} limit ${PREVIEW_ROWS};`;
  return { ...(await duckdbQuery(sandbox, path, query, PREVIEW_ROWS)), query };
}
