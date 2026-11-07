"""
What's in a room's lakehouse, for the Lakehouse tool (apps/runner/src/lakehouse.ts runs this inside the sandbox). Spark takes most of a
minute to start on one CPU, so this reads the tables with DuckDB's Delta extension, and each table's history from its own commit log,
and runs through MLflow's client.

Takes {"op", "table", "version"} on stdin, and prints one JSON object.
"""
import glob
import json
import os
import re
import sys

import duckdb

WAREHOUSE = os.path.expanduser("~/lakehouse/warehouse")
EXTENSIONS = "/usr/local/lib/codechatter/lakehouse/duckdb-extensions"
MOST_ROWS = 100
MOST_CELL_CHARS = 500
MOST_RUNS = 100


class Refused(Exception):
    """Something the person should be told."""


def connect():
    db = duckdb.connect(config={"extension_directory": EXTENSIONS, "autoinstall_known_extensions": False, "autoload_known_extensions": False})
    db.execute("LOAD delta")
    return db


def table_path(name):
    """Where a table is, as long as that's a table in the warehouse: this name comes from a request."""
    if not isinstance(name, str) or not re.fullmatch(r"[\w][\w.-]{0,127}", name):
        raise Refused("That isn't a table's name.")
    root = os.path.realpath(WAREHOUSE)
    path = os.path.realpath(os.path.join(root, name))
    if os.path.dirname(path) != root or not os.path.isdir(os.path.join(path, "_delta_log")):
        raise Refused(f"There's no table called {name}.")
    return path


def quoted(path):
    return "'" + path.replace("'", "''") + "'"


def size_of(path):
    total = 0
    for folder, _, names in os.walk(path):
        for name in names:
            try:
                total += os.path.getsize(os.path.join(folder, name))
            except OSError:
                pass
    return total


def commits(path):
    """Each version of a table, oldest first, from what Delta Lake wrote when it made it."""
    found = []
    for file in sorted(glob.glob(os.path.join(path, "_delta_log", "*.json"))):
        version = int(os.path.basename(file).split(".")[0])
        info = {}
        with open(file, encoding="utf-8") as lines:
            for line in lines:
                entry = json.loads(line)
                if "commitInfo" in entry:
                    info = entry["commitInfo"]
                    break
        metrics = info.get("operationMetrics") or {}
        found.append({
            "version": version,
            "at": info.get("timestamp"),
            "operation": str(info.get("operation", "?")),
            "rowsWritten": int(metrics.get("numOutputRows") or 0) or None,
            "rowsChanged": int(metrics.get("numUpdatedRows") or metrics.get("numDeletedRows") or 0) or None,
            "engine": str(info.get("engineInfo", ""))[:80],
        })
    return found


def overview():
    if not os.path.isdir(WAREHOUSE):
        return {"tables": []}
    db = connect()
    tables = []
    for name in sorted(os.listdir(WAREHOUSE)):
        path = os.path.join(WAREHOUSE, name)
        if not os.path.isdir(os.path.join(path, "_delta_log")):
            continue
        history = commits(path)
        if not history:
            tables.append({"name": name, "version": 0, "versions": 0, "rows": None, "columns": [], "bytes": size_of(path), "at": None, "problem": "A write to this table never finished, so it has nothing to read. Writing it again with overwrite replaces it."})
            continue
        scan = f"delta_scan({quoted(path)})"
        try:
            columns = [{"name": row[0], "type": row[1]} for row in db.execute(f"DESCRIBE SELECT * FROM {scan}").fetchall()]
            rows = db.execute(f"SELECT count(*) FROM {scan}").fetchone()[0]
            problem = None
        except duckdb.Error as error:
            columns, rows, problem = [], None, str(error)[:300]
        tables.append({"name": name, "version": history[-1]["version"] if history else 0, "versions": len(history), "rows": rows, "columns": columns, "bytes": size_of(path), "at": history[-1]["at"] if history else None, "problem": problem})
    return {"tables": tables}


def history(name):
    return {"table": name, "commits": list(reversed(commits(table_path(name))))}


def preview(name, version):
    path = table_path(name)
    db = connect()
    travel = "" if version is None else f", version => {int(version)}"
    try:
        cursor = db.execute(f"SELECT * FROM delta_scan({quoted(path)}{travel}) LIMIT {MOST_ROWS}")
    except duckdb.Error as error:
        raise Refused(f"Couldn't read that version: {str(error)[:200]}") from error
    columns = [item[0] for item in cursor.description]
    rows = [[None if value is None else str(value)[:MOST_CELL_CHARS] for value in row] for row in cursor.fetchall()]
    return {"table": name, "version": version, "columns": columns, "rows": rows, "truncated": len(rows) == MOST_ROWS}


def experiment_runs():
    import mlflow

    names = {item.experiment_id: item.name for item in mlflow.search_experiments()}
    found = mlflow.search_runs(search_all_experiments=True, max_results=MOST_RUNS, output_format="list", order_by=["attributes.start_time DESC"])
    return {"runs": [{
        "id": run.info.run_id,
        "name": run.info.run_name or run.info.run_id[:8],
        "experiment": names.get(run.info.experiment_id, run.info.experiment_id),
        "status": run.info.status,
        "at": run.info.start_time,
        "ms": (run.info.end_time - run.info.start_time) if run.info.end_time and run.info.start_time else None,
        "params": {key: str(value)[:MOST_CELL_CHARS] for key, value in run.data.params.items()},
        "metrics": dict(run.data.metrics),
    } for run in found]}


def main():
    request = json.load(sys.stdin)
    op = request.get("op")
    if op == "overview":
        return overview()
    if op == "history":
        return history(request.get("table"))
    if op == "preview":
        return preview(request.get("table"), request.get("version"))
    if op == "runs":
        return experiment_runs()
    raise Refused("That isn't something this can do.")


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Refused as error:
        print(json.dumps({"error": str(error)}))
