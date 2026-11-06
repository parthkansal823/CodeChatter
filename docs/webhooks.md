# Outgoing organisation webhooks

An organisation's owners and admins can open **Settings → Webhooks**, add a
receiver URL, choose events, and copy the signing secret shown once. Store it in
your receiver's secret settings. Lists and delivery logs never return that secret.
Rotate it if it is lost or exposed, then update the receiver with the new value.

Choose **Everything** to receive every organisation audit action, including new
actions added later. Individual choices currently include `room.create`,
`room.delete`, `room.update`, `repo.commit`, `repo.publish`, `repo.pull-request`,
`sandbox.image` and `checkpoint.delete`. Events without an organisation are not
sent. **Send a test** queues `ping` for that endpoint alone, regardless of its
chosen events.

## Requests

CodeChatter sends `POST` with the following headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `CodeChatter-Webhooks/1` |
| `X-CodeChatter-Event` | Audit action, or `ping` |
| `X-CodeChatter-Delivery` | Delivery UUID; stable across retries and manual redelivery |
| `X-CodeChatter-Timestamp` | Unix seconds when this attempt was signed |
| `X-CodeChatter-Signature` | `sha256=` followed by a hexadecimal HMAC-SHA256 |

For example:

```json
{
  "id": "019e0000-0000-7000-8000-000000000001",
  "event": "room.create",
  "createdAt": "2026-11-04T12:00:00.000Z",
  "org": { "id": "organisation-id" },
  "actor": { "id": "person-id", "name": "Alex" },
  "target": { "type": "room", "id": "ABCD23" },
  "data": { "name": "Planning" }
}
```

`id` identifies the event. For audit actions it is the audit row's ID, shared by
all subscriptions receiving that event. The delivery header identifies the
particular webhook delivery. `actor` can be `null` for a system or deleted person;
`target` can be `null` when there is no target. `data` is an object whose fields
depend on the event. Ping events have their own generated event ID.

## Verify before parsing or processing

The signed bytes are the ASCII timestamp, a period, then the **exact raw request
body**. Use the signing secret as its base64url text, without decoding it first.
Reject malformed signatures and timestamps more than five minutes in the past
or future. Keep the receiver's clock synchronized. Do not parse and reserialize
JSON before verification: whitespace and property order affect the signature.

