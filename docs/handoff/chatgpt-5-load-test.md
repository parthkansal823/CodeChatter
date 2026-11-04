# Task for ChatGPT: a load test for CodeChatter's live editing

You are helping build **CodeChatter v2**, a real-time collaborative IDE. People in a room edit the same files live: each room's files are one **Yjs** document, synced through **Hocuspocus 4** (the `collab` service). Another AI works on other parts of the codebase at the same time, so **only create the files listed under "Files you may touch"**. The owner does all git himself.

Your job is the roadmap item "**Load test: 50 rooms × 10 people, with 95% of updates delivered in under 150 ms.**" Write a load test that opens many rooms with many live connections, makes edits, and measures how long each edit takes to reach everyone else. It prints a clear report and fails (exit code 1) when the target is missed.

k6 can't speak Yjs and Hocuspocus's binary protocol. So write it in **Node.js** with the real client libraries the project already has, `@hocuspocus/provider` 4.7, `yjs` 13.6 and `ws`, which are installed in `apps/collab` (the collab test files there use them). Put the script in `apps/collab/test/` so it can import them without adding any package.

## How the app is reached (dev stack running)

- **One origin:** `http://localhost:8080` (Caddy). Collab's WebSocket is `ws://localhost:8080/collab`.
- **Sign in** with `POST http://localhost:8080/api/auth/sign-in/email`:
  - send the header `origin: http://localhost:8080` and the body `{ "email": "...", "password": "codechatter123" }`;
  - keep the cookies from `set-cookie` and send them on the WebSocket upgrade, together with the same `origin` header.
  - The test accounts are `test1@codechatter.local` (owner) and `test2@codechatter.local`. One account may hold many connections.
- **Make a room** with `POST /api/rooms`, body `{ "name": "Load 1" }`. The answer has `id`, a 6-character room code. **Delete it** at the end with `DELETE /api/rooms/:id` (status 204). Make one room per simulated room, as test1, and delete every room you made even when the run fails (`try/finally`, and on SIGINT too).
- **A room's files document** is named `room:<ROOMID>:files`.
- **How the project's own collab test connects** (copy this pattern):

  ```js
  import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
  import WebSocket from "ws";
  import * as Y from "yjs";

  function connect(docName, cookie) {
    class CookieSocket extends WebSocket {
      constructor(url, protocols) { super(url, protocols, { headers: { cookie, origin: "http://localhost:8080" } }); }
    }
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: "ws://localhost:8080/collab", WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: docName, document: doc, token: "cookie" });
    provider.attach();                       // a shared socket isn't attached automatically in Hocuspocus 4
    const synced = new Promise((resolve) => provider.on("synced", () => resolve(true)));
    return { doc, provider, socket, synced, close: () => { provider.destroy(); socket.destroy(); } };
  }
  ```

- **test2 is an editor in the test room E2ETST** but not in new rooms. **Use test1 for every connection** (it owns the rooms it makes). Real people would each be a different account, but connections are what load the server.

## What to build

`apps/collab/test/load.mjs`, run as `node --env-file=../../.env test/load.mjs` from `apps/collab`, with options from environment variables (sensible defaults):

| Variable | Default | Meaning |
|---|---|---|
| `ROOMS` | 50 | rooms to make |
| `PEOPLE` | 10 | connections per room |
| `SECONDS` | 60 | how long to edit, after everyone is connected |
| `RATE` | 2 | edits per second per person |
| `TARGET_P95_MS` | 150 | the 95th percentile must be under this |
| `RAMP_SECONDS` | 20 | connect gradually over this long, not all at once |

How it works:

1. **Set up:**
   - Sign in once.
   - Make `ROOMS` rooms, a few at a time (at most 5 requests in flight).
   - Connect `PEOPLE` clients to each room's files document, spread over `RAMP_SECONDS`, and wait for each to sync (with a timeout: count connections that never sync).
2. **Edit:** each client, at about `RATE` per second with some jitter, writes one entry into a shared `Y.Map` named `load` in its room's document: `map.set(<client id>, { at: Date.now(), seq })`. A map write is small and keeps the document from growing without limit.
3. **Measure:**
   - Every client observes the map (`map.observe`). For each change from another client, latency = now − `at`. All clients are in one process on one machine, so the clocks agree.
   - Keep the latencies in a big array (or a histogram, if you'd rather), and count sent and received updates per room, so lost updates show.
4. **Report**, printed at the end:
   - connections attempted, synced and failed; edits sent; updates received (and expected: sent × (PEOPLE − 1));
   - latency p50, p90, p95, p99 and max, and how many updates took over 1 second;
   - the worst room's p95;
   - **PASS or FAIL** against `TARGET_P95_MS`, exiting 1 on a FAIL or when more than 1% of connections fail.
   - While it runs, print a line every 5 seconds: connections, updates per second, the running p95.
   - Also write the full report as JSON to `apps/collab/test/load-report.json`, and add that path to the repository's `.gitignore`.
5. **Clean up:** close every connection, then delete every room. Cleanup must run on success, failure and Ctrl+C.

Also give:

- **`docs/load-testing.md`:** how to run it (a small run first, `ROOMS=5 PEOPLE=3 SECONDS=20`, then the full one); what the numbers mean; what limits one laptop hits first (file descriptors, the event loop of the load process itself: say how to tell if the *client* is the bottleneck, for example its own event-loop lag); and how to run it from several machines against a deployed server (`APP_URL`, a variable you also support, default `http://localhost:8080`).
- **Event-loop check:** the script measures its own event-loop lag (`perf_hooks.monitorEventLoopDelay`) and prints a warning when it's over 50 ms at p99, because then the numbers measure the client, not the server.

## Rules

- Don't add packages; use what `apps/collab` has (`@hocuspocus/provider`, `yjs`, `ws`) and Node 24's built-ins.
- Plain JavaScript (ESM `.mjs`), commented in plain English: a doc comment at the top saying what it does and how to run it, as the other files in `apps/collab/test/` have.
- Never use the room E2ETST or TEAM22 (people use them); only rooms the script makes.

## Files you may touch

- `apps/collab/test/load.mjs` (new)
- `docs/load-testing.md` (new)
- `.gitignore` (one added line for the report)

## How to answer

1. Each file in full in its own code block (and the `.gitignore` line).
2. The commands the owner runs: a 30-second smoke run, then the full run.
3. What you weren't sure of in Hocuspocus 4's provider API, so the owner knows where to look if it doesn't connect.
