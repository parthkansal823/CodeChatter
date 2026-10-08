"""S2 spike: per-room sandbox container driven through aiodocker.

Runs inside a container that has /var/run/docker.sock mounted — the same
position the real runner service will hold. SECRET_KEY is set in *this*
process's environment to prove it never reaches the sandbox.
"""
from __future__ import annotations

import asyncio
import base64
import itertools
import json
import os
import time

import aiodocker

IMAGE = "cc-spike-sandbox"
NAME = "cc-room-spike"
VOLUME = "cc-spike-ws"
USER = "10001"
USER_ENV = ["PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/ccuser", "LANG=C.UTF-8", "TERM=xterm-256color"]
results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
  results.append((name, ok, detail))
  print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  — {detail}' if detail else ''}", flush=True)


class Agent:
  """Line-delimited JSON over the container's attached stdin/stdout."""

  def __init__(self, stream):
    self.stream = stream
    self.events: asyncio.Queue[dict] = asyncio.Queue()
    self.changed: asyncio.Queue[str] = asyncio.Queue()
    self.tunnels: dict[int, asyncio.StreamWriter] = {}
    self._buf = b""

  async def send(self, msg: dict) -> None:
    await self.stream.write_in((json.dumps(msg) + "\n").encode())

  async def read_loop(self) -> None:
    while (message := await self.stream.read_out()) is not None:
      if message.stream != 1:
        continue
      self._buf += message.data
      while b"\n" in self._buf:
        line, self._buf = self._buf.split(b"\n", 1)
        event = json.loads(line)
        kind = event.get("ev")
        if kind == "tcp_data" and event["id"] in self.tunnels:
          self.tunnels[event["id"]].write(base64.b64decode(event["b64"]))
        elif kind == "tcp_closed" and event["id"] in self.tunnels:
          self.tunnels.pop(event["id"]).close()
        elif kind == "changed":
          await self.changed.put(event["path"])
        else:
          await self.events.put(event)

  async def expect(self, kind: str, timeout: float = 10) -> dict:
    deadline = time.monotonic() + timeout
    while True:
      event = await asyncio.wait_for(self.events.get(), deadline - time.monotonic())
      if event.get("ev") == kind:
        return event


async def run_exec(container, cmd: list[str], user: str = USER, timeout: float = 30) -> tuple[int, str]:
  exe = await container.exec(cmd=cmd, user=user, environment=USER_ENV, workdir="/workspace", stdout=True, stderr=True)
  chunks: list[bytes] = []
  async with exe.start(detach=False) as stream:
    async def drain():
      while (msg := await stream.read_out()) is not None:
        chunks.append(msg.data)
    await asyncio.wait_for(drain(), timeout)
  info = await exe.inspect()
  return info["ExitCode"], b"".join(chunks).decode(errors="replace")


