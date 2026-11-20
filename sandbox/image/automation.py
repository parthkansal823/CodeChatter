"""
The Automations tool's side in the sandbox (apps/runner/src/automations.ts runs this): it queues a flow in the room's files for image/automation/host.mjs, which runs
it with Activepieces' engine, and reads what happened. Runs carry on after this returns, and everything they keep is in ~/automations, never in the room's files.

Takes {"op", ...} on stdin, and prints one JSON object. It's asked often while something runs, so it imports nothing heavy.
"""
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import uuid

WORKSPACE = "/workspace"
HOST = "/usr/local/lib/codechatter/automation/host.mjs"
# One call to the engine that isn't a run (checking a connection), answered at once rather than queued behind the room's runs.
ENGINE_CALL = "/usr/local/lib/codechatter/automation/engine-call.mjs"
MANIFEST = "/usr/local/lib/codechatter/automation/manifest.json"
HOME = os.path.expanduser("~/automations")
QUEUE = os.path.join(HOME, "queue")
RUNS = os.path.join(HOME, "runs")
# Each flow's kept runs (automation/runs.mjs): a folder for each flow, a marker for each run. Every run reads at most the newest MOST_LISTED.
BY_FLOW = os.path.join(HOME, "by-flow")
MOST_LISTED = 500
# The worker's daily tally of runs, by flow (host.mjs), for the Insights page.
INSIGHTS = os.path.join(HOME, "insights.json")
# What runs' steps kept apart (host.mjs): the files they made, a folder for each run.
FILES = os.path.join(HOME, "files")
FILE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MOST_FILE_BYTES = 10 * 1024 * 1024
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
# A run's notes (n8n's annotations): good or bad, tags to find it by, and a note.
MOST_RUN_TAGS = 10
MOST_TAG_CHARACTERS = 30
MOST_NOTE_CHARACTERS = 500
STEP_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
# A run that can be taken up again from where it stopped.
UNFINISHED = ("FAILED", "TIMEOUT", "STOPPED")
SCHEDULE_PIECE = "@activepieces/piece-schedule"
# A piece's polling trigger (a new row, a new issue): its hooks, and its own store, which keeps what it has seen.
TRIGGER_STORES = os.path.join(HOME, "trigger-stores")
POLL_HOOKS = ("ON_ENABLE", "RUN", "ON_DISABLE", "TEST")
MOST_NEW_ITEMS = 20
NOT_POLLING = "This flow doesn't start on a service's new items any more."


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


def shown(run_file):
    """A run as it's shown: a waitpoint's token is the secret in its address, and stays here."""
    waitpoint = run_file.get("waitpoint")
    if isinstance(waitpoint, dict):
        run_file = {**run_file, "waitpoint": {"type": waitpoint.get("type"), "step": waitpoint.get("step"), "resumeAt": waitpoint.get("resumeAt")}}
    return run_file


def status():
    live = read_json(LIVE)
    if not live:
        return {"state": "idle", "id": None, "steps": {}, "queued": queued()}
    if is_gone(live):
        now = int(time.time() * 1000)
        live.update(state="finished", status="FAILED", finishedAt=now, message="The run stopped before it finished, as the sandbox stopped or restarted.")
        write_json(LIVE, live, 0o644)
        write_json(os.path.join(RUNS, f"{live['id']}.json"), live, 0o644)
        mark_run(live.get("flowId"), live.get("path"), live["id"], "FAILED")
        release_lock()
    return {**shown(live), "queued": queued()}


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


def timeout_of(flow):
    """How long a flow's runs may take: its own setting (settings.timeoutSeconds), within the limits, or the default."""
    settings = flow.get("settings") if isinstance(flow.get("settings"), dict) else {}
    wanted = settings.get("timeoutSeconds")
    return max(LEAST_SECONDS, min(MOST_SECONDS, wanted)) if isinstance(wanted, int) and not isinstance(wanted, bool) else DEFAULT_SECONDS


