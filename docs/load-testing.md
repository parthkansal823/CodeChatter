# Live editing load test

`apps/collab/test/load.mjs` opens real Yjs/Hocuspocus connections through Caddy,
creates its own rooms, and measures how quickly each small map edit reaches the
other connections in that room. It uses one account for every connection. It
never uses `E2ETST` or `TEAM22`.

Use Node 24 and the repository's existing dependencies. The API, collab service,
database and Caddy must already be running. Reuse the shared development stack.
Run commands from `apps/collab`; `--env-file=../../.env` loads the local settings.
Shell environment variables override values in that file.

## Start small

PowerShell:

```powershell
cd apps/collab
$env:ROOMS = '5'; $env:PEOPLE = '3'; $env:SECONDS = '20'
node --env-file=../../.env test/load.mjs
```

POSIX shell:

```sh
cd apps/collab
ROOMS=5 PEOPLE=3 SECONDS=20 node --env-file=../../.env test/load.mjs
```

For a 30-second smoke run, keep that small connection count and change the edit
duration:

```powershell
$env:ROOMS = '5'; $env:PEOPLE = '3'; $env:SECONDS = '30'
node --env-file=../../.env test/load.mjs
```

```sh
ROOMS=5 PEOPLE=3 SECONDS=30 node --env-file=../../.env test/load.mjs
```

Then run the roadmap workload of 50 rooms with 10 connections each:

```powershell
$env:ROOMS = '50'; $env:PEOPLE = '10'; $env:SECONDS = '60'
$env:RATE = '2'; $env:RAMP_SECONDS = '20'; $env:TARGET_P95_MS = '150'
node --env-file=../../.env test/load.mjs
```

```sh
ROOMS=50 PEOPLE=10 SECONDS=60 RATE=2 RAMP_SECONDS=20 TARGET_P95_MS=150 \
  node --env-file=../../.env test/load.mjs
```

The duration covers editing only. Room creation, the connection ramp, initial
sync, a delivery drain and cleanup add time. Defaults generate about 1,000 edits
and 9,000 peer deliveries per second once all 500 connections have synced.

## Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `APP_URL` | `http://localhost:8080` | App origin; WebSocket URL is its `/collab` endpoint, using `ws` or `wss`. |
| `ROOMS` | `50` | Number of newly created rooms. |
| `PEOPLE` | `10` | Connections per room. Use at least two to measure peer delivery. |
| `SECONDS` | `60` | Editing duration after initial sync completes. |
| `RATE` | `2` | Edits per second per person, with random initial delay and roughly 20% interval jitter. |
| `TARGET_P95_MS` | `150` | Global delivery p95 must be strictly below this many milliseconds. |
| `RAMP_SECONDS` | `20` | Time over which connection attempts are spread. |
| `SYNC_TIMEOUT_MS` | `15000` | Maximum initial sync wait for each connection. |
| `DRAIN_SECONDS` | `5` | Wait for remaining deliveries after editing stops. |
| `LOAD_EMAIL` | `test1@codechatter.local` | Account that creates and owns every test room. |
| `LOAD_PASSWORD` | `codechatter123` | That account's password; use environment settings for deployed credentials. |

The app must accept `APP_URL` as an authentication and WebSocket origin. All
connections carry the signed-in account's cookie and the same origin. No runner
or browser is required for this test.

## Reading the report

Every five seconds the script prints connection counts, delivered updates per
second and the running p95. At the end it prints the result and writes the full
JSON report to `apps/collab/test/load-report.json`, regardless of the caller's
working directory. The report is ignored by git and replaced on the next run;
save a copy if you need comparisons.

An edit is one write to a writer-specific key in the room's `load` Y.Map. Its
value contains a timestamp and increasing sequence number. Each other client
observes the key, ignores duplicates and records `Date.now() - at`. All peers in
a room run in one process, so this measurement does not require synchronizing
clocks between machines. The map has one current entry per writer; it does not
append a growing text document.

- **Attempted, synced and failed connections** show setup and connection health.
  A disconnect after initial sync is a failure too.
- **Sent edits** count local writes. **Expected deliveries** are
  `sent × (PEOPLE - 1)`. The report also gives expectations for the peers that
  initially synced, so failed setup connections remain visible without being
  mistaken for successfully measured peers.
- **Received deliveries** count unique observed writer sequence numbers.
  Gaps or missing deliveries reveal lost or coalesced intermediate writes.
  Yjs can merge updates during congestion: final state convergence alone does
  not prove that every edit was observed. A missing expected delivery
  fails the run even when the received samples have a fast p95.
