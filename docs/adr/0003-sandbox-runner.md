# ADR 0003 — Sandbox runner: container per room, driven by aiodocker (spike S2)

- **Status:** Accepted (2026-09-24)
- **Spike:** `spikes/s2-runner` (throwaway)
- **Setup:** the runner runs in a container with `/var/run/docker.sock` mounted, as in production, on Docker Desktop 29.7.2 (WSL2).

## Result: go (14 of 14 checks pass)

| Check | Evidence |
|---|---|
| Agent speaks line-delimited JSON over `docker attach` stdio | ready event received, `uid=10002` |
| Sandbox env has no server secrets | the runner had `SECRET_KEY` set; sandbox env keys were only `HOME, HOSTNAME, LANG, PATH, TERM` plus image ENV |
| `--network none` blocks egress | `URLError` |
| User (10001) cannot signal the agent (10002) | `kill: Operation not permitted` |
| Read-only rootfs, writable `/workspace` and `/tmp` | `etc=readonly ws=ok tmp=ok` |
| `PidsLimit` stops a fork bomb, and the agent survives | limit hit after 125 processes |
| Agent writes (down-sync) are editable by the user (setgid `2775` workspace, `0664` files) | pass |
| Agent detects files created in the terminal (up-sync) | pass |
| TTY exec into `tmux new -A`, then resize | pass (`100x29`) |
| tmux session survives the client disconnecting | `capture-pane` still shows the output |
| TCP tunnel over agent stdio reaches a dev server inside a `--network none` container | `HTTP/1.0 200 OK` |

## Findings that change the design

1. **PID exhaustion also blocks `docker exec`.**
   - Every exec must spawn inside the same pids cgroup. After a fork bomb, `docker exec` fails with `unable to spawn stage-1: Resource temporarily unavailable` (exit 128), so the runner cannot exec `pkill` to clean up.
   - A per-uid `RLIMIT_NPROC` is not a fix, because uid 10001 is shared by every room container on the host.
   - **Policy: sandbox reset.** When an exec fails this way, the runner kills the container, waits for it to exit, re-attaches the agent, and starts it again.
   - The workspace volume survives the reset (verified). The UI shows "Sandbox reset: process limit reached", and tmux sessions are lost.
2. **Attach ordering.** An attach stream is bound to one run of a container.
   - On start or reset, the sequence is: `kill` → `wait` → `attach` → `start`.
   - Attaching after start misses the agent's `ready` line. Attaching before a restart binds to the dying run.
3. **Image ENV leaks into user env.** The base image sets `GPG_KEY`, `PYTHON_VERSION` and `PYTHON_SHA256`. They are harmless, but the production sandbox image must reset ENV and set only `PATH/HOME/LANG/TERM`.
4. **tmux needs writable `$HOME` and `/tmp`** on a read-only rootfs. Mount tmpfs at `/tmp` and at `/home/ccuser` (`uid=10001,mode=0700`).

## Decisions

- **Library:** `dockerode` 5 in the Node runner (the spike used aiodocker 0.27; the findings concern Docker itself, not the client). The runner is the only process with the Docker socket.
- **Container flags:**
  - network: `NetworkMode none`
  - filesystem: `ReadonlyRootfs`, tmpfs `/tmp` and `$HOME`
  - privileges: `CapDrop ALL`, `no-new-privileges`
  - limits: `PidsLimit 256`, `Memory = MemorySwap`, `NanoCpus`
  - process: `Init`, `IpcMode private`
  - storage: named volume at `/workspace`
  - identification: labels for garbage collection
- **Users:** the agent runs as uid 10002. User activity runs through `docker exec -u 10001`. Both are in shared group 10000.
- **Preview:** use the TCP tunnel over agent stdio. The preview gateway will add `Host` rewriting for Vite's `allowedHosts`.
- **Up-sync:** the real agent uses inotify; polling was only used in the spike.
