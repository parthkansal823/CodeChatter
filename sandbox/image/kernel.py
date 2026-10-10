#!/usr/bin/env python3
"""A notebook's kernel, for the runner (apps/runner/src/notebooks.ts).

Starts an IPython kernel with Jupyter's own client, then talks JSON lines:

  in  {"type": "execute", "id": cell, "code": "..."}   one at a time, in order
      {"type": "interrupt"}                             at once, even mid-cell
      {"type": "restart"} | {"type": "shutdown"}
  out {"type": "ready"} | {"type": "restarted"}
      {"type": "count", "id": cell, "count": n}         the cell started
      {"type": "output", "id": cell, "output": {...}}   an nbformat 4 output
      {"type": "clear", "id": cell}                     clear_output() in the cell
      {"type": "done", "id": cell, "status": "ok" | "error" | "dead", "count": n}
      {"type": "error", "message": "..."}               the kernel couldn't start

Plots come out as PNG (matplotlib's inline backend). It runs inside the room's jail,
like any Run, as the room's user.
"""
import json
import os
import queue
import sys
import threading

from jupyter_client.manager import KernelManager

_out = threading.Lock()


def send(message):
    line = json.dumps(message)
    with _out:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def start(cwd):
    env = dict(os.environ, MPLBACKEND="module://matplotlib_inline.backend_inline")
    km = KernelManager(kernel_name="python3")
    km.start_kernel(cwd=cwd, env=env)
    kc = km.client()
    kc.start_channels()
    kc.wait_for_ready(timeout=90)
    return km, kc


def run(km, kc, request):
    cell = request["id"]
    msg_id = kc.execute(request["code"], store_history=True, allow_stdin=False, stop_on_error=True)
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=1)
        except queue.Empty:
            # A kernel that died (out of memory, os._exit) sends nothing more.
            if not km.is_alive():
                send({"type": "output", "id": cell, "output": {"output_type": "error", "ename": "KernelDied", "evalue": "The kernel stopped (out of memory?). Restart it to go on.", "traceback": []}})
                send({"type": "done", "id": cell, "status": "dead", "count": None})
                return
            continue
        if msg["parent_header"].get("msg_id") != msg_id:
            continue
        kind, content = msg["msg_type"], msg["content"]
        if kind == "execute_input":
            send({"type": "count", "id": cell, "count": content.get("execution_count")})
        elif kind == "stream":
            send({"type": "output", "id": cell, "output": {"output_type": "stream", "name": content["name"], "text": content["text"]}})
        elif kind in ("display_data", "execute_result"):
            output = {"output_type": kind, "data": content.get("data", {}), "metadata": content.get("metadata", {})}
            if kind == "execute_result":
                output["execution_count"] = content.get("execution_count")
            send({"type": "output", "id": cell, "output": output})
        elif kind == "error":
            output = {"output_type": "error", "ename": content.get("ename", "Error"), "evalue": content.get("evalue", ""), "traceback": content.get("traceback", [])}
            send({"type": "output", "id": cell, "output": output})
        elif kind == "clear_output":
            send({"type": "clear", "id": cell})
        elif kind == "status" and content.get("execution_state") == "idle":
            break
    status, count = "ok", None
    while True:
        try:
            reply = kc.get_shell_msg(timeout=5)
        except queue.Empty:
            break
        if reply["parent_header"].get("msg_id") == msg_id:
            status = reply["content"].get("status", "ok")
            count = reply["content"].get("execution_count")
            break
    send({"type": "done", "id": cell, "status": "error" if status != "ok" else "ok", "count": count})


def main():
    cwd = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    try:
        km, kc = start(cwd)
    except Exception as error:  # noqa: BLE001 - say why, whatever it was
        send({"type": "error", "message": f"The kernel didn't start: {error}"})
        sys.exit(1)
    send({"type": "ready"})

    jobs = queue.Queue()

    def read():
        for line in sys.stdin:
            try:
                request = json.loads(line)
            except ValueError:
                continue
            if request.get("type") == "interrupt":
                if km.is_alive():
                    km.interrupt_kernel()
            elif request.get("type") in ("execute", "restart", "shutdown"):
                jobs.put(request)
        jobs.put({"type": "shutdown"})

    threading.Thread(target=read, daemon=True).start()
    while True:
        request = jobs.get()
        if request["type"] == "shutdown":
            break
        if request["type"] == "restart":
            km.restart_kernel(now=True)
            kc.wait_for_ready(timeout=90)
            send({"type": "restarted"})
            continue
        if not km.is_alive():
            send({"type": "done", "id": request["id"], "status": "dead", "count": None})
            continue
        run(km, kc, request)
    kc.stop_channels()
    km.shutdown_kernel(now=True)


if __name__ == "__main__":
    main()
