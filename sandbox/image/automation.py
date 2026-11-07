"""
The Automations tool's side in the sandbox (apps/runner/src/automations.ts runs this): it queues a flow in the room's files for image/automation/host.mjs, which runs
it with Activepieces' engine, and reads what happened. Runs carry on after this returns, and everything they keep is in ~/automations, never in the room's files.

Takes {"op", ...} on stdin, and prints one JSON object. It's asked often while something runs, so it imports nothing heavy.
"""
import json
import os
import re
import subprocess
import sys
import time
import uuid

WORKSPACE = "/workspace"
HOST = "/usr/local/lib/codechatter/automation/host.mjs"
MANIFEST = "/usr/local/lib/codechatter/automation/manifest.json"
HOME = os.path.expanduser("~/automations")
QUEUE = os.path.join(HOME, "queue")
RUNS = os.path.join(HOME, "runs")
LIVE = os.path.join(HOME, "live.json")
STOP = os.path.join(HOME, "stop")
LOCK = os.path.join(HOME, "worker")
MOST_QUEUED = 20
MOST_FLOW_BYTES = 2 * 1024 * 1024
MOST_PAYLOAD_BYTES = 1024 * 1024
LEAST_SECONDS = 5
MOST_SECONDS = 900
DEFAULT_SECONDS = 300
GONE_AFTER_SECONDS = 20
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class Refused(Exception):
    """Something the person should be told."""


def read_json(path):
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return None


def write_json(path, value, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = f"{path}.{os.getpid()}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(descriptor, "w", encoding="utf-8") as file:
        json.dump(value, file)
    os.replace(temporary, path)


def flow_at(path):
    """A flow in the room's files: this path comes from a request."""
    full = os.path.realpath(os.path.join(WORKSPACE, str(path)))
    if not full.startswith(WORKSPACE + os.sep) or not os.path.isfile(full):
        raise Refused(f"There's no file called {path}.")
    if os.path.getsize(full) > MOST_FLOW_BYTES:
        raise Refused("That flow is too big to run.")
    flow = read_json(full)
    if not isinstance(flow, dict) or not isinstance(flow.get("trigger"), dict):
        raise Refused(f"{path} isn't a flow.")
    return flow


def is_gone(live):
    return live.get("state") == "running" and time.time() * 1000 - float(live.get("beat") or 0) > GONE_AFTER_SECONDS * 1000


def queued():
    try:
        return len([name for name in os.listdir(QUEUE) if name.endswith(".json")])
    except OSError:
        return 0


def status():
    live = read_json(LIVE)
    if not live:
        return {"state": "idle", "id": None, "steps": {}, "queued": queued()}
    if is_gone(live):
        now = int(time.time() * 1000)
        live.update(state="finished", status="FAILED", finishedAt=now, message="The run stopped before it finished, as the sandbox stopped or restarted.")
        write_json(LIVE, live, 0o644)
        write_json(os.path.join(RUNS, f"{live['id']}.json"), live, 0o644)
        release_lock()
    return {**live, "queued": queued()}


def release_lock():
    try:
        os.rmdir(LOCK)
    except OSError:
        pass


def start_worker():
    """A worker goes through the queue and leaves. If one's there, it'll get to this job too."""
    try:
        os.mkdir(LOCK)
    except FileExistsError:
        live = read_json(LIVE) or {}
        age = time.time() - os.path.getmtime(LOCK)
        if live.get("state") == "running" and not is_gone(live) or age < GONE_AFTER_SECONDS:
            return
        release_lock()
        os.mkdir(LOCK)
    subprocess.Popen(["node", HOST], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)


def run(request):
    path = request.get("path")
    flow = flow_at(path)
    payload = request.get("payload")
    if len(json.dumps(payload)) > MOST_PAYLOAD_BYTES:
        raise Refused("What was sent to this flow is over 1 MB.")
    os.makedirs(QUEUE, exist_ok=True)
    if queued() >= MOST_QUEUED:
        raise Refused("This room already has 20 runs waiting. Try again when some have finished.")
    now = time.time()
    identity = f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime(now))}-{uuid.uuid4().hex[:8]}"
    seconds = request.get("seconds")
    seconds = max(LEAST_SECONDS, min(MOST_SECONDS, seconds)) if isinstance(seconds, int) else DEFAULT_SECONDS
    job = {"id": identity, "path": path, "flow": flow, "payload": payload, "trigger": str(request.get("trigger") or "manual")[:20], "by": str(request.get("by") or "")[:80] or None, "seconds": seconds, "connections": request.get("connections") or {}}
    write_json(os.path.join(QUEUE, f"{int(now * 1000):015d}-{identity}.json"), job)
    start_worker()
    return {"id": identity, "queued": queued()}


def stop():
    live = status()
    if live.get("state") != "running":
        raise Refused("Nothing is running.")
    with open(STOP, "w", encoding="utf-8"):
        pass
    return {"id": live.get("id")}


SHOWN = ("id", "path", "name", "trigger", "by", "status", "message", "startedAt", "finishedAt", "durationMs")


def runs(path):
    if not os.path.isdir(RUNS):
        return {"runs": []}
    found = []
    for name in sorted(os.listdir(RUNS), reverse=True):
        run_file = read_json(os.path.join(RUNS, name))
        if run_file and (not path or run_file.get("path") == path):
            found.append({key: run_file.get(key) for key in SHOWN})
    return {"runs": found}


def one_run(identity):
    if not isinstance(identity, str) or not RUN_ID.match(identity):
        raise Refused("That isn't a run.")
    found = read_json(os.path.join(RUNS, f"{identity}.json"))
    if not found:
        raise Refused("That run isn't kept any more.")
    return found


def manifest():
    found = read_json(MANIFEST)
    if found is None:
        raise Refused("This room's sandbox doesn't have the automation pieces yet. Restarting the sandbox brings it up to date.")
    return {"pieces": found}


def main():
    request = json.load(sys.stdin)
    op = request.get("op")
    if op == "run":
        return run(request)
    if op == "status":
        return status()
    if op == "stop":
        return stop()
    if op == "runs":
        return runs(request.get("path"))
    if op == "run-details":
        return one_run(request.get("id"))
    if op == "manifest":
        return manifest()
    raise Refused("That isn't something this can do.")


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Refused as error:
        print(json.dumps({"error": str(error)}))