def insights(request):
    """How the room's flows have done, for the Insights page: by day and by flow, over the last 7, 30 or 90 days, from the worker's daily tally (host.mjs),
    which outlasts the runs kept. Days are UTC. With `flows` (their keys: a flow's id, or its path without one), only those flows are counted."""
    days = request.get("days") if request.get("days") in (7, 30, 90) else 7
    only = request.get("flows")
    only = {key for key in only if isinstance(key, str)} if isinstance(only, list) else None
    stored = (read_json(INSIGHTS) or {}).get("days") or {}
    now = time.time()
    dates = [time.strftime("%Y-%m-%d", time.gmtime(now - 86400 * back)) for back in range(days - 1, -1, -1)]
    per_day, per_flow = [], {}
    totals = {"runs": 0, "failed": 0, "ms": 0, "savedMinutes": 0, "byHand": 0}
    for date in dates:
        entries = stored.get(date) if isinstance(stored.get(date), dict) else {}
        day = {"day": date, "runs": 0, "failed": 0}
        for key, entry in entries.items():
            if not isinstance(entry, dict) or (only is not None and key not in only):
                continue
            flow = per_flow.setdefault(key, {"key": key, "name": "", "path": "", "runs": 0, "failed": 0, "ms": 0, "savedMinutes": 0, "byHand": 0})
            flow["name"], flow["path"] = str(entry.get("name") or key), str(entry.get("path") or "")
            for field in ("runs", "failed", "ms", "savedMinutes", "byHand"):
                value = entry.get(field) if isinstance(entry.get(field), (int, float)) else 0
                flow[field] += value
                totals[field] += value
            day["runs"] += entry.get("runs") or 0
            day["failed"] += entry.get("failed") or 0
        per_day.append(day)
    def with_rates(counts):
        return {**counts, "failureRate": (counts["failed"] / counts["runs"]) if counts["runs"] else 0, "averageMs": round(counts["ms"] / counts["runs"]) if counts["runs"] else 0}

    return {"days": days, "totals": with_rates(totals), "flows": [with_rates(flow) for flow in sorted(per_flow.values(), key=lambda each: (-each["runs"], each["name"]))], "perDay": per_day}


def variables_of(request):
    """The room's variables given with a request (by the API, never a browser): names to text, nothing else."""
    given = request.get("variables")
    if not isinstance(given, dict):
        return {}
    return {name: value for name, value in given.items() if isinstance(name, str) and isinstance(value, str)}


def steps_in_order(step, loop=None):
    """Every step's name in the order a run reaches them (a loop's and a router's own steps before what comes after them), each with the outermost loop
    it's in, or None."""
    found = []
    while isinstance(step, dict):
        found.append((step.get("name"), loop))
        found += steps_in_order(step.get("firstLoopAction"), loop or step.get("name"))
        for child in step.get("children") or []:
            found += steps_in_order(child, loop)
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


def flow_asked_for(request):
    """The flow a request is for: at its path, or, started by a trigger, the one it was turned on for, even if its file has moved or been replaced."""
    path = request.get("path")
    wanted = request.get("flowId")
    try:
        flow = flow_at(path)
    except Refused:
        if not wanted:
            raise
        flow = None
    if wanted and (flow is None or flow_id(flow) != wanted):
        path, flow = flow_by_id(wanted)
        if flow is None:
            raise Refused("The flow this was turned on for isn't in the room any more.")
    return path, flow


def polling_piece(flow):
    """The piece and trigger settings, when the flow starts on a piece's polling trigger (one that asks a service what's new every few minutes)."""
    trigger = flow.get("trigger") or {}
    settings = trigger.get("settings") if isinstance(trigger.get("settings"), dict) else {}
    pieces = read_json(MANIFEST) or {}
    piece = pieces.get(settings.get("pieceName") or "")
    about = ((piece or {}).get("triggers") or {}).get(settings.get("triggerName") or "")
    # The schedule piece's triggers are polling ones to Activepieces, but schedules run on the API's own timer.
    if trigger.get("type") != "PIECE_TRIGGER" or settings.get("room") or settings.get("pieceName") == SCHEDULE_PIECE or not about or about.get("kind") != "POLLING":
        return None
    return piece, settings


