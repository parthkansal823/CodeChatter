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
STEP_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
# A run that can be taken up again from where it stopped.
UNFINISHED = ("FAILED", "TIMEOUT", "STOPPED")
SCHEDULE_PIECE = "@activepieces/piece-schedule"


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


def flow_id(flow):
    """A flow's own id stays with it when its file moves, and a new flow with an old name doesn't get the old one's runs. A file written by hand may have none."""
    value = flow.get("id")
    return value if isinstance(value, str) and value else None


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


def steps_named(step):
    """Every step's name, in branches and loops too."""
    found = set()
    while isinstance(step, dict):
        found.add(step.get("name"))
        found |= steps_named(step.get("firstLoopAction"))
        for child in step.get("children") or []:
            found |= steps_named(child)
        step = step.get("nextAction")
    return found


def flow_by_id(wanted):
    """A flow's file found by its own id, wherever it's moved to in the room's files."""
    for folder, dirs, files in os.walk(WORKSPACE):
        dirs[:] = [name for name in dirs if not name.startswith(".") and name != "node_modules"]
        for name in files:
            if not name.lower().endswith(".flow.json"):
                continue
            full = os.path.join(folder, name)
            if os.path.getsize(full) > MOST_FLOW_BYTES:
                continue
            found = read_json(full)
            if isinstance(found, dict) and found.get("id") == wanted and isinstance(found.get("trigger"), dict):
                return os.path.relpath(full, WORKSPACE).replace(os.sep, "/"), found
    return None, None


def run(request):
    path = request.get("path")
    wanted = request.get("flowId")
    try:
        flow = flow_at(path)
    except Refused:
        if not wanted:
            raise
        flow = None
    # Started by a trigger: the flow is the one it was turned on for, even if its file has moved or been replaced by another.
    if wanted and (flow is None or flow_id(flow) != wanted):
        path, flow = flow_by_id(wanted)
        if flow is None:
            raise Refused("The flow this was turned on for isn't in the room any more.")
    started_by = str(request.get("trigger") or "manual")[:20]
    settings = flow["trigger"].get("settings") if isinstance(flow["trigger"].get("settings"), dict) else {}
    # A flow turned on for a schedule may have been changed since: it's run only while it still starts on one.
    if started_by == "schedule" and settings.get("pieceName") != SCHEDULE_PIECE:
        raise Refused("This flow doesn't start on a schedule any more.")
    payload = request.get("payload")
    if len(json.dumps(payload)) > MOST_PAYLOAD_BYTES:
        raise Refused("What was sent to this flow is over 1 MB.")
    mode = request.get("mode") or "run"
    extra = {"mode": mode}
    if mode == "step":
        # One step on its own, with every other step's data standing in from an earlier run.
        step = request.get("step")
        if not isinstance(step, str) or not STEP_NAME.match(step) or step not in steps_named(flow.get("trigger")) or step == flow["trigger"].get("name"):
            raise Refused("That isn't a step of this flow that can run on its own.")
        sample = request.get("sampleData") or {}
        if not isinstance(sample, dict) or len(json.dumps(sample)) > MOST_PAYLOAD_BYTES:
            raise Refused("The data for the other steps is over 1 MB.")
        extra.update(step=step, sampleData=sample)
    elif mode == "retry":
        # From where a run stopped: what succeeded is kept, and the engine carries on from what didn't, with the flow as it is now.
        before = request.get("retryOf")
        if not isinstance(before, str) or not RUN_ID.match(before):
            raise Refused("That isn't a run.")
        earlier = read_json(os.path.join(RUNS, f"{before}.json"))
        if not earlier:
            raise Refused("That run isn't kept any more.")
        if earlier.get("status") not in UNFINISHED or earlier.get("mode") == "step":
            raise Refused("Only a run that failed, stopped or took too long can carry on from where it stopped.")
        if (earlier.get("flowId") or None) != flow_id(flow) or (not flow_id(flow) and earlier.get("path") != path):
            raise Refused("That run was of another flow.")
        extra.update(retryOf=before, resumeSteps=earlier.get("steps") or {})
        payload = earlier.get("payload")
    elif mode != "run":
        raise Refused("That isn't a way to run a flow.")
    os.makedirs(QUEUE, exist_ok=True)
    if queued() >= MOST_QUEUED:
        raise Refused("This room already has 20 runs waiting. Try again when some have finished.")
    now = time.time()
    identity = f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime(now))}-{uuid.uuid4().hex[:8]}"
    seconds = request.get("seconds")
    seconds = max(LEAST_SECONDS, min(MOST_SECONDS, seconds)) if isinstance(seconds, int) else DEFAULT_SECONDS
    headers = request.get("headers") if isinstance(request.get("headers"), dict) else {}
    query = request.get("query") if isinstance(request.get("query"), dict) else {}
    job = {"id": identity, "path": path, "flowId": flow_id(flow), "flow": flow, "payload": payload, "headers": headers, "query": query, "trigger": started_by, "by": str(request.get("by") or "")[:80] or None, "seconds": seconds, "connections": request.get("connections") or {}, **extra}
    write_json(os.path.join(QUEUE, f"{int(now * 1000):015d}-{identity}.json"), job)
    start_worker()
    answer = {"id": identity, "queued": queued()}
    if started_by == "schedule":
        # Its schedule as the file has it now, so the timer goes by it from the next time on.
        answer["trigger"] = {"triggerName": settings.get("triggerName"), "input": settings.get("input") if isinstance(settings.get("input"), dict) else {}}
    return answer


def stop():
    live = status()
    if live.get("state") != "running":
        raise Refused("Nothing is running.")
    with open(STOP, "w", encoding="utf-8"):
        pass
    return {"id": live.get("id")}


SHOWN = ("id", "path", "flowId", "mode", "step", "retryOf", "name", "trigger", "by", "status", "message", "startedAt", "finishedAt", "durationMs")


def runs(path):
    if not os.path.isdir(RUNS):
        return {"runs": []}
    wanted = None
    if path:
        try:
            wanted = flow_id(flow_at(path))
        except Refused:
            pass

    def belongs(run_file):
        if not path:
            return True
        if wanted:
            return run_file.get("flowId") == wanted
        return run_file.get("path") == path and not run_file.get("flowId")

    found = []
    for name in sorted(os.listdir(RUNS), reverse=True):
        run_file = read_json(os.path.join(RUNS, name))
        if run_file and belongs(run_file):
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