async def main() -> None:
  docker = aiodocker.Docker()
  for stale in (NAME,):
    try:
      await (await docker.containers.get(stale)).delete(force=True)
    except aiodocker.DockerError:
      pass

  container = await docker.containers.create(
    name=NAME,
    config={
      "Image": IMAGE,
      "User": "10002",
      "Env": ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"],
      "OpenStdin": True, "StdinOnce": False, "AttachStdin": True, "AttachStdout": True, "AttachStderr": True,
      "Tty": False,
      "Labels": {"codechatter.room": "spike"},
      "HostConfig": {
        "NetworkMode": "none",
        "ReadonlyRootfs": True,
        "Tmpfs": {"/tmp": "rw,size=64m,mode=1777", "/home/ccuser": "rw,size=16m,uid=10001,gid=10000,mode=0700"},
        "CapDrop": ["ALL"],
        "SecurityOpt": ["no-new-privileges"],
        "PidsLimit": 128,
        "Memory": 512 * 1024 * 1024,
        "MemorySwap": 512 * 1024 * 1024,
        "NanoCpus": 1_000_000_000,
        "Init": True,
        "IpcMode": "private",
        "Mounts": [{"Type": "volume", "Source": VOLUME, "Target": "/workspace"}],
      },
    },
  )
  async def start_agent(restart: bool = False) -> tuple[Agent, asyncio.Task]:
    # An attach stream is bound to one run of the container, so on a reset
    # the old run must be fully gone before attaching, and attaching must
    # happen before start or the agent's "ready" line is missed.
    if restart:
      await container.kill()
      await container.wait()
    stream = await container.attach(stdin=True, stdout=True, stderr=True).__aenter__()
    fresh = Agent(stream)
    task = asyncio.create_task(fresh.read_loop())
    await container.start()
    return fresh, task

  agent, reader_task = await start_agent()

  try:
    ready = await agent.expect("ready", timeout=20)
    record("agentReadyOverAttachStdio", ready["uid"] == 10002, f"uid={ready['uid']} pid={ready['pid']}")

    code, out = await run_exec(container, ["env"])
    record("userEnvHasNoServerSecrets", "SECRET_KEY" not in out and os.environ.get("SECRET_KEY", "") not in out,
           f"runner has SECRET_KEY={'set' if os.environ.get('SECRET_KEY') else 'unset'}; sandbox env keys: "
           + ",".join(sorted(line.split('=', 1)[0] for line in out.splitlines() if '=' in line)))

    code, out = await run_exec(container, ["python", "-c",
      "import urllib.request\ntry:\n urllib.request.urlopen('http://1.1.1.1', timeout=3); print('REACHED')\nexcept Exception as e: print('BLOCKED', type(e).__name__)"])
    record("networkEgressBlocked", "BLOCKED" in out, out.strip())

    code, out = await run_exec(container, ["sh", "-c", f"kill -9 {ready['pid']} 2>&1; echo exit=$?"])
    record("userCannotKillAgent", "exit=1" in out or "not permitted" in out.lower(), out.strip())

    code, out = await run_exec(container, ["sh", "-c",
      "touch /etc/x 2>/dev/null && echo etc=writable || echo etc=readonly; "
      "touch /workspace/w && echo ws=ok; touch /tmp/t && echo tmp=ok"])
    record("rootfsReadOnlyWorkspaceWritable", "etc=readonly" in out and "ws=ok" in out and "tmp=ok" in out, out.replace("\n", " "))

    code, out = await run_exec(container, ["python", "-c",
      "import os,time\nn=0\nfor _ in range(1000):\n try:\n  pid=os.fork()\n  if pid==0: time.sleep(20); os._exit(0)\n  n+=1\n except OSError as e: print('LIMIT after', n, e.strerror); break\nelse: print('NO LIMIT', n)"],
      timeout=60)
    await agent.send({"op": "list"})
    alive = await agent.expect("files")
    record("forkBombHitsPidsLimitAgentSurvives", "LIMIT" in out and "files" in alive.get("ev", ""), out.strip())
    try:
      code, out = await run_exec(container, ["true"])
      starved = code != 0
      starved_detail = f"exit={code}"
    except aiodocker.DockerError as error:
      starved, starved_detail = True, str(error)[:120]
    record("pidExhaustionBlocksExec(expected)", starved, starved_detail)

    # Recovery policy: restart the sandbox. The workspace volume survives.
    reader_task.cancel()
    agent, reader_task = await start_agent(restart=True)
    ready = await agent.expect("ready", timeout=20)
    code, out = await run_exec(container, ["sh", "-c", "ls /workspace && ps -u 10001 --no-headers | wc -l"])
    record("restartRecoversSandboxKeepsWorkspace", code == 0 and "w" in out.split(), " ".join(out.split()))

    await agent.send({"op": "write", "path": "src/hello.txt", "content": "from the yjs doc\n"})
    await agent.expect("ok")
    code, out = await run_exec(container, ["sh", "-c", "cat src/hello.txt && echo more >> src/hello.txt && echo appended"])
    record("downSyncWriteVisibleAndEditableByUser", "from the yjs doc" in out and "appended" in out, out.strip().replace("\n", " | "))

    while not agent.changed.empty():
      agent.changed.get_nowait()
    await run_exec(container, ["sh", "-c", "echo x > made_in_terminal.txt"])
    seen = set()
    try:
      while "made_in_terminal.txt" not in seen:
        seen.add(await asyncio.wait_for(agent.changed.get(), 5))
    except asyncio.TimeoutError:
      pass
    record("upSyncDetectsTerminalMadeFile", "made_in_terminal.txt" in seen, ",".join(sorted(seen)))

    # tmux terminal: attach, type, resize, disconnect, verify the session lived on.
    exe = await container.exec(cmd=["tmux", "new-session", "-A", "-s", "u1"], user=USER, environment=USER_ENV,
                               workdir="/workspace", tty=True, stdin=True, stdout=True, stderr=True)
    screen = b""
    async with exe.start(detach=False) as tty:
      await asyncio.sleep(0.8)
      await exe.resize(h=30, w=100)
      await tty.write_in(b"echo MARKER_$((6*7))\r")
      deadline = time.monotonic() + 8
      while b"MARKER_42" not in screen and time.monotonic() < deadline:
        msg = await asyncio.wait_for(tty.read_out(), 8)
        if msg is None:
          break
        screen += msg.data
    record("ttyExecIntoTmuxWithResize", b"MARKER_42" in screen)
    code, out = await run_exec(container, ["tmux", "capture-pane", "-p", "-t", "u1"])
    record("tmuxSessionSurvivesDisconnect", "MARKER_42" in out)
    code, out = await run_exec(container, ["tmux", "display", "-p", "-t", "u1", "#{window_width}x#{window_height}"])
    record("resizeApplied", out.strip().startswith("100x"), out.strip())

    # Preview tunnel: a dev server on localhost:5173 inside a --network none
    # container, reached from outside purely through the agent's stdio.
    server_exec = await container.exec(cmd=["python", "-m", "http.server", "5173", "--bind", "127.0.0.1", "-d", "/workspace"],
                                       user=USER, environment=USER_ENV, stdout=True, stderr=True)
    await server_exec.start(detach=True)
    await asyncio.sleep(1.5)
    ids = itertools.count(1)

    async def on_conn(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
      conn_id = next(ids)
      agent.tunnels[conn_id] = writer
      await agent.send({"op": "tcp_open", "id": conn_id, "port": 5173})
      while data := await reader.read(65536):
        await agent.send({"op": "tcp_data", "id": conn_id, "b64": base64.b64encode(data).decode()})
      await agent.send({"op": "tcp_close", "id": conn_id})

    server = await asyncio.start_server(on_conn, "127.0.0.1", 18080)
    reader, writer = await asyncio.open_connection("127.0.0.1", 18080)
    writer.write(b"GET /src/hello.txt HTTP/1.0\r\nHost: localhost:5173\r\n\r\n")
    await writer.drain()
    body = await asyncio.wait_for(reader.read(-1), 10)
    record("tcpTunnelReachesDevServerWithNetworkNone", b"200 OK" in body and b"from the yjs doc" in body,
           body.split(b"\r\n", 1)[0].decode(errors="replace"))
    server.close()
  finally:
    reader_task.cancel()
    await container.delete(force=True)
    try:
      await (await docker.volumes.get(VOLUME)).delete()
    except aiodocker.DockerError:
      pass
    await docker.close()

  failed = [name for name, ok, _ in results if not ok]
  print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f"; failed: {', '.join(failed)}" if failed else ""))


asyncio.run(main())