def run(request):
    path, flow = flow_asked_for(request)
    started_by = str(request.get("trigger") or "manual")[:20]
    settings = flow["trigger"].get("settings") if isinstance(flow["trigger"].get("settings"), dict) else {}
    # A flow turned on for a service's new items runs on one only while it still starts on them.
    if started_by == "poll" and polling_piece(flow) is None:
        raise Refused(NOT_POLLING)
    # A flow turned on for a schedule may have been changed since: it's run only while it still starts on one.
    if started_by == "schedule" and settings.get("pieceName") != SCHEDULE_PIECE:
        raise Refused("This flow doesn't start on a schedule any more.")
    payload = request.get("payload")
    # The same for a room event: it runs only while the flow still listens for that event.
    room = settings.get("room") if isinstance(settings.get("room"), dict) else None
    if started_by == "event":
        if room is None:
            raise Refused("This flow doesn't start on a room event any more.")
        if not isinstance(payload, dict) or room.get("event") != payload.get("event"):
            raise Refused("This flow listens for another room event now.")
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
        extra.update(retryOf=before, resumeSteps=earlier.get("steps") or {}, data=earlier.get("data"))
        payload = earlier.get("payload")
    elif mode == "from":
        # From a chosen step on (n8n's partial run): what an earlier run's steps before it gave is kept, and the engine runs it and everything after it,
        # with the flow as it is now and what that run was sent. A step inside a loop starts from its loop, which keeps each time round apart.
        step = request.get("step")
        order = steps_in_order(flow.get("trigger"))
        names = [name for name, _ in order]
        trigger_name = flow["trigger"].get("name")
        if not isinstance(step, str) or not STEP_NAME.match(step) or step not in names or step == trigger_name:
            raise Refused("That isn't a step of this flow to run from.")
        before = request.get("retryOf")
        if not isinstance(before, str) or not RUN_ID.match(before):
            raise Refused("That isn't a run.")
        earlier = read_json(os.path.join(RUNS, f"{before}.json"))
        if not earlier:
            raise Refused("That run isn't kept any more.")
        if earlier.get("mode") == "step" or earlier.get("status") == "PAUSED" or not earlier.get("finishedAt"):
            raise Refused("Run from a finished run of the whole flow: not one step tried on its own, nor a run that's waiting.")
        if (earlier.get("flowId") or None) != flow_id(flow) or (not flow_id(flow) and earlier.get("path") != path):
            raise Refused("That run was of another flow.")
        earlier_steps = earlier.get("steps") or {}
        if trigger_name not in earlier_steps:
            raise Refused("That run has nothing from its trigger to start from.")
        start = dict(order)[step] or step
        kept = names[: names.index(start)]
        extra.update(step=step, retryOf=before, resumeSteps={name: earlier_steps[name] for name in kept if name in earlier_steps}, data=earlier.get("data"))
        payload = earlier.get("payload")
    elif mode != "run":
        raise Refused("That isn't a way to run a flow.")
    os.makedirs(QUEUE, exist_ok=True)
    if queued() >= MOST_QUEUED:
        raise Refused("This room already has 20 runs waiting. Try again when some have finished.")
    now = time.time()
    identity = f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime(now))}-{uuid.uuid4().hex[:8]}"
    seconds = request.get("seconds")
    seconds = max(LEAST_SECONDS, min(MOST_SECONDS, seconds)) if isinstance(seconds, int) else timeout_of(flow)
    headers = request.get("headers") if isinstance(request.get("headers"), dict) else {}
    query = request.get("query") if isinstance(request.get("query"), dict) else {}
    resume_base = request.get("resumeBase")
    if not isinstance(resume_base, str) or not resume_base.startswith(("http://", "https://")) or len(resume_base) > 300:
        resume_base = None
    job = {"id": identity, "path": path, "flowId": flow_id(flow), "flow": flow, "payload": payload, "headers": headers, "query": query, "trigger": started_by, "by": str(request.get("by") or "")[:80] or None, "seconds": seconds, "connections": request.get("connections") or {}, "variables": variables_of(request), "resumeBase": resume_base, **extra}
    write_json(os.path.join(QUEUE, f"{int(now * 1000):015d}-{identity}.json"), job)
    # A flow's error flow is queued by the worker that's running it (host.mjs), which goes on to it: a second worker would run the queue twice.
    if not request.get("noWorker"):
        start_worker()
    answer = {"id": identity, "queued": queued()}
    if started_by == "schedule":
        # Its schedule as the file has it now, so the timer goes by it from the next time on.
        answer["trigger"] = {"triggerName": settings.get("triggerName"), "input": settings.get("input") if isinstance(settings.get("input"), dict) else {}}
    elif started_by == "event":
        # What it listens for as the file has it now, so the next event goes by that.
        answer["trigger"] = {"room": room}
    return answer


