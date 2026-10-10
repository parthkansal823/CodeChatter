import {
  DATABASE_KINDS,
  DATABASES,
  type DatabaseConnection,
  type DatabaseKind,
  type DatabaseStatus,
  type DatabaseTable,
  type QueryResult,
  type QueryResultSet,
} from "@codechatter/contracts";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { type Duplex, PassThrough, Writable } from "node:stream";

import {
  capped,
  dumpCommand,
  loadCommand,
  MAX_ROWS,
  parseQueryOutput,
  previewQuery,
  queryCommand,
  redisPreview,
  redisRows,
  sniff,
  tablesCommand,
  tablesFrom,
} from "./database-queries.js";

import type { Env } from "./env.js";
import { log, messageOf } from "./log.js";
import { exitCodeOnceEnded, type ExecHandle, type RoomSandbox } from "./sandbox.js";

export const LABEL_KIND = "codechatter.database";
/** Most of a client's output read; a longer answer is cut, and says so. */
const MAX_OUTPUT = 4 * 1024 * 1024;

export type Spec = {
  image: string;
  /** The image's own database user. The container runs as it from the start: no root, no capabilities. */
  user: string;
  /** Where the database keeps its files: the room's volume for it. */
  data: string;
  /** What the read-only root needs writable (sockets, temporary files). */
  tmpfs: string[];
  memoryMb: number;
  env: (password: string) => string[];
  cmd?: (password: string) => string[];
  /** Accepting connections as the app user (Docker's health check; the start-up's temporary server doesn't count). */
  health: string;
  database: string;
  url: (password: string) => string;
};

/** Every database: user "app", database "app", the room's password. Checked by test/databases.e2e.mjs. */
export const SPECS: Record<DatabaseKind, Spec> = {
  postgres: {
    image: "postgres:18-alpine",
    user: "70:70",
    data: "/var/lib/postgresql",
    tmpfs: ["/var/run/postgresql", "/tmp"],
    memoryMb: 256,
    env: (password) => ["POSTGRES_USER=app", `POSTGRES_PASSWORD=${password}`, "POSTGRES_DB=app"],
    health: "pg_isready -h 127.0.0.1 -U app -d app",
    database: "app",
    url: (password) => `postgresql://app:${password}@postgres:5432/app`,
  },
  mysql: {
    image: "mysql:8.4",
    user: "999:999",
    data: "/var/lib/mysql",
    tmpfs: ["/var/run/mysqld", "/tmp"],
    memoryMb: 512,
    env: (password) => [`MYSQL_ROOT_PASSWORD=${password}`, "MYSQL_DATABASE=app", "MYSQL_USER=app", `MYSQL_PASSWORD=${password}`],
    cmd: () => ["--innodb-buffer-pool-size=64M", "--performance-schema=OFF"],
    health: 'mysqladmin ping -h 127.0.0.1 -u app -p"$MYSQL_PASSWORD" --silent',
    database: "app",
    url: (password) => `mysql://app:${password}@mysql:3306/app`,
  },
  mariadb: {
    image: "mariadb:11.8",
    user: "999:999",
    data: "/var/lib/mysql",
    tmpfs: ["/run/mysqld", "/tmp"],
    memoryMb: 384,
    env: (password) => [`MARIADB_ROOT_PASSWORD=${password}`, "MARIADB_DATABASE=app", "MARIADB_USER=app", `MARIADB_PASSWORD=${password}`],
    cmd: () => ["--innodb-buffer-pool-size=64M"],
    health: 'mariadb-admin ping -h 127.0.0.1 -u app -p"$MARIADB_PASSWORD" --silent',
    database: "app",
    url: (password) => `mysql://app:${password}@mariadb:3306/app`,
  },
  mongo: {
    image: "mongo:8.0",
    user: "999:999",
    data: "/data/db",
    tmpfs: ["/data/configdb", "/tmp"],
    memoryMb: 768,
    env: (password) => ["MONGO_INITDB_ROOT_USERNAME=app", `MONGO_INITDB_ROOT_PASSWORD=${password}`],
    cmd: () => ["--wiredTigerCacheSizeGB", "0.25"],
    health: `mongosh --quiet -u app -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval 'db.runCommand({ ping: 1 }).ok' | grep -q 1`,
    database: "app",
    url: (password) => `mongodb://app:${password}@mongo:27017/app?authSource=admin`,
  },
  redis: {
    image: "valkey/valkey:9-alpine",
    user: "999:1000",
    data: "/data",
    tmpfs: ["/tmp"],
    memoryMb: 128,
    // valkey-cli reads REDISCLI_AUTH, so the health check needs no password on its command line.
    env: (password) => [`REDISCLI_AUTH=${password}`],
    cmd: (password) => ["valkey-server", "--requirepass", password, "--appendonly", "yes", "--maxmemory", "96mb"],
    health: "valkey-cli ping | grep -q PONG",
    database: "0",
    url: (password) => `redis://default:${password}@redis:6379/0`,
  },
};

