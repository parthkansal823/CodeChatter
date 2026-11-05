# Task for ChatGPT: improve the work you did earlier (webhooks, audit log, load test)

You are helping build **CodeChatter v2**, a real-time collaborative IDE. Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

You (ChatGPT) wrote three features that are now in the repository:
- the **audit log** page;
- **outgoing webhooks**;
- the **collab load test**.

They pass their tests. The owner's other AI checked each one against the repository and found the problems below. Fix them, then **review your own earlier code for anything else**: re-read the files listed, compare them with what each feature promises, and report what you find. Fix what's in scope, and list the rest.

## 1. Webhooks: the worker holds a database transaction open while it sends

`apps/api/src/webhooks/webhooks.service.ts`, `batch()`:
- It opens one transaction, selects up to 20 due deliveries `FOR UPDATE SKIP LOCKED`, sends all of them over HTTP (up to 10 seconds each), and only then updates them, all inside that transaction.
- So one pooled connection and 20 row locks are held for up to about 10 seconds every tick.
- Worse, if **one** of the 20 updates fails, the whole transaction rolls back. Every delivery in the batch was already sent, but they're all marked pending again, so all of them are **sent twice**.

Change it to a **lease**:
1. In a short transaction, claim up to 20 due rows: set `lockedBy = <worker id>` and `lockedUntil = now() + 60 s`, using `FOR UPDATE SKIP LOCKED` in a subquery and `RETURNING`. A row whose lease has expired can be claimed again (the API crashed mid-send).
2. Send outside any transaction.
3. Update each delivery on its own, `WHERE id = $1 AND locked_by = <worker id>`, clearing the lease. One failed update must not affect the others.
4. Keep the existing guarantees: two API instances never send the same delivery at the same time; the private-test-owner rule (`privateTestOwner`) still holds; the retry schedule and attempt log are unchanged.

This needs two columns on `webhook_deliveries`, `locked_by text` and `locked_until timestamptz`, plus an index the claim can use.
- Add them in `packages/db/src/schema/app.ts`.
- Say "run `pnpm db:generate`" and describe the SQL it should make. **Don't hand-write the migration.**

## 2. Webhooks: deliveries are kept forever, and paused ones fire late

- **Retention:** nothing deletes old deliveries. Add a cleanup to the worker, at most once an hour, that deletes `delivered` and `failed` deliveries older than `WEBHOOK_DELIVERY_RETENTION_DAYS` (default 30, in `apps/api/src/config/env.ts`). Delete in batches of 1,000, so one run never locks the table for long.
- **Expiry:** when a webhook is paused, its pending deliveries wait, and fire when it's resumed, possibly days later and out of order with newer events. When a webhook is resumed (`update` with `active: true`), mark its pending deliveries older than 24 hours as `failed`, with `lastError` "Expired while the webhook was paused". Show that in the delivery log; check `apps/web/components/settings/outgoing-webhooks.tsx`.
- Document both in `docs/webhooks.md`.

## 3. Audit log: the CSV stops at 10,000 rows without saying so in the file

`apps/api/src/audit/audit.controller.ts` `export` takes at most 10,000 events. The page says so, but a CSV opened later gives no sign it's incomplete.
- **Stream it:** write the CSV in pages of 1,000 with the same id cursor `list` uses (`lt(auditEvents.id, before)`), with `response.write`, until done or until a hard cap of 100,000 rows.
- **When the cap is hit:** end the file with a last line `# Stopped at 100,000 events; narrow the filters to export the rest.`, and set the response header `X-Audit-Truncated: true` before the body starts. Since you can't know in advance, decide it from a quick count first, or explain another way.
- **Errors mid-stream:** an error after the body has started can't become a JSON error. End the stream with a last line `# Export failed; download again.` and log it.
- Update `apps/api/src/audit/audit-csv.ts` (cell and row formatting stay as they are, with their tests), and the note on the page (`apps/web/components/settings/audit-log.tsx`).
- Extend `apps/api/test/audit.e2e.mjs`: an export with more than one page of rows. Make enough events in a disposable room, through a loop of room updates, without making thousands of rooms.

## 4. Audit log page: the filter labels don't line up

In `apps/web/components/settings/audit-log.tsx`, at desktop width, the labels **Room**, **From** and **To** sit a few pixels lower than **Action** and **Person**. That's probably because the selects and the inputs have different label wrappers or margins. Make the five filter fields line up, at desktop and at phone width.

## 5. Load test: one process can't drive the full load