def find(request):
    """A flow by its id, wherever its file is: the worker calling it from another flow (host.mjs) asks. The runner never sends this."""
    wanted = request.get("flowId")
    if not isinstance(wanted, str) or not wanted:
        raise Refused("That isn't a flow.")
    path, flow = flow_by_id(wanted)
    if flow is None:
        raise Refused("That flow isn't in the room any more.")
    return {"path": path, "flow": flow}


def stop():
    live = status()
    if live.get("state") != "running":
        raise Refused("Nothing is running.")
    with open(STOP, "w", encoding="utf-8"):
        pass
    return {"id": live.get("id")}


SHOWN = ("id", "path", "flowId", "mode", "step", "retryOf", "name", "trigger", "by", "status", "message", "startedAt", "finishedAt", "durationMs", "errorRun", "errorProblem", "waitpoint", "data", "annotation")


def flow_key(flow_id_or_none, path):
    """A flow's folder in the index, as runs.mjs names it: its id, or its path hashed."""
    if isinstance(flow_id_or_none, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", flow_id_or_none):
        return flow_id_or_none
    return "path-" + hashlib.sha256(str(path or "").encode()).hexdigest()[:24]


def mark_run(flow_id_or_none, path, identity, status_now):
    """A kept run's marker, as host.mjs writes them (a run whose worker stopped is written here)."""
    if not isinstance(identity, str) or not RUN_ID.match(identity):
        return
    folder = os.path.join(BY_FLOW, flow_key(flow_id_or_none, path))
    try:
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, identity), "w", encoding="utf-8") as marker:
            marker.write(str(status_now or ""))
    except OSError:
        pass


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
    # A flow's runs come from its folder of the index once there is one (host.mjs makes it); every run, from the newest files.
    indexed = os.path.exists(os.path.join(BY_FLOW, ".indexed"))
    if path and indexed:
        folder = os.path.join(BY_FLOW, flow_key(wanted, path))
        names = [f"{identity}.json" for identity in (os.listdir(folder) if os.path.isdir(folder) else []) if RUN_ID.match(identity)]
    else:
        names = [name for name in os.listdir(RUNS) if name.endswith(".json")]
    names = sorted(names, reverse=True)[: None if path and not indexed else MOST_LISTED]
    for name in names:
        run_file = read_json(os.path.join(RUNS, name))
        # A run its flow doesn't keep is read by its id for a minute, and not listed.
        if run_file and run_file.get("kept") is not False and belongs(run_file):
            found.append(shown({key: run_file.get(key) for key in SHOWN}))
    return {"runs": found}