This Node example accepts Node HTTP request headers and a raw body Buffer:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyWebhook(secret, headers, rawBody, now = Date.now() / 1000) {
  const timestamp = headers["x-codechatter-timestamp"];
  const signature = headers["x-codechatter-signature"];
  if (typeof timestamp !== "string" || !/^[0-9]+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300) return false;
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  const received = Buffer.from(signature.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

With Express, use `express.raw({ type: "application/json" })` on this route before
any JSON parser, verify `req.body`, and only then call `JSON.parse`. With other
frameworks, obtain their raw bytes and use the same sequence.

Python, with raw bytes and headers supplied by your HTTP framework:

```python
import hashlib
import hmac
import re
import time

def verify_webhook(secret, headers, raw_body, now=None):
    headers = {key.lower(): value for key, value in headers.items()}
    timestamp = headers.get("x-codechatter-timestamp", "")
    signature = headers.get("x-codechatter-signature", "")
    if not re.fullmatch(r"[0-9]{1,16}", timestamp):
        return False
    if abs((time.time() if now is None else now) - int(timestamp)) > 300:
        return False
    if not re.fullmatch(r"sha256=[a-f0-9]{64}", signature):
        return False
    signed = timestamp.encode("ascii") + b"." + raw_body
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

Reject invalid requests. For valid requests, durably enqueue your work and answer
with **2xx quickly**, then process it in your own worker. A response timeout is
10 seconds. Deduplicate on `X-CodeChatter-Delivery` in the same transaction that
accepts your work; answer 2xx for already accepted deliveries. Sending is at least
once: a server crash after the receiver accepts a request but before the database
commit can cause a duplicate. Manual redelivery deliberately uses the same ID.

## Retries and delivery history

The worker checks due deliveries every five seconds, up to 20 at a time. Any
2xx response succeeds. Other HTTP statuses, timeouts, DNS failures and blocked
addresses count as failed attempts. Redirects are never followed.

Claiming is a short transaction: `FOR UPDATE SKIP LOCKED` selects due, unleased
or expired-lease rows, assigns the API process's worker ID and a 60-second lease,
then commits. The worker sends its batch in parallel outside any transaction;
DNS plus HTTP has a ten-second deadline per request. Each result is saved in its
own update only while that worker still owns the pending delivery, clearing the
lease. A failed result update cannot roll back its siblings. A crashed worker's
lease can be reclaimed after 60 seconds, while private test fixtures remain
restricted to their original test worker.

Delivery remains at least once. A crash after the receiver accepted a request
but before its result was recorded can cause that delivery to be sent again.
A process or machine suspended longer than the lease can also cause a duplicate;
leases cannot fence a request already received by an external HTTP server.
Receivers must keep their delivery-ID deduplication even with worker leases.

| Attempt | Earliest time |
| --- | --- |
| 1 | When queued, at the next worker check |
| 2 | One minute after attempt 1 fails |
| 3 | Five minutes after attempt 2 fails |
| 4 | Thirty minutes after attempt 3 fails |
| 5 | Two hours after attempt 4 fails |
| 6 | Six hours after attempt 5 fails |

After attempt 6 fails, the delivery status becomes `failed` and automatic retries
stop. Until then its status remains `pending`; successful deliveries are
`delivered`. Scheduling and worker availability can add delay. Delivery order is
not guaranteed. A retry gets a fresh timestamp and signature but keeps its event
payload and delivery ID, and uses the endpoint's URL and secret when claimed.
An attempt already in flight can finish with its previous settings after a URL
change, secret rotation or pause. Keep the previous verification secret briefly
while requests already in flight finish, then remove it.

The delivery log shows status, attempts, next try, HTTP code and every recorded
attempt. Expand a row for its payload, error and receiver response. Responses
are capped at 64 KB while reading; the log retains only their first 2 KB. Errors
are limited to 500 characters. **Redeliver** starts a new six-attempt cycle and
preserves the existing attempt history. A live worker lease is shown as
**Sending** and cannot be manually redelivered; the API returns 409 if a retry
races an active attempt. Lease identifiers are internal and are never returned
in delivery logs.

Pausing an endpoint stops new audit deliveries and holds its pending queue.
When a paused endpoint is enabled again, pending deliveries created more than
24 hours ago become `failed`, with **Expired while the webhook was paused** in
the delivery log. They are not sent automatically; recent pending deliveries
remain queued. Existing attempt history is preserved. An active lease is kept
until its request finishes or the lease expires, blocking concurrent manual
redelivery. The finishing worker releases only its own lease and cannot replace
the expired status, error or history. An HTTP request already in flight can
still reach its receiver. Manual redelivery is available after resuming and
after any active attempt finishes if an old event is still needed.

Each API process checks retention at most once an hour, including an initial
check on its first worker tick. `WEBHOOK_DELIVERY_RETENTION_DAYS` defaults to
30 (an integer from 1 to 3650). It removes `delivered` and `failed` rows whose
creation time is older than that many days, in independently committed batches
of at most 1,000. Pending rows are retained. Retrying an old delivery does not
change its creation time, so it may be pruned once it settles. History is
permanently removed by retention; export or retain it elsewhere if needed.
Cleanup checks a five-second budget between batches, always allowing its first
batch to finish. Remaining old rows wait until a later hourly check. This is a
best-effort time budget, not a timeout that cancels a slow database statement;
it prevents a large backlog from indefinitely delaying due deliveries.
Deleting an endpoint also deletes its deliveries and their logs.

## Endpoint safety and local testing

Production endpoints must use HTTPS. URLs are checked when saved and again for
every attempt. Private, loopback, link-local, metadata and other non-public
addresses are refused, including DNS names that resolve to them. The connection
is pinned to a vetted address. Keep receivers on public internet endpoints.

Signing secrets are sealed at rest with `BETTER_AUTH_SECRET`, using the same
encryption helper as GitHub tokens. Changing that encryption key requires a plan
to rotate the stored webhook secrets as well.

The end-to-end test starts its own API on port 4013 and a receiver on a free
loopback port. Only that API enables `WEBHOOKS_ALLOW_PRIVATE=1`, and production
ignores the switch. An internal `privateTestOwner` marker keeps its loopback
fixtures away from workers in the shared dev API; it is never accepted from
clients or returned in public results. Normal endpoints still receive full SSRF
checks even in that test API. Restarted test APIs do not adopt another test
instance's private fixtures; the test deletes them during cleanup. Do not enable
the switch on the shared development API.

After the owner generates and applies the migration and builds the API, run:

```sh
cd apps/api
node --env-file=../../.env test/webhooks-out.e2e.mjs
```

The script verifies signed room events, ping, failed-response scheduling, secret
rotation, redelivery history, permissions, private-address rejection on the
shared API, live lease retry conflicts, unlocked rows during HTTP sends and
expiry on resume. Its direct database updates age only a delivery belonging to
its own disposable webhook. It deletes its own webhooks and rooms and stops
only its child API and receiver. It never uses the shared rooms `E2ETST` or
`TEAM22`. Unit tests cover hourly retention, 1,000-row cleanup batches and
independent result-update failure.

For the lease upgrade, run `pnpm db:generate` and inspect its output before
`pnpm db:migrate`. It should add only nullable `locked_by text` and
`locked_until timestamptz` to `webhook_deliveries`, plus
`webhook_deliveries_claim_idx` on `(next_attempt_at, id, locked_until)` where
`status = 'pending'`. No backfill or table recreation is needed. Existing
pending rows have no lease and remain claimable. Build the contracts and API
after migration, then run the checks above.
