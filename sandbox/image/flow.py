"""
The Flow tool's side in the sandbox (apps/runner/src/flow.ts runs this): a room's dbt project, read and built by dbt itself, and its data
read with DuckDB. A build goes on after this returns, so closing the tool doesn't stop it: with --supervise, this runs dbt and keeps
~/flow/live.json up to date, which `status` reads without importing anything heavy, as it's asked often.

Takes {"op", ...} on stdin, and prints one JSON object. Everything here goes in ~/flow, never in the room's files.
"""
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid

WORKSPACE = "/workspace"
DBT = "/usr/local/bin/dbt"
FLOW = os.path.expanduser("~/flow")
MANIFEST = os.path.join(FLOW, "target", "manifest.json")
RESULTS = os.path.join(FLOW, "target", "run_results.json")
WAREHOUSE = os.path.join(FLOW, "warehouse.duckdb")
PROJECT = os.path.join(FLOW, "project")
LIVE = os.path.join(FLOW, "live.json")
STATUS = os.path.join(FLOW, "status.json")
RUNS = os.path.join(FLOW, "runs")
STOP = os.path.join(FLOW, "stop")
LOCK = os.path.join(FLOW, "building")

NOT_PROJECT_FOLDERS = {"node_modules", "venv", "dbt_packages", "target", "logs", "__pycache__"}
MOST_DEPTH = 3
DATASET_KINDS = {"model", "seed", "snapshot"}
RECORDED_COMMANDS = {"build", "run", "test", "seed", "snapshot"}
MOST_RUNS = 20
MOST_LOG_LINES = 2000
SHOWN_LOG_LINES = 200
MOST_LINE_CHARS = 500
MOST_ROWS = 100
MOST_CELL_CHARS = 500
MOST_COMMON_COLUMNS = 12
MOST_COMMON_DISTINCT = 100
BEAT_SECONDS = 1
GONE_AFTER_SECONDS = 20
STOP_WAIT_SECONDS = 5
LOCK_WAIT_SECONDS = 2
ANSI = re.compile(r"\x1b\[[0-9;]*m")
OUT_OF_MEMORY = (-signal.SIGKILL, 128 + signal.SIGKILL)


class Refused(Exception):
    """Something the person should be told."""


def read_json(path):
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return None


def write_json(path, value):
    """Whole or not at all, as `status` can read at any moment."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = f"{path}.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(value, file, default=str)
    os.replace(temporary, path)


def plain(text, most=MOST_LINE_CHARS):
    return ANSI.sub("", str(text or "")).strip()[:most]


def visible_folders(names):
    return sorted(name for name in names if not name.startswith(".") and name not in NOT_PROJECT_FOLDERS)


def find_projects():
    """Folders with a dbt project, nearest the top first. A project's own folders aren't looked in."""
    found = []
    for folder, names, files in os.walk(WORKSPACE):
        depth = 0 if folder == WORKSPACE else os.path.relpath(folder, WORKSPACE).count(os.sep) + 1
        names[:] = visible_folders(names) if depth < MOST_DEPTH else []
        if "dbt_project.yml" in files:
            found.append(folder)
            names[:] = []
    return sorted(found, key=lambda path: (path.count(os.sep), path))


def in_room(path):
    return os.path.relpath(path, WORKSPACE).replace(os.sep, "/")


def last_change(project):
    """Deleting a file changes its folder, so folders count too."""
    newest = os.path.getmtime(project)
    for folder, names, files in os.walk(project):
        names[:] = visible_folders(names)
        for name in [*names, *files]:
            try:
                newest = max(newest, os.path.getmtime(os.path.join(folder, name)))
            except OSError:
                pass
    return newest


def read_text(path):
    try:
        with open(path, encoding="utf-8") as file:
            return file.read().strip()
    except OSError:
        return None


def manifest_is_current(project):
    try:
        return read_text(PROJECT) == project and os.path.getmtime(MANIFEST) >= last_change(project)
    except OSError:
        return False


def errors_in(output):
    """What dbt said was wrong, from its JSON log."""
    found = []
    for line in output.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        info = event.get("info", {}) if isinstance(event, dict) else {}
        if info.get("level") == "error" and plain(info.get("msg")):
            found.append(plain(info.get("msg"), 1000))
    return "\n".join(found)[:2000]


def parse(project):
    """Asks dbt to read the project. Returns what's wrong with it, or None."""
    os.makedirs(FLOW, exist_ok=True)
    try:
        done = subprocess.run([DBT, "--log-format", "json", "--no-use-colors", "parse"], cwd=project, capture_output=True, text=True, errors="replace", timeout=100)
    except subprocess.TimeoutExpired:
        return "dbt took too long to read this project."
    if done.returncode == 0:
        with open(PROJECT, "w", encoding="utf-8") as file:
            file.write(project)
        return None
    return errors_in(done.stdout) or plain(done.stderr or done.stdout, 2000) or f"dbt couldn't read this project (exit code {done.returncode})."