def one_run(identity):
    if not isinstance(identity, str) or not RUN_ID.match(identity):
        raise Refused("That isn't a run.")
    found = read_json(os.path.join(RUNS, f"{identity}.json"))
    if not found:
        raise Refused("That run isn't kept any more.")
    return shown(found)


def is_tag(text):
    """A word or a few: letters (with their marks, so Hindi's too), numbers, _, then spaces or - . : / too; as RUN_TAG in the contracts."""
    if not 0 < len(text) <= MOST_TAG_CHARACTERS or not (unicodedata.category(text[0])[0] in "LN" or text[0] == "_"):
        return False
    return all(unicodedata.category(char)[0] in "LMN" or char in "_ .:/-" for char in text[1:])


def annotate(request):
    """A run's notes, as n8n's annotations: good or bad, tags to find it by, and a note. Kept with the run, so they go when it does."""
    identity = request.get("id")
    if not isinstance(identity, str) or not RUN_ID.match(identity):
        raise Refused("That isn't a run.")
    path = os.path.join(RUNS, f"{identity}.json")
    found = read_json(path)
    waiting = os.listdir(QUEUE) if os.path.isdir(QUEUE) else []
    going = (read_json(LIVE) or {}).get("id") == identity or any(name.endswith(f"-{identity}.json") for name in waiting)
    if not found and going:
        raise Refused("A run can have notes once it has ended.")
    if not found or found.get("kept") is False:
        raise Refused("That run isn't kept any more.")
    if found.get("status") in ("RUNNING", "PAUSED") or not found.get("finishedAt"):
        raise Refused("A run can have notes once it has ended.")
    vote = request.get("vote")
    if vote not in (None, "good", "bad"):
        raise Refused("A run is good or bad, or neither.")
    tags = request.get("tags") or []
    if not isinstance(tags, list) or len(tags) > MOST_RUN_TAGS:
        raise Refused(f"A run has up to {MOST_RUN_TAGS} tags.")
    kept = []
    for tag in tags:
        tag = tag.strip() if isinstance(tag, str) else ""
        if not is_tag(tag):
            raise Refused("A tag is up to 30 letters, numbers and spaces, with - . : or / between them.")
        if tag.lower() not in (each.lower() for each in kept):
            kept.append(tag)
    note = request.get("note") or ""
    if not isinstance(note, str) or len(note) > MOST_NOTE_CHARACTERS:
        raise Refused(f"A note is up to {MOST_NOTE_CHARACTERS} characters.")
    annotation = {key: value for key, value in (("vote", vote), ("tags", kept), ("note", note.strip())) if value}
    found["annotation"] = annotation or None
    write_json(path, found, 0o664)
    return {"id": identity, "annotation": found["annotation"]}


def run_file(request):
    """A step's file, kept with its run, for its Download in the tool: its name and its bytes (as base64)."""
    identity, file_id = request.get("id"), request.get("file")
    if not isinstance(identity, str) or not RUN_ID.match(identity) or not isinstance(file_id, str) or not FILE_ID.match(file_id):
        raise Refused("That isn't a run's file.")
    path = os.path.join(FILES, identity, file_id)
    if not os.path.isfile(path):
        raise Refused("That file isn't kept any more: its run has gone.")
    if os.path.getsize(path) > MOST_FILE_BYTES:
        raise Refused("That file is too big to download here.")
    meta = read_json(os.path.join(FILES, identity, f"{file_id}.json")) or {}
    name = str(meta.get("name") or "file")[:200]
    with open(path, "rb") as source:
        data = source.read()
    import base64

    return {"name": name, "size": len(data), "data": base64.b64encode(data).decode("ascii")}


def waits():
    """The runs waiting: the API's timer carries on those waiting for a time when it comes, even after the sandbox has stopped and started again."""
    found = []
    if os.path.isdir(RUNS):
        for name in os.listdir(RUNS):
            run_file = read_json(os.path.join(RUNS, name))
            if run_file and run_file.get("status") == "PAUSED" and isinstance(run_file.get("waitpoint"), dict):
                waitpoint = run_file["waitpoint"]
                found.append({"id": run_file.get("id"), "path": run_file.get("path"), "flowId": run_file.get("flowId"), "type": waitpoint.get("type"), "resumeAt": waitpoint.get("resumeAt")})
    return {"waits": found}