/**
 * The room's database password: the same for each of its databases, and
 * derived rather than stored, so every terminal and Run can have it from the
 * start, before any database exists. Rotating SERVICE_SECRET changes it; a
 * database made before that needs its data deleted and starting again.
 */
export function databasePassword(secret: string, roomId: string): string {
  return createHmac("sha256", secret).update(`database:${roomId}`).digest("base64url").slice(0, 24);
}

/** Connection settings for every terminal and Run in the room, whether or not the databases are running. */
export function databaseEnv(password: string): string[] {
  return [
    ...DATABASE_KINDS.map((kind) => `${DATABASES[kind].env}=${SPECS[kind].url(password)}`),
    // The usual name for "the" database, and what psql and the MySQL and MariaDB clients read.
    `DATABASE_URL=${SPECS.postgres.url(password)}`,
    "PGHOST=postgres",
    "PGUSER=app",
    "PGDATABASE=app",
    `PGPASSWORD=${password}`,
    `MYSQL_PWD=${password}`,
  ];
}

/** What a driver sees of one database right now. */
export type Observed =
  | { state: "running"; health: "healthy" | "unhealthy" | "starting" }
  /** Being made: scheduled, its image downloading, its container created. */
  | { state: "pending"; detail: string }
  /** It can't start, and won't by trying again on its own (its image can't be had). */
  | { state: "failed"; detail: string }
  /** Asleep with the sandbox, or ended by itself (its exit code says which). */
  | { state: "exited"; exitCode: number | null }
  | { state: "none" };

/**
 * Where a room's databases run: Docker containers on the room's network
 * (docker-databases.ts), or StatefulSets in the room's namespace on
 * Kubernetes (kube-databases.ts). `Databases` does the rest the same way.
 */
export interface DatabaseDriver {
  /** Each database's container or pod, and whether its data is kept. */
  observe(roomId: string): Promise<Map<DatabaseKind, { now: Observed; data: boolean }>>;
  /** Make it the first time (its image downloaded, its data volume made), and start it. */
  bringUp(sandbox: RoomSandbox, kind: DatabaseKind, job: { detail: string }): Promise<void>;
  /** Stop it; the data stays, and it doesn't wake with the sandbox until started again. */
  stop(roomId: string, kind: DatabaseKind): Promise<void>;
  /** Stop it and delete its data. */
  remove(roomId: string, kind: DatabaseKind): Promise<void>;
  /** The room's sandbox went idle: its running databases sleep, data kept. */
  pause(roomId: string): Promise<void>;
  /** The sandbox started: databases that slept with it wake up. */
  resume(roomId: string): Promise<void>;
  /** A client process inside the database's container, as its database user; null when it isn't running. */
  exec(roomId: string, kind: DatabaseKind, cmd: string[], env: string[], stdin: boolean): Promise<ExecHandle | null>;
}

/**
 * One-click databases (roadmap §14 D). Each runs on its own, named after its
 * kind on the room's network, with its data kept on a volume of its own.
 * Hardened like the sandbox: the image's database user from the start, a
 * read-only root, no capabilities, and memory limits.
 *
 * Stop keeps the data. A room's databases sleep when its sandbox idles and
 * wake with it (`pause`, `resume`). The console, the table browser, backups
 * and loads run the database's own client inside it (database-queries.ts).
 */
