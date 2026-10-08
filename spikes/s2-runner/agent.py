"""S2 spike agent: runs as PID 1's child inside the sandbox (uid 10002).

It speaks newline-delimited JSON over stdin/stdout, which the runner reaches
through `docker attach`. That channel works even with `--network none`, so
file sync and the preview TCP tunnel need no network inside the container.

Ops (runner -> agent):
  {"op":"write","path":..,"content":..}        write a workspace file
  {"op":"list"}                                 report workspace files
  {"op":"tcp_open","id":N,"port":P}             connect to localhost:P
  {"op":"tcp_data","id":N,"b64":..}             bytes for connection N
  {"op":"tcp_close","id":N}
Events (agent -> runner):
  {"ev":"ready"} {"ev":"ok","op":..} {"ev":"files","files":[..]}
  {"ev":"changed","path":..}                    a file appeared/changed on disk
  {"ev":"tcp_data","id":N,"b64":..} {"ev":"tcp_closed","id":N}
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

ROOT = Path("/workspace")
conns: dict[int, asyncio.StreamWriter] = {}
out_lock = asyncio.Lock()


async def emit(event: dict) -> None:
  async with out_lock:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def safe_path(rel: str) -> Path:
  target = (ROOT / rel).resolve()
  target.relative_to(ROOT)  # raises if it escapes the workspace
  return target


async def pump(conn_id: int, reader: asyncio.StreamReader) -> None:
  try:
    while chunk := await reader.read(65536):
      await emit({"ev": "tcp_data", "id": conn_id, "b64": base64.b64encode(chunk).decode()})
  finally:
    conns.pop(conn_id, None)
    await emit({"ev": "tcp_closed", "id": conn_id})


async def watch() -> None:
  # The real agent uses inotify; polling mtimes is enough to prove up-sync.
  seen: dict[str, float] = {}
  while True:
    for path in ROOT.rglob("*"):
      if path.is_file():
        rel = str(path.relative_to(ROOT))
        mtime = path.stat().st_mtime
        if seen.get(rel) != mtime:
          if rel in seen or seen.get("__primed__"):
            await emit({"ev": "changed", "path": rel})
          seen[rel] = mtime
    seen["__primed__"] = 1.0
    await asyncio.sleep(0.2)


async def handle(msg: dict) -> None:
  op = msg.get("op")
  if op == "write":
    target = safe_path(msg["path"])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(msg["content"])
    os.chmod(target, 0o664)
    await emit({"ev": "ok", "op": op})
  elif op == "list":
    files = sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob("*") if p.is_file())
    await emit({"ev": "files", "files": files})
  elif op == "tcp_open":
    reader, writer = await asyncio.open_connection("127.0.0.1", msg["port"])
    conns[msg["id"]] = writer
    asyncio.create_task(pump(msg["id"], reader))
    await emit({"ev": "ok", "op": op, "id": msg["id"]})
  elif op == "tcp_data":
    writer = conns.get(msg["id"])
    if writer:
      writer.write(base64.b64decode(msg["b64"]))
      await writer.drain()
  elif op == "tcp_close":
    writer = conns.pop(msg["id"], None)
    if writer:
      writer.close()


async def main() -> None:
  loop = asyncio.get_running_loop()
  reader = asyncio.StreamReader(limit=16 * 1024 * 1024)
  await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
  asyncio.create_task(watch())
  await emit({"ev": "ready", "uid": os.getuid(), "pid": os.getpid()})
  while line := await reader.readline():
    try:
      await handle(json.loads(line))
    except Exception as error:  # the spike reports, never dies
      await emit({"ev": "error", "detail": repr(error)})


asyncio.run(main())