`apps/collab/test/load.mjs` with the defaults (50 rooms × 10 people) **fails** on a laptop: p95 228 ms, because the load process's own event loop lags 70 ms at p99. Run as five processes of 10 rooms, the same 500 connections **pass**: p95 132–134 ms, every update delivered. `docs/load-testing.md` now explains running several processes by hand, but the script should do it:
- **`WORKERS` (default: `min(8, max(1, os.availableParallelism() - 1))`):** the parent forks that many child processes with `node:child_process` `fork`, and gives each its share of the rooms.
- **Children** report over IPC, either a compact latency histogram (fixed buckets, e.g. 1 ms up to 2 s, then coarser) or raw samples if you argue the size is fine, plus their counts, their event-loop lag, and the rooms they made.
- **The parent** prints the live line, merges everything into **one** report and one PASS or FAIL, writes `load-report.json`, and makes sure **every** room is deleted even if a child crashes (the parent knows each child's rooms).
- Keep `WORKERS=1` behaving as today.
- Update `docs/load-testing.md`: replace the hand-run several-process commands with `WORKERS`.

## 6. Review your own earlier code

Re-read these and report, under **Review of earlier work**, anything that is wrong, risky or missing compared with what each feature promises. Fix what fits in the files below, and list the rest with a suggested fix:
- `apps/api/src/webhooks/*`, `packages/contracts/src/webhooks.ts`, `apps/web/components/settings/outgoing-webhooks.tsx`, `apps/api/test/webhooks-out.e2e.mjs`, `docs/webhooks.md`
- `apps/api/src/audit/*`, `packages/contracts/src/audit.ts`, `apps/web/components/settings/audit-log.tsx`, `apps/api/test/audit.e2e.mjs`
- `apps/collab/test/load.mjs`, `docs/load-testing.md`

## Files you may touch

- `apps/api/src/webhooks/*`, `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit-csv.ts`, `apps/api/src/audit/audit-csv.test.ts`, `apps/api/src/config/env.ts` (the retention variable)
- `packages/db/src/schema/app.ts` (the two lease columns and their index only)
- `packages/contracts/src/webhooks.ts`, `packages/contracts/src/audit.ts`
- `apps/web/components/settings/outgoing-webhooks.tsx`, `apps/web/components/settings/audit-log.tsx`
- `apps/api/test/webhooks-out.e2e.mjs`, `apps/api/test/audit.e2e.mjs`
- `apps/collab/test/load.mjs`, `docs/load-testing.md`, `docs/webhooks.md`

## How to answer

1. Each changed file as a unified diff with enough context (or in full when most of it changes).
2. The owner's steps, in order:
   1. `pnpm db:generate` (and what the SQL should contain), then `pnpm db:migrate`;
   2. `pnpm --filter @codechatter/contracts build`;
   3. `pnpm --filter @codechatter/api typecheck` and `pnpm --filter @codechatter/api test`;
   4. the web eslint on the two components, and `pnpm --filter @codechatter/web typecheck`;
   5. from `apps/api`: `node --env-file=../../.env test/webhooks-out.e2e.mjs` and `node --env-file=../../.env test/audit.e2e.mjs`;
   6. from `apps/collab`: `ROOMS=5 PEOPLE=3 SECONDS=20 node --env-file=../../.env test/load.mjs`, then the full run with the default `WORKERS`.

## Check your work before you answer

Review your own answer before sending it, and put this review at the end, under **Self-check**. The owner's other AI checks every answer against the repository before it's used. Problems you find and fix yourself save a round trip; a "Done" that isn't true costs one.

1. **The brief, point by point.** A table with one row for each requirement in "What to build":

   | Requirement | Done, Partly or Not done | Where (file and function) | How you know |
   |---|---|---|---|

   Only write Done when the code in your answer does it. If something is Partly or Not done, say what's missing and why.
2. **The rules.** Confirm each one, or say where you broke it and why:
   - you changed only the files under "Files you may touch";
   - no new packages, apart from any this brief allows (and then you gave the exact command);
   - in `apps/api`, `apps/collab`, `apps/runner` and `packages/*`, relative imports end in `.js`;
   - in web files, no hex, `rgb()` or `hsl()` colours, only token classes; copy is plain English;
   - every new file starts with a doc comment saying what it is and why;
   - nothing logs, prints or returns a secret.
3. **What you assumed about existing code.** List every name you used but didn't see in this brief or in the files you read: a function, column, route, prop, environment variable or test helper. For each, say whether you read it in the repository or guessed it. Guesses are the first thing the owner checks.
4. **Walk through the tests.** For each test or check you wrote, say which part of your code makes it pass. Then write down at least one way the feature could break that no test covers.
5. **Edge cases.** The failure cases you handled (bad input, no permission, a network error, two people at once, a retry, a restart) and the ones you didn't.
6. **Scope for improvement.** What you'd do next, and anything in the existing code you read that looks wrong or could be better. Keep it separate from this task: list it, don't build it.
