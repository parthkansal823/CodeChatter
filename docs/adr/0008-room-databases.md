# ADR 0008: One-click databases run hardened next to the sandbox

- **Status:** Accepted (2026-10-09). Builds on ADR 0007 (the room network).
- **Code:** `apps/runner/src/databases.ts`, `apps/runner/src/database-queries.ts`, `packages/contracts/src/databases.ts`, `apps/api/src/sandbox/databases.controller.ts`, `apps/web/components/room/tools/databases/`
- **Tests:** `apps/runner/test/databases.e2e.mjs`, `apps/web/test/databases.e2e.mjs`, `apps/runner/src/databases.test.ts`, `apps/runner/src/database-queries.test.ts`

## Decision

PostgreSQL 18, MySQL 8.4, MariaDB 11.8, MongoDB 8.0 and Redis (Valkey 9) start from the room's Databases tool.

**Where they run.** Each runs in a container of its own, `cc-<namespace>-<kind>-<room>`:
- It's on the room's network only, named after its kind (`postgres`, `mysql`, `mariadb`, `mongo`, `redis`), and publishes no ports.
- Its data is on a volume of its own, `cc-<namespace>-db-<kind>-<room>`.

**Hardened like the sandbox.** The official images start as root and then switch to their database user. Here the container runs as that user from the start (postgres 70, the others 999), so:
- no capabilities
- `no-new-privileges`
- a read-only root, with tmpfs for sockets and temporary files
- memory and process limits

These databases take SQL from anyone who can run code in the room, and SQL can run programs (`COPY … FROM PROGRAM` in Postgres, for one). Whatever runs that way holds no more power than code in the sandbox.

**One login per room.** Every database has user `app`, database `app`, and the room's password. The password is derived from `SERVICE_SECRET` and the room id, not stored, so every terminal and Run already has the connections in its environment, even for databases started later:
- `DATABASE_URL` (PostgreSQL)
- `POSTGRES_URL`, `MYSQL_URL`, `MARIADB_URL`, `MONGODB_URL`, `REDIS_URL`
- `PG*` and `MYSQL_PWD`, so `psql`, `mysql` and `mariadb` connect with no arguments

`redis-cli -u "$REDIS_URL"` works the same way. The clients are in the sandbox image. MongoDB's shell isn't packaged for Debian; `npx mongosh` works while installs are allowed.

**Lifecycle.**
- **Start** returns at once. The panel follows the image download and the health check, which looks at the real server rather than the start-up's temporary one.
- **Stop** removes the container and keeps the data.
- **Delete** removes the data too.
- **Sleep.** When the room goes idle, its databases are stopped but not removed. They wake when the sandbox starts.
- Each change is in the audit log.

**Who.** Everyone in the room sees which databases run. Connections, which include the password, go to people who can run code. Starting, stopping and deleting need terminal rights.

**Query console and table browser** (`apps/runner/src/database-queries.ts`). Queries run inside the database's own container, through its own client, under `timeout 30`. The browser never connects to a database, and nothing new is exposed. The query is one argument, never part of a shell script. Each client's machine-readable output is read into results:

| Database | Client and format | How it's read |
|---|---|---|
| Postgres | `psql`, unaligned | `\x1f` between fields, `\x1e` between records, so values with newlines stay whole. Each table ends with its "(N rows)" footer; other lines are statements' status ("INSERT 0 2"). |
| MySQL, MariaDB | `--xml -vv` | Real NULLs, and each statement's status ("Query OK, 2 rows affected"). |
| MongoDB | `mongosh --json` | One expression. A cursor is read into an array first (one past the limit, to tell whether there are more), and documents become a table. |
| Redis | `valkey-cli --json` | One command per line on stdin, each paired with its reply, errors included. |

Results stop at 500 rows and 4 MB.

The table browser lists tables, views, collections or keys, and shows a table's first 100 rows (a Redis key by its type). Anyone in the room may browse. Writing queries needs terminal rights, since they can change data.

**Backups, seeds and reset.**

*Backup.* The database's own dump tool streams through the runner and the API to a download, under `timeout 600`:

| Database | Tool | What you get |
|---|---|---|
| Postgres | `pg_dump --clean --if-exists` | SQL |
| MySQL | `mysqldump` | SQL, with `DROP TABLE` for each table |
| MariaDB | `mariadb-dump` | SQL, with `DROP TABLE` for each table |
| MongoDB | `mongodump --archive --gzip` | an archive |
| Redis | `valkey-cli --rdb -` | an RDB snapshot |

Loading a SQL backup again replaces what it holds.

*Load a file.* A room file or an upload of up to 64 MB goes to the client on stdin:
- SQL goes to `psql` or `mysql`/`mariadb`.
- A gzip archive goes to `mongorestore --drop`; other MongoDB files go to `mongosh` as a script.
- Lines of commands go to `valkey-cli`.
- A Redis snapshot is refused, with a reason.

The client reads exactly the file's length, `head -c N | client`. Closing the exec's stdin closes the whole connection on some Docker setups (Docker Desktop on Windows, seen in testing), losing the client's answer.

*Reset* deletes the data and starts the database again.

*Who.* Backups need the right to run code. Loading and resetting need terminal rights. All three are in the audit log.

## Consequences

- Rotating `SERVICE_SECRET` changes the password; a database made before needs its data deleted and starting again.
- MySQL's self-signed certificate is accepted by the sandbox's MariaDB client (`/etc/mysql/conf.d/codechatter.cnf`). The connection never leaves the room's network.
- Idle MongoDB uses about 400 MB and MySQL about 190 MB; their limits are 768 MB and 512 MB.

## On Kubernetes (2026-10-10)

With `RUNNER_DRIVER=kubernetes` the same databases run in the room's namespace (`kube-databases.ts`), and everything above holds:

- each is a StatefulSet named after its kind, with one pod (`postgres-0`) and a volume claim for its data (`data-postgres-0`)
- a Service of the same name sits in front of it. The sandbox has no DNS server (ADR 0007), so it finds the Services through `/etc/hosts` entries (`hostAliases`); the Services are made with the namespace, before any pod, so their addresses are known when the sandbox starts
- the Services include pods that aren't ready yet, so a database takes connections as soon as it listens. Readiness only drives its health in the panel: a startup probe checks every 2 seconds while it starts, then a readiness probe every 30 (the same check as Docker's health check)
- sleeping with the room scales the StatefulSet to 0; waking scales it back. Stop deletes the StatefulSet and keeps the claim, and delete removes both
- the password lives in the room's Secret. Each pod expands it into the image's own settings when it starts, so it's in no pod spec. Client commands (console, backups, loads) build their settings from it inside the pod (`MYSQL_PWD="$CC_PASSWORD"`), so it's in no exec request either, which a cluster's audit log could record
- the client settings stay out of the containers' environment: the images' start-up scripts read it too. MySQL's script failed to create its user when `MYSQL_PWD` was set
- Docker's per-container process limit has no per-pod equivalent: the kubelet sets one per node (`podPidsLimit`), which a production cluster should set