def resume(request):
    """Carries a waiting run on, as the same run, from where it stopped. One waiting for a call needs its address's token; once only, whoever's first."""
    identity = request.get("id")
    if not isinstance(identity, str) or not RUN_ID.match(identity):
        raise Refused("That isn't a run.")
    earlier = read_json(os.path.join(RUNS, f"{identity}.json"))
    waitpoint = earlier.get("waitpoint") if earlier and isinstance(earlier.get("waitpoint"), dict) else None
    if not earlier or earlier.get("status") != "PAUSED" or not waitpoint:
        raise Refused("That run isn't waiting.")
    if waitpoint.get("type") == "WEBHOOK":
        token = request.get("token")
        if not isinstance(token, str) or not hmac.compare_digest(token.encode(), str(waitpoint.get("token") or "").encode()):
            raise Refused("That run isn't waiting.")
    payload = request.get("payload")
    if payload is None:
        payload = {}
    if len(json.dumps(payload)) > MOST_PAYLOAD_BYTES:
        raise Refused("What was sent to this flow is over 1 MB.")
    try:
        flow = flow_at(earlier.get("path"))
        if flow_id(flow) != earlier.get("flowId"):
            raise Refused("moved")
        path = earlier.get("path")
    except Refused:
        path, flow = flow_by_id(earlier.get("flowId")) if earlier.get("flowId") else (None, None)
        if flow is None:
            raise Refused("The flow this run is of isn't in the room any more.")
    # Two calls to its address at the same moment carry it on once.
    try:
        os.close(os.open(os.path.join(HOME, f"resume-{identity}.lock"), os.O_CREAT | os.O_EXCL | os.O_WRONLY))
    except FileExistsError:
        raise Refused("That run isn't waiting.")
    now = time.time()
    job = {"id": identity, "path": path, "flowId": flow_id(flow), "flow": flow, "payload": payload, "headers": {}, "query": {}, "trigger": earlier.get("trigger") or "manual", "by": earlier.get("by"), "seconds": timeout_of(flow), "connections": request.get("connections") or {}, "variables": variables_of(request), "resumeBase": earlier.get("resumeBase"), "mode": "resume", "resumeSteps": earlier.get("steps") or {}, "data": earlier.get("data"), "triggerPayload": earlier.get("payload"), "waitedFrom": earlier.get("startedAt")}
    write_json(os.path.join(QUEUE, f"{int(now * 1000):015d}-{identity}-resume.json"), job)
    start_worker()
    return {"id": identity, "queued": queued()}


def engine_call(call, seconds):
    """Asks the engine one thing through engine-call.mjs, with the call (and any secrets in it) on stdin, never on disk."""
    try:
        done = subprocess.run(["node", ENGINE_CALL], input=json.dumps(call), capture_output=True, text=True, timeout=seconds + 15)
    except subprocess.TimeoutExpired:
        raise Refused(f"The engine didn't answer within {seconds} seconds.")
    try:
        return json.loads(done.stdout)
    except ValueError:
        raise Refused("The engine couldn't be asked. Restarting the sandbox brings it up to date.")