def merge_results():
    """What the last dbt command did, into what's known about each thing: a build of part of the project leaves the rest as it was, and `dbt build` in a terminal counts too."""
    known = read_json(STATUS) or {"merged": None, "nodes": {}}
    results = read_json(RESULTS)
    if not results:
        return known
    invocation = results.get("metadata", {}).get("invocation_id")
    if known["merged"] == invocation or results.get("args", {}).get("which") not in RECORDED_COMMANDS:
        return known
    nodes = (read_json(MANIFEST) or {}).get("nodes", {})
    at = int(os.path.getmtime(RESULTS) * 1000)
    for result in results.get("results", []):
        identity = result.get("unique_id")
        known["nodes"][identity] = {
            "status": result.get("status"),
            "at": at,
            "ms": int((result.get("execution_time") or 0) * 1000),
            "failures": result.get("failures"),
            "message": plain(result.get("message"), 2000) or None,
            "relation": result.get("relation_name"),
            "checksum": (nodes.get(identity, {}).get("checksum") or {}).get("checksum"),
        }
    known["merged"] = invocation
    write_json(STATUS, known)
    return known


def shown_result(known):
    return {key: known.get(key) for key in ("status", "at", "ms", "failures", "message")} if known else None


def describe(manifest, project):
    known = merge_results()["nodes"]
    file_in_room = lambda relative: in_room(os.path.join(project, relative)) if relative else None
    datasets = []
    checks = []
    for identity, node in manifest.get("nodes", {}).items():
        kind = node.get("resource_type")
        result = known.get(identity)
        if kind in DATASET_KINDS:
            checksum = (node.get("checksum") or {}).get("checksum")
            datasets.append({
                "id": identity,
                "kind": kind,
                "name": node.get("name"),
                "language": node.get("language") if kind != "seed" else None,
                "file": file_in_room(node.get("original_file_path")),
                "description": plain(node.get("description"), 1000),
                "materialized": node.get("config", {}).get("materialized"),
                "dependsOn": node.get("depends_on", {}).get("nodes", []),
                "result": shown_result(result),
                "changed": bool(result and result.get("checksum") and result["checksum"] != checksum),
            })
        elif kind == "test":
            metadata = node.get("test_metadata") or {}
            depends = node.get("depends_on", {}).get("nodes", [])
            kwargs = metadata.get("kwargs") or {}
            checks.append({
                "id": identity,
                "name": node.get("name"),
                "rule": metadata.get("name"),
                "column": node.get("column_name"),
                "values": kwargs.get("values") if isinstance(kwargs.get("values"), list) else None,
                "severity": str(node.get("config", {}).get("severity") or "error").lower(),
                "of": node.get("attached_node") or (depends[0] if depends else None),
                "file": file_in_room(node.get("original_file_path")),
                "result": shown_result(result),
            })
    for identity, source in manifest.get("sources", {}).items():
        datasets.append({
            "id": identity,
            "kind": "source",
            "name": f"{source.get('source_name')}.{source.get('name')}",
            "language": None,
            "file": file_in_room(source.get("original_file_path")),
            "description": plain(source.get("description"), 1000),
            "materialized": None,
            "dependsOn": [],
            "result": None,
            "changed": False,
        })
    known_ids = {item["id"] for item in datasets}
    for item in datasets:
        item["dependsOn"] = [identity for identity in item["dependsOn"] if identity in known_ids]
    datasets.sort(key=lambda item: item["id"])
    checks.sort(key=lambda item: item["id"])
    return datasets, checks