- **p50, p90, p95 and p99** describe delivery latency; p95 means 95% of recorded
  deliveries took at most that long. The maximum, deliveries over one second,
  and each room's counts help expose outliers. The worst room's p95 can be much
  slower than the global p95 and is printed separately.
- Latencies use integer-millisecond histogram buckets and nearest-rank
  percentiles. `Date.now()` already has millisecond precision; there is no extra
  rounding. Counts per bucket use less memory than retaining every delivery.

`PASS` requires a measured p95 strictly below `TARGET_P95_MS`, no missing expected
peer deliveries, and at most 1% failed connections. Setup errors, cleanup errors
or missing measurement samples fail the run. A normal failure exits with code 1.
Ctrl+C stops edits, closes connections and deletes created rooms before exiting
with code 130; SIGTERM does the same with code 143. Let cleanup finish. Forced
termination, a machine crash or unavailable API can prevent deletion; the report
identifies rooms that could not be deleted so they can be removed later.

## Tell whether the client is the limit

The script measures its own event-loop delay with
`perf_hooks.monitorEventLoopDelay` during editing. A client p99 above 50 ms prints
a warning: client scheduling delay then contaminates the delivery numbers, so
the run cannot establish the server's latency alone. This is a warning alongside
the workload result, not an automatic server failure.

Watch the load process's CPU, memory and network usage alongside server CPU,
network and collab logs. Compare achieved sent edits per second with
`ROOMS × PEOPLE × RATE`; a falling send rate with rising client event-loop lag
suggests a saturated generator. Running the generator and server on the same
laptop makes them compete for CPU and memory.

Each connection uses a socket and file descriptor. On Unix, inspect `ulimit -n`
before opening hundreds of connections; `EMFILE` means that limit was reached.
Other common limits are ephemeral ports, Docker Desktop resources, antivirus
overhead, Wi-Fi and server connection limits. Repeat from a separate machine or
split the generator across machines. If client lag falls while server latency
stays high at the same combined workload, investigate the server next.

### Several processes on one machine

One Node process can't decode the full workload's ~9,000 updates per second
without lagging. Run the same 500 connections as five processes of 10 rooms
each, which use five CPU cores. Each process makes and deletes its own rooms.
From `apps/collab` in PowerShell:

```powershell
$env:ROOMS = "10"; $env:PEOPLE = "10"
1..5 | ForEach-Object { Start-Process node "--env-file=../../.env", "test/load.mjs" -NoNewWindow -PassThru -RedirectStandardOutput "load-$_.log" } | Wait-Process
```

or in a POSIX shell:

```bash
for i in 1 2 3 4 5; do ROOMS=10 PEOPLE=10 node --env-file=../../.env test/load.mjs > load-$i.log 2>&1 & done; wait
```

Every process must pass. They all write `load-report.json`, so read each
process's printed report (the `load-*.log` files) instead.

Measured on a laptop against the dev stack (collab under `tsx watch`) on
2026-11-05:

| Run | Connections | Updates delivered | p95 | Client lag p99 |
|---|---|---|---|---|
| One process, 50 × 10 | 500/500 | 523,485/523,485 | 228 ms (FAIL) | 70.7 ms (client-bound) |
| Five processes, 5 × (10 × 10) | 500/500 | 538,227/538,227 | 132–134 ms (PASS) | 21 ms |

This test measures small Y.Map writes through the real sync protocol. It does
not model Monaco rendering, browser main-thread work, large pastes, chat, calls
or sandbox execution. Run realistic browser checks separately.

## Several load machines

Point every machine at the same deployed origin, with an account allowed to
create rooms. Keep credentials out of committed files and copied reports:

```powershell
$env:APP_URL = 'https://code.example.com'
$env:LOAD_EMAIL = 'load-test@example.com'
# Set LOAD_PASSWORD in this shell from your secret store.
$env:ROOMS = '10'; $env:PEOPLE = '10'; $env:SECONDS = '60'
node --env-file=../../.env test/load.mjs
```

```sh
# Export LOAD_EMAIL and LOAD_PASSWORD from your secret store first.
APP_URL=https://code.example.com ROOMS=10 PEOPLE=10 SECONDS=60 \
  node --env-file=../../.env test/load.mjs
```

Start five such machines together for 50 total rooms and 500 connections. Each
process creates a separate room cohort; all peers of each room stay on that
machine. This spreads client CPU while preserving the same-clock measurement.
If the deployed environment has no local `.env`, omit `--env-file` and supply all
settings through the shell.

Save each machine's report with a host-specific name. Check every host's result,
client lag and achieved rate. Do not average p95 values to produce a combined
p95: percentiles are not additive. Use each host's result as a conservative
check, or combine histogram counts before computing a combined percentile.
This arrangement does not measure peers of one room on different machines.
