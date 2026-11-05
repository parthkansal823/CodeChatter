# Task for ChatGPT: nightly database backups, and a restore drill, for CodeChatter

You are helping build **CodeChatter v2**, a real-time collaborative IDE. All its lasting data is in **one Postgres 18 database**: users, rooms, room files (Yjs documents), checkpoints, chat, audit, webhooks. Valkey holds only sessions and caches, which can be lost. Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

Your job is the "nightly backups" part of the roadmap item "**Operations:** OpenTelemetry traces, Prometheus metrics, dashboards, and nightly backups". Today `docs/deploy.md` only lists a manual `pg_dump` command and says "copy backups off the server, for example with a nightly cron job". Make it automatic, kept off the server, and proven restorable.

## What exists (read these files in the repository first)

- **Production Compose:** `infra/compose.yaml`, run as `docker compose --env-file infra/.env.production -f infra/compose.yaml up -d`, with `dc` as the docs' alias.
  - The `postgres` service is `postgres:18-alpine`, with user and database `codechatter`, `POSTGRES_PASSWORD` from env, and volume `pg-data:/var/lib/postgresql`.
  - Shared YAML anchors: `<<: *app` (`restart: unless-stopped`, `init: true`, local logging).
  - Required variables use `${NAME:?message}`, optional ones `${NAME:-}`.
- **The Helm chart:** `infra/helm/codechatter/`.
  - `templates/data.yaml` holds the bundled Postgres StatefulSet; `templates/secret.yaml` makes `POSTGRES_PASSWORD` and `DATABASE_URL`.
  - The helpers in `_helpers.tpl` include `cc.componentLabels`, `cc.selector`, `cc.podSecurity`, `cc.containerSecurity` and `cc.secretName`.
  - `values.yaml` has `postgres` (bundled, or `externalUrl`) and `storageClass`.
  - Its README is `infra/helm/codechatter/README.md`.
  - **Follow the chart's style exactly.**
- **Development** has SeaweedFS as an S3 server at `http://localhost:8333` (`infra/compose.dev.yaml`; keys in `infra/seaweedfs/s3.json`), so an S3 upload can be tried locally. Production can use any S3-compatible store (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
- **Docs:** `docs/deploy.md`, which has a table of maintenance commands, including Backup and Restore, near the end.

## What to build

1. **A backup script**, `infra/backup/backup.sh` (POSIX `sh`, `set -eu`). It runs in a container that has the Postgres 18 client tools:
   - `pg_dump --format=custom --compress=9` of the `codechatter` database, written to a temporary name, then renamed when finished, so a half-written file is never mistaken for a backup. Name it `codechatter-<UTC yyyy-mm-ddTHHMMZ>.dump`, plus a `.sha256` file beside it.
   - **Check before keeping it:** `pg_restore --list` must read the file, or the backup counts as failed.
   - **Off the server:** when `BACKUP_S3_URL` (e.g. `s3://bucket/codechatter`) and its keys are set, upload the dump and its checksum.
     - Use an image that has a proven S3 client (`rclone/rclone` or `amazon/aws-cli`, a pinned version), as a second container or step. Don't hand-write S3 signing in shell.
     - `BACKUP_S3_ENDPOINT` serves non-AWS stores.
     - Uploading must be optional: without S3, backups stay on the local volume, and the logs say clearly that they're not off the server.
   - **Retention:** keep 7 daily, 4 weekly (Sundays) and 6 monthly (the 1st) backups, both locally and in S3. Print what it deletes. Never delete the newest backup, even when the clock looks wrong.
   - Exit non-zero on any failure, and print one clear summary line: `backup ok: <file> <size> <duration>s` or `backup FAILED: <reason>`.
   - **Nothing secret in the logs:** pass the database password through `PGPASSWORD` or a `.pgpass`, never as an argument.
2. **A restore script**, `infra/backup/restore.sh <file or s3 key>`:
   - It restores into a **new, empty database** (`codechatter_restore_<stamp>`) by default, never over the live one. `--into-live` replaces the live database, and requires typing the database name to confirm, after the app services are stopped. Document the steps.
   - Check the `.sha256` first.
   - Print row counts of a few key tables (`user`, `rooms`, `doc_snapshots`, `checkpoints`, `audit_events`) after restoring, so a person can eyeball it.
3. **Compose:** a `backup` service:
   - It runs the script **every night at 03:00 in the server's time zone (`BACKUP_TZ`, default UTC)**, through a small loop or a cron in the container. Pick a robust approach and explain it, for example `crond` in alpine with the script, or a sleep-until-next-run loop.
   - A `backups` volume, and the env variables:
     - `BACKUP_S3_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY`, all optional;
     - `BACKUP_TZ`.
   - Also a one-off run: `dc run --rm backup now`.
4. **Helm:**
   - A `backup` section in `values.yaml`: `enabled` (true when Postgres is bundled), `schedule` (default `0 3 * * *`), the retention counts, the image, and `s3` settings from a Secret, with an existing-Secret option.
   - A `CronJob` template, `templates/backup.yaml`, with `concurrencyPolicy: Forbid`, a history limit, and the same scripts mounted from a ConfigMap. It writes to a PVC (its size in values) and to S3 when set.
   - Skip it, with a NOTES line, when `postgres.externalUrl` is used: managed databases have their own backups.
5. **Monitoring hook:** after each run, write a tiny status file (`last-success` with a timestamp, or `last-failure` with the reason) into the backups volume. Document how to alert on "no success in 26 hours": for Compose, a one-line check the owner can put in a cron or an uptime monitor; for Helm, the CronJob's `lastSuccessfulTime`.
6. **Docs** (`docs/deploy.md`): a **Backups** section that replaces the manual lines. It covers:
   - what's backed up and what isn't (Valkey; the sandbox volumes, which are scratch space);
   - how to turn on S3;
   - where backups are, and how to list them;
   - **a restore drill:** the exact commands to restore last night's backup into a scratch database and check it, monthly, with what "good" looks like;
   - and how to restore into the live database for real.
7. **A local test**, `infra/backup/test-backup.sh`. Using Docker only, it:
   1. starts a throwaway `postgres:18-alpine` with a few rows, plus the dev SeaweedFS (or its own SeaweedFS container);
   2. runs `backup.sh` twice with faked dates, to exercise retention;
   3. checks the files and the S3 objects;
   4. restores into a new database and compares row counts;
   5. cleans up every container and volume it made.

   It must not touch the dev stack's database (`codechatter-dev-postgres-1`) or its data.

## Files you may touch

- `infra/backup/*` (new)
- `infra/compose.yaml` (add the `backup` service and its volume)
- `infra/helm/codechatter/values.yaml`, `infra/helm/codechatter/templates/backup.yaml` (new), `infra/helm/codechatter/templates/NOTES.txt`, `infra/helm/codechatter/README.md`
- `docs/deploy.md`
- `.env.example` (document the `BACKUP_*` variables, commented out)

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's commands to check it:
   - `sh -n infra/backup/*.sh`, and `shellcheck infra/backup/*.sh` if available;
   - `docker compose --env-file <a test env> -f infra/compose.yaml config`;
   - `helm lint infra/helm/codechatter` and `helm template infra/helm/codechatter`;
   - `sh infra/backup/test-backup.sh`.

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