def graph():
    live = status()
    projects = find_projects()
    if not projects:
        return {"project": None, "datasets": [], "checks": [], "problem": None, "live": live}
    project = projects[0]
    # dbt is using the manifest while it builds, and the build's own copy is good enough.
    problem = None if live["state"] == "running" or manifest_is_current(project) else parse(project)
    manifest = read_json(MANIFEST) if read_text(PROJECT) == project else None
    datasets, checks = describe(manifest, project) if manifest else ([], [])
    name = (manifest or {}).get("metadata", {}).get("project_name")
    summary = {"path": in_room(project), "name": name or os.path.basename(project), "others": len(projects) - 1}
    return {"project": summary, "datasets": datasets, "checks": checks, "problem": problem, "live": status()}


def is_gone(live):
    return live.get("state") == "running" and time.time() - float(live.get("beat") or 0) > GONE_AFTER_SECONDS


def release_lock():
    try:
        os.rmdir(LOCK)
    except OSError:
        pass


def status():
    live = read_json(LIVE)
    if not live:
        return {"state": "idle", "id": None, "nodes": {}, "log": []}
    if is_gone(live):
        live.update(state="failed", finishedAt=int(time.time() * 1000), message="The build stopped before it finished, as the sandbox stopped or restarted.")
        write_json(LIVE, live)
        release_lock()
    return live


def take_lock():
    """A build says it's over just before it lets go, and another can be asked for just as it's about to say it has started: a moment's wait covers both. After that, nothing is behind this lock: its build is gone, or what said so was removed."""
    give_up = time.time() + LOCK_WAIT_SECONDS
    while True:
        try:
            os.mkdir(LOCK)
            return
        except FileExistsError:
            if status()["state"] == "running":
                raise Refused("A build is already running.") from None
            if time.time() > give_up:
                release_lock()
            else:
                time.sleep(0.1)


def build(request):
    projects = find_projects()
    if not projects:
        raise Refused("This room doesn't have a dbt project yet.")
    os.makedirs(FLOW, exist_ok=True)
    take_lock()
    dataset = request.get("dataset")
    scope = request.get("scope")
    args = []
    if dataset:
        args += ["--select", {"needs": f"+{dataset}", "after": f"{dataset}+"}.get(scope, dataset)]
    if request.get("fresh"):
        args.append("--full-refresh")
    now = time.time()
    live = {
        "state": "running",
        "id": f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime(now))}-{uuid.uuid4().hex[:6]}",
        "by": plain(request.get("by"), 80) or None,
        "dataset": dataset,
        "scope": scope if dataset else None,
        "fresh": bool(request.get("fresh")),
        "project": projects[0],
        "args": args,
        "startedAt": int(now * 1000),
        "finishedAt": None,
        "beat": now,
        "nodes": {},
        "counts": None,
        "message": None,
        "log": [],
    }
    write_json(LIVE, live)
    with open(PROJECT, "w", encoding="utf-8") as file:
        file.write(projects[0])
    try:
        os.unlink(STOP)
    except OSError:
        pass
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "--supervise"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    return live


def stop():
    live = status()
    if live.get("state") != "running":
        raise Refused("Nothing is being built.")
    with open(STOP, "w", encoding="utf-8"):
        pass
    return live


