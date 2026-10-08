# ADR 0005: Collaboration server is Hocuspocus 4 with Valkey and a Postgres log (spike S3b)

- **Status:** Accepted (2026-09-24)
- **Spike:** `spikes/s3b-collab` (throwaway): two Hocuspocus 4.7 instances, `@hocuspocus/extension-redis` on Valkey 9, Postgres 18, and Node yjs clients.

## Result: go (10 of 10 checks pass)

| Check | Evidence |
|---|---|
| 600 concurrent text and map ops by clients on different instances converge | settled in 9 ms |
| Latency from one instance to the other (A on a → B on b) | p50 4.6 ms, p95 6.3 ms (target < 150 ms) |
| Read-only connection (`connectionConfig.readOnly`) receives edits but cannot write | pass |
| A bad token is rejected in `onAuthenticate` | pass |
| After `docker kill` of an instance mid-burst, the client fails over to the other instance and nothing is lost | settled in 58 ms |
| A restarted instance serves the full document | pass |
| Valkey restarted during edits on both instances | healed by itself, with no further edits needed |
| Postgres log + snapshot rebuild exactly the live state | 1,209 rows, snapshot at seq 1,209 |
| Cold restart of every instance reloads identically from Postgres | pass |

## How it works

- **Replication.** The Redis extension publishes a Yjs **state vector** (sync step 1) after local changes, and peers reply with the updates the sender lacks. This is anti-entropy rather than a stream of deltas, which is why the replicas heal after a Valkey outage.
  - Relayed updates are applied with `transactionOrigin = { source: "redis" }`.
  - `onStoreDocument` is serialised across instances with Redlock.
- **Persistence (`apps/collab/src/extensions/persistence.ts`)** has three parts:
  1. **`onChange`**
     - Appends only locally originated updates, skipping `source: "redis"`, to `doc_updates`.
     - Writes are buffered and flushed every 100 ms.
     - Each update is its own timestamped row. This log is the source for history and replay.
  2. **`onStoreDocument`**
     - Flushes the buffer.
     - Appends `Y.encodeStateAsUpdate(doc, persistedSV)`: whatever this replica holds beyond what it has already persisted. If the originating instance died before flushing, a surviving replica still writes those updates. Duplicates are harmless because Yjs updates are idempotent.
  3. **Compaction** builds snapshots **from the database, never from a live replica**, under `pg_try_advisory_xact_lock`. A snapshot therefore cannot claim a `seq` whose update it lacks.
     - In the app this runs as a BullMQ job instead of inline.

## Test-writing gotcha

`Y.Map.toJSON()` lists keys in each replica's **local integration order**, so two converged replicas can serialise differently. Always compare maps with sorted keys, or compare state vectors. The first run of this spike reported false divergence because of this.