export class Databases {
  /** Starts in progress, with what each is doing. */
  private readonly jobs = new Map<string, { detail: string }>();
  /** Why the last start failed, until the next start, stop or delete. */
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly driver: DatabaseDriver,
    private readonly env: Env,
  ) {}

  async list(roomId: string): Promise<DatabaseStatus[]> {
    const seen = await this.driver.observe(roomId);
    const password = databasePassword(this.env.SERVICE_SECRET, roomId);
    return DATABASE_KINDS.map((kind): DatabaseStatus => {
      const key = this.key(roomId, kind);
      const status = ((): Pick<DatabaseStatus, "state" | "detail"> => {
        const job = this.jobs.get(key);
        if (job) return { state: "starting", detail: job.detail };
        const failure = this.failures.get(key);
        if (failure) return { state: "failed", detail: failure };
        const { now, data } = seen.get(kind) ?? { now: { state: "none" } as Observed, data: false };
        switch (now.state) {
          case "running":
            if (now.health === "healthy") return { state: "running" };
            if (now.health === "unhealthy") return { state: "failed", detail: "It's running but not answering. Stop it and start it again." };
            return { state: "starting", detail: "Starting up" };
          case "pending":
            return { state: "starting", detail: now.detail };
          case "failed":
            return { state: "failed", detail: now.detail };
          case "exited":
            // 137 and 143 are signals (a stop, a kill) and 255 a Docker restart; anything else is the database's own error.
            if (now.exitCode !== null && ![0, 137, 143, 255].includes(now.exitCode)) {
              return { state: "failed", detail: `It stopped with an error (exit code ${now.exitCode}). Start it again, or delete its data.` };
            }
            return { state: "stopped" };
          case "none":
            return { state: data ? "stopped" : "off" };
        }
      })();
      return { kind, ...status, connection: this.connection(kind, password) };
    });
  }

  /** Start a database (made, with its image downloaded, the first time). Returns at once; `list` follows it. */
  start(sandbox: RoomSandbox, kind: DatabaseKind): void {
    const key = this.key(sandbox.roomId, kind);
    if (this.jobs.has(key)) return;
    this.failures.delete(key);
    const job = { detail: "Starting" };
    this.jobs.set(key, job);
    void this.driver
      .bringUp(sandbox, kind, job)
      .then(() => log.info(`room ${sandbox.roomId}: started its ${kind} database`))
      .catch((error: Error) => {
        log.error(`room ${sandbox.roomId}: ${kind} didn't start`, error);
        this.failures.set(key, `It didn't start: ${messageOf(error)}`);
      })
      .finally(() => this.jobs.delete(key));
  }

  /** Stop a database. Its data stays; it doesn't wake with the sandbox until started again. */
  async stop(roomId: string, kind: DatabaseKind): Promise<void> {
    this.failures.delete(this.key(roomId, kind));
    await this.driver.stop(roomId, kind);
  }

  /** Delete a database and its data. */
  async remove(roomId: string, kind: DatabaseKind): Promise<void> {
    this.failures.delete(this.key(roomId, kind));
    await this.driver.remove(roomId, kind);
    log.info(`room ${roomId}: deleted its ${kind} database`);
  }

  /** Delete a database's data and start it again, empty. */
  async reset(sandbox: RoomSandbox, kind: DatabaseKind): Promise<void> {
    await this.remove(sandbox.roomId, kind);
    this.start(sandbox, kind);
  }

  /** The sandbox went idle: the room's databases sleep (stopped, data kept). */
  async pause(roomId: string): Promise<void> {
    await this.driver.pause(roomId);
  }

  /** The sandbox started: databases that slept with it wake up. */
  async resume(roomId: string): Promise<void> {
    await this.driver.resume(roomId);
  }

  /** A console query, run by the database's own client inside its container (database-queries.ts). */
  async query(roomId: string, kind: DatabaseKind, query: string): Promise<QueryResult> {
    const t0 = Date.now();
    const { cmd, env } = queryCommand(kind, query, databasePassword(this.env.SERVICE_SECRET, roomId));
    const out = await this.exec(roomId, kind, cmd, env);
    if ("down" in out) return { results: [], error: out.down, ms: Date.now() - t0 };
    const parsed = parseQueryOutput(kind, out.stdout, out.stderr, out.exitCode, query);
    return { ...parsed, ...(out.cut && !parsed.error && { error: "The answer was too long to show all of it." }), ms: Date.now() - t0 };
  }

  /** Its tables, views, collections or keys, for the table browser. */
  async tables(roomId: string, kind: DatabaseKind): Promise<DatabaseTable[]> {
    if (kind === "redis") {
      const out = await this.exec(roomId, kind, ["sh", "-c", `valkey-cli --no-auth-warning --scan --count 1000 | head -n ${MAX_ROWS}`]);
      if ("down" in out) throw new Error(out.down);
      return out.stdout.split("\n").filter(Boolean).sort().map((name) => ({ name, detail: "key" }));
    }
    const result = await this.query(roomId, kind, tablesCommand(kind));
    if (result.error) throw new Error(result.error);
    return tablesFrom(kind, result.results);
  }

  /** The first rows of a table or collection, or a Redis key's value. */
  async preview(roomId: string, kind: DatabaseKind, table: { name: string; schema?: string }): Promise<QueryResult> {
    if (kind !== "redis") {
      const query = previewQuery(kind, table);
      return { ...(await this.query(roomId, kind, query)), query };
    }
    const t0 = Date.now();
    const typed = await this.exec(roomId, kind, ["valkey-cli", "--no-auth-warning", "TYPE", table.name]);
    if ("down" in typed) return { results: [], error: typed.down, ms: Date.now() - t0 };
    const type = typed.stdout.trim();
    const how = redisPreview(type);
    if (!how) {
      const text = type === "none" ? "This key doesn't exist any more." : `A ${type} key: look at it with a command in the console.`;
      return { results: [{ type: "message", text }], error: null, ms: Date.now() - t0 };
    }
    const out = await this.exec(roomId, kind, ["valkey-cli", "--no-auth-warning", "--json", ...how.args.map((arg) => (arg === "{key}" ? table.name : arg))]);
    if ("down" in out) return { results: [], error: out.down, ms: Date.now() - t0 };
    return { results: [{ type: "message", text: `${type} ${table.name}` }, capped(how.columns, redisRows(out.stdout.trim(), how.pairs))], error: null, ms: Date.now() - t0 };
  }

  /**
   * A backup, streamed as the client writes it: its file name and type, the
   * dump, and (when it ends) how it went. "down" when the database isn't running.
   */
  async openDump(
    roomId: string,
    kind: DatabaseKind,
  ): Promise<{ file: string; contentType: string; body: PassThrough; done: Promise<{ exitCode: number | null; stderr: string }> } | { down: string }> {
    const { cmd, env, extension, contentType } = dumpCommand(kind, databasePassword(this.env.SERVICE_SECRET, roomId));
    const handle = await this.driver.exec(roomId, kind, ["timeout", "600", ...cmd], env, false);
    if (!handle) return { down: this.down(kind) };
    const body = new PassThrough();
    const stderr = new Collector(64 * 1024);
    handle.demux(body, stderr);
    const done = ended(handle.stream).then(async () => {
      body.end();
      return { exitCode: await exitCodeOnceEnded(handle), stderr: stderr.text().trim() };
    });
    const day = new Date().toISOString().slice(0, 10);
    return { file: `${roomId.toLowerCase()}-${kind}-${day}.${extension}`, contentType, body, done };
  }

  /**
   * Run a file through the database's client: a seed or a backup (SQL, a
   * mongosh script or mongodump archive, Redis commands). `bytes` is exactly
   * how much `input` holds; the client reads that much (loadCommand).
   */
  async load(roomId: string, kind: DatabaseKind, input: AsyncIterable<Buffer | string>, bytes: number): Promise<QueryResult> {
    const t0 = Date.now();
    const done = (error: string): QueryResult => ({ results: [], error, ms: Date.now() - t0 });
    const chunks = input[Symbol.asyncIterator]();
    const first = await chunks.next();
    const head = first.done ? Buffer.alloc(0) : Buffer.from(first.value);
    const { archive, rdb } = sniff(head);
    if (rdb) return done("Loading a Redis snapshot (.rdb) isn't supported yet. Load a file of commands instead, one per line.");
    if (archive && kind !== "mongo") return done("That's a compressed archive. Load a .sql file.");
    const { cmd, env } = loadCommand(kind, databasePassword(this.env.SERVICE_SECRET, roomId), bytes, archive);
    const handle = await this.driver.exec(roomId, kind, ["timeout", "600", ...cmd], env, true);
    if (!handle) return done(this.down(kind));
    const stdout = new Collector(64 * 1024);
    const stderr = new Collector(64 * 1024);
    handle.demux(stdout, stderr);
    const finished = ended(handle.stream);
    // Not ended afterwards: the client stops after `bytes`, and on some Docker
    // setups ending our side would close the connection before its answer.
    try {
      handle.stream.write(head);
      for (let next = await chunks.next(); !next.done; next = await chunks.next()) {
        if (handle.stream.destroyed) break;
        if (!handle.stream.write(Buffer.from(next.value))) await once(handle.stream, "drain");
      }
    } catch {
      // The client stopped reading (an error part-way); its answer says why.
    }
    await finished;
    const exitCode = await exitCodeOnceEnded(handle);
    handle.stream.destroy();
    const out = lastLines(stdout.text(), 40);
    const notes = lastLines(stderr.text(), 20);
    if (exitCode !== 0) {
      return { results: out ? [{ type: "value", text: out }] : [], error: exitCode === 124 ? "Loading took longer than 10 minutes and was stopped." : notes || `It failed (exit code ${exitCode}).`, ms: Date.now() - t0 };
    }
    const results: QueryResultSet[] = [];
    if (out) results.push({ type: "value", text: out });
    if (notes) results.push({ type: "message", text: notes });
    results.push({ type: "message", text: `Loaded ${bytes.toLocaleString("en")} bytes.` });
    return { results, error: null, ms: Date.now() - t0 };
  }

  /** Run a client inside the database's container, stopped after 30 seconds (exit code 124). "down" when it isn't running. */
  private async exec(
    roomId: string,
    kind: DatabaseKind,
    cmd: string[],
    env: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; cut: boolean } | { down: string }> {
    const handle = await this.driver.exec(roomId, kind, ["timeout", "30", ...cmd], env, false);
    if (!handle) return { down: this.down(kind) };
    const stdout = new Collector(MAX_OUTPUT);
    const stderr = new Collector(64 * 1024);
    handle.demux(stdout, stderr);
    await ended(handle.stream);
    return { stdout: stdout.text(), stderr: stderr.text(), exitCode: await exitCodeOnceEnded(handle), cut: stdout.cut };
  }

  private down(kind: DatabaseKind): string {
    return `${DATABASES[kind].name} isn't running. Start it first.`;
  }

  private connection(kind: DatabaseKind, password: string): DatabaseConnection {
    const spec = SPECS[kind];
    return {
      host: kind,
      port: DATABASES[kind].port,
      user: kind === "redis" ? "default" : "app",
      password,
      database: spec.database,
      url: spec.url(password),
      env: kind === "postgres" ? [DATABASES[kind].env, "DATABASE_URL"] : [DATABASES[kind].env],
    };
  }

  private key(roomId: string, kind: DatabaseKind): string {
    return `${roomId}:${kind}`;
  }
}

/** Keeps up to `limit` bytes of a stream and drops the rest, noting that it did. */
class Collector extends Writable {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  cut = false;

  constructor(private readonly limit: number) {
    super();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    const room = this.limit - this.size;
    if (chunk.length > room) this.cut = true;
    if (room > 0) {
      const kept = chunk.subarray(0, room);
      this.chunks.push(kept);
      this.size += kept.length;
    }
    done();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/** Resolves once an exec's stream is over, however it ends. */
function ended(stream: Duplex): Promise<void> {
  return new Promise((resolve) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", () => resolve());
  });
}

/** The last lines of a client's output, for a summary. */
function lastLines(text: string, count: number): string {
  const lines = text.trim().split("\n");
  return (lines.length > count ? ["…", ...lines.slice(-count)] : lines).join("\n").trim();
}