def supervise():
    """Runs dbt to its end, keeping `live` up to date. Asked to stop by a file, as what's asking runs in a jail of its own and can't signal this."""
    live = read_json(LIVE)
    lines = []
    errors = []
    nodes = {}
    started = time.time()
    child = None
    stopping = False
    try:
        child = subprocess.Popen([DBT, "--log-format", "json", "--no-use-colors", "build", *live["args"]], cwd=live["project"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")

        def read():
            for line in child.stdout:
                try:
                    event = json.loads(line)
                    info = event["info"]
                except (ValueError, KeyError, TypeError):
                    if line.strip():
                        lines.append(plain(line))
                    continue
                message = plain(info.get("msg"))
                if message and info.get("level") in ("info", "warn", "error"):
                    lines.append(message)
                if message and info.get("level") == "error":
                    errors.append(plain(info.get("msg"), 1000))
                node = (event.get("data") or {}).get("node_info") or {}
                if node.get("unique_id") and node.get("node_status"):
                    nodes[node["unique_id"]] = "running" if node["node_status"] in ("started", "compiling", "executing") else node["node_status"]

        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        written = 0
        written_lines = 0
        stop_by = None
        while child.poll() is None:
            time.sleep(0.25)
            now = time.time()
            if not stopping and os.path.exists(STOP):
                stopping = True
                stop_by = now + STOP_WAIT_SECONDS
                child.send_signal(signal.SIGINT)
            if stopping and now > stop_by:
                child.kill()
            # Each step as it happens, and otherwise often enough to show this is still going.
            if len(lines) != written_lines or now - written >= BEAT_SECONDS:
                written_lines = len(lines)
                live.update(beat=now, nodes=dict(nodes), log=lines[-SHOWN_LOG_LINES:])
                write_json(LIVE, live)
                written = now
        reader.join(timeout=5)
        code = child.returncode

        results = read_json(RESULTS) if os.path.exists(RESULTS) and os.path.getmtime(RESULTS) >= started - 1 else None
        if results:
            merge_results()
            nodes.update({item["unique_id"]: item["status"] for item in results.get("results", []) if item.get("unique_id")})
        for identity, state in nodes.items():
            if state == "running":
                nodes[identity] = "stopped"
        values = list(nodes.values())
        counts = {
            "done": sum(value in ("success", "pass", "partial success", "no-op") for value in values),
            "warned": values.count("warn"),
            "failed": values.count("error") + values.count("fail"),
            "skipped": values.count("skipped"),
        }
        message = None
        if stopping:
            state = "stopped"
        elif code == 0:
            state = "warned" if counts["warned"] else "succeeded"
        else:
            state = "failed"
            if code in OUT_OF_MEMORY:
                message = "dbt was stopped as this room's sandbox ran out of memory."
            elif not counts["failed"]:
                message = "\n".join(errors)[:2000] or f"dbt stopped with exit code {code}."
        live.update(state=state, nodes=nodes, counts=counts, message=message)
    except Exception as error:  # Whatever went wrong, whoever's watching needs to know the build is over.
        if child and child.poll() is None:
            child.kill()
        live.update(state="failed", nodes=nodes, message=plain(error, 2000))
    finally:
        now = time.time()
        live.update(beat=now, finishedAt=int(now * 1000), log=lines[-SHOWN_LOG_LINES:])
        write_json(LIVE, live)
        write_json(os.path.join(RUNS, f"{live['id']}.json"), {**live, "log": lines[-MOST_LOG_LINES:]})
        for old in sorted(os.listdir(RUNS), reverse=True)[MOST_RUNS:]:
            try:
                os.unlink(os.path.join(RUNS, old))
            except OSError:
                pass
        try:
            os.unlink(STOP)
        except OSError:
            pass
        release_lock()


def runs():
    if not os.path.isdir(RUNS):
        return {"runs": []}
    found = []
    for name in sorted(os.listdir(RUNS), reverse=True):
        run = read_json(os.path.join(RUNS, name))
        if run:
            found.append({key: run.get(key) for key in ("id", "by", "state", "dataset", "scope", "fresh", "startedAt", "finishedAt", "counts", "message")})
    return {"runs": found}


def one_run(identity):
    run = read_json(os.path.join(RUNS, f"{identity}.json"))
    if not run:
        raise Refused("That run isn't kept any more.")
    return run


def relation_of(name):
    """Where a dataset is, as long as dbt knows it: this name comes from a request."""
    manifest = read_json(MANIFEST) or {}
    for node in manifest.get("nodes", {}).values():
        if node.get("resource_type") in DATASET_KINDS and node.get("name") == name:
            return node.get("relation_name")
    for source in manifest.get("sources", {}).values():
        if f"{source.get('source_name')}.{source.get('name')}" == name:
            return source.get("relation_name")
    raise Refused(f"There's no dataset called {name}.")


def warehouse():
    """Read-only, so nothing here can change what's been built."""
    import duckdb

    if not os.path.exists(WAREHOUSE):
        return None, duckdb
    try:
        return duckdb.connect(WAREHOUSE, read_only=True), duckdb
    except duckdb.IOException as error:
        if "lock" in str(error).lower():
            raise Refused("dbt is using the data right now. It can be read when the build has finished.") from error
        raise


def cell(value):
    return None if value is None else str(value)[:MOST_CELL_CHARS]


def rows_of(db, relation, name):
    cursor = db.execute(f"SELECT * FROM {relation} LIMIT {MOST_ROWS + 1}")
    columns = [item[0] for item in cursor.description]
    types = [str(item[1]) for item in cursor.description]
    rows = [[cell(value) for value in row] for row in cursor.fetchmany(MOST_ROWS + 1)]
    return {"name": name, "columns": columns, "types": types, "rows": rows[:MOST_ROWS], "truncated": len(rows) > MOST_ROWS, "built": True}


NOT_BUILT = {"columns": [], "types": [], "rows": [], "truncated": False, "built": False}


def preview(name):
    relation = relation_of(name)
    db, duckdb = warehouse()
    if db is None:
        return {"name": name, **NOT_BUILT}
    try:
        return rows_of(db, relation, name)
    except duckdb.CatalogException:
        return {"name": name, **NOT_BUILT}


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def profile(name):
    relation = relation_of(name)
    db, duckdb = warehouse()
    if db is None:
        return {"name": name, "built": False, "rows": None, "columns": []}
    try:
        cursor = db.execute(f"SUMMARIZE SELECT * FROM {relation}")
    except duckdb.CatalogException:
        return {"name": name, "built": False, "rows": None, "columns": []}
    names = [item[0] for item in cursor.description]
    summary = [dict(zip(names, row)) for row in cursor.fetchall()]
    total = db.execute(f"SELECT count(*) FROM {relation}").fetchone()[0]
    columns = []
    looked_at = 0
    for item in summary:
        distinct = int(item.get("approx_unique") or 0)
        top = []
        # Numbers are better told by their spread than their common values.
        numeric = re.match(r"(TINY|SMALL|BIG|HUGE|U)?(INT|FLOAT|DOUBLE|DECIMAL)", str(item.get("column_type")))
        if not numeric and 0 < distinct <= MOST_COMMON_DISTINCT and looked_at < MOST_COMMON_COLUMNS:
            looked_at += 1
            column = quoted(item["column_name"])
            top = [{"value": cell(value), "count": count} for value, count in db.execute(f"SELECT {column}, count(*) AS n FROM {relation} GROUP BY 1 ORDER BY n DESC, 1 LIMIT 5").fetchall()]
        columns.append({
            "name": item.get("column_name"),
            "type": str(item.get("column_type")),
            "nulls": float(item.get("null_percentage") or 0),
            "distinct": distinct,
            "min": cell(item.get("min")),
            "max": cell(item.get("max")),
            "mean": cell(item.get("avg")),
            "std": cell(item.get("std")),
            "q25": cell(item.get("q25")),
            "q50": cell(item.get("q50")),
            "q75": cell(item.get("q75")),
            "top": top,
        })
    return {"name": name, "built": True, "rows": total, "columns": columns}


def failures(check):
    """The rows a check found wrong, which dbt keeps from its last run."""
    known = merge_results()["nodes"].get(check)
    relation = known.get("relation") if known else None
    if not relation:
        raise Refused("This check hasn't kept any rows. It keeps them when it runs in a build.")
    db, duckdb = warehouse()
    if db is None:
        raise Refused("Nothing has been built yet.")
    try:
        return rows_of(db, relation, check)
    except duckdb.CatalogException as error:
        raise Refused("The rows this check found aren't there any more. Build it again.") from error


def main():
    request = json.load(sys.stdin)
    op = request.get("op")
    if op == "graph":
        return graph()
    if op == "status":
        return status()
    if op == "build":
        return build(request)
    if op == "stop":
        return stop()
    if op == "preview":
        return preview(request.get("dataset"))
    if op == "profile":
        return profile(request.get("dataset"))
    if op == "failures":
        return failures(request.get("check"))
    if op == "runs":
        return runs()
    if op == "run":
        return one_run(request.get("id"))
    raise Refused("That isn't something this can do.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--supervise"]:
        supervise()
    else:
        try:
            print(json.dumps(main(), default=str))
        except Refused as error:
            print(json.dumps({"error": str(error)}))