def poll(request):
    """
    A flow's polling trigger, through the engine (Activepieces' own trigger hooks, as its server calls them): ON_ENABLE when it's turned on (the piece
    remembers what's there already, so only what's new from then counts), RUN on its schedule (what's new, each started as a run of the flow), ON_DISABLE
    when it's turned off, TEST for an example of what it gives. Its store is its own file, kept between them.
    """
    hook = request.get("hook")
    if hook not in POLL_HOOKS:
        raise Refused("That isn't something a polling trigger does.")
    path, flow = flow_asked_for(request)
    found = polling_piece(flow)
    if found is None:
        raise Refused(NOT_POLLING)
    piece, settings = found
    identity = flow_id(flow) or path
    store = os.path.join(TRIGGER_STORES, re.sub(r"[^A-Za-z0-9_-]", "_", identity)[:100] + ".json")
    if hook == "ON_DISABLE" and not os.path.exists(store):
        return {"ok": True}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    trigger = {**flow["trigger"], "settings": {**settings, "pieceVersion": piece.get("version")}}
    version = {"id": f"poll-{uuid.uuid4().hex[:12]}", "flowId": identity, "displayName": flow.get("displayName") or path, "valid": True, "state": "LOCKED", "schemaVersion": str(flow.get("schemaVersion") or "27"), "trigger": trigger, "agentIds": [], "connectionIds": [], "notes": [], "updatedBy": None, "backupFiles": None, "created": now, "updated": now}
    operation = {"hookType": hook, "test": hook == "TEST", "flowVersion": version, "webhookUrl": ""}
    os.makedirs(TRIGGER_STORES, exist_ok=True)
    answer = engine_call({"kind": "EXECUTE_TRIGGER_HOOK", "operation": operation, "connections": request.get("connections") or {}, "variables": variables_of(request), "store": store, "seconds": 120}, 120)
    if not answer.get("ok"):
        raise Refused(str(answer.get("error") or "The service couldn't be asked.")[:500])
    response = answer.get("response") or {}
    if hook == "ON_ENABLE":
        return {"schedule": response.get("scheduleOptions")}
    if hook == "ON_DISABLE":
        try:
            os.remove(store)
        except FileNotFoundError:
            pass
        return {"ok": True}
    items = response.get("output") if isinstance(response.get("output"), list) else []
    if hook == "TEST":
        return {"items": items[:5]}
    started = []
    for item in items[:MOST_NEW_ITEMS]:
        if queued() >= MOST_QUEUED:
            break
        started.append(run({"path": path, "flowId": flow_id(flow), "payload": item, "trigger": "poll", "by": request.get("by"), "connections": request.get("connections") or {}, "variables": variables_of(request), "resumeBase": request.get("resumeBase")})["id"])
    return {"items": len(items), "runs": started, "passedOver": len(items) - len(started)}


def test_connection(request):
    """Whether a connection's details work, by the piece's own check (Activepieces' validate), as the Connections panel's Test asks."""
    pieces = read_json(MANIFEST) or {}
    piece = request.get("piece")
    if not isinstance(piece, str) or piece not in pieces:
        raise Refused("That isn't one of the room's pieces.")
    info = pieces[piece]
    if not info.get("auth"):
        raise Refused(f"{info.get('label') or piece} doesn't need a connection.")
    value = request.get("value")
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise Refused("Give the connection's details.")
    answer = engine_call({"kind": "EXECUTE_VALIDATE_AUTH", "operation": {"piece": {"pieceName": piece, "pieceVersion": info.get("version"), "packageType": "REGISTRY", "pieceType": "OFFICIAL"}, "auth": value}, "seconds": 30}, 30)
    if not answer.get("ok"):
        return {"valid": False, "error": str(answer.get("error") or "It couldn't be checked.")[:500]}
    response = answer.get("response") or {}
    valid = bool(response.get("valid"))
    return {"valid": valid, "error": None if valid else str(response.get("error") or "It didn't work with these details.")[:500]}


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
    if op == "run-file":
        return run_file(request)
    if op == "annotate":
        return annotate(request)
    if op == "insights":
        return insights(request)
    if op == "manifest":
        return manifest()
    if op == "find":
        return find(request)
    if op == "waits":
        return waits()
    if op == "resume":
        return resume(request)
    if op == "test-connection":
        return test_connection(request)
    if op == "poll":
        return poll(request)
    raise Refused("That isn't something this can do.")


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Refused as error:
        print(json.dumps({"error": str(error)}))
