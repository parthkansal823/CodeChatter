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
import type Docker from "dockerode";
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
import { log } from "./log.js";
import { LABEL_MANAGED, LABEL_NAMESPACE, LABEL_ROLE, LABEL_ROOM, type Sandbox } from "./sandbox.js";

const LABEL_KIND = "codechatter.database";
/** Most of a client's output read; a longer answer is cut, and says so. */
const MAX_OUTPUT = 4 * 1024 * 1024;

type Spec = {
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
const SPECS: Record<DatabaseKind, Spec> = {
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

/**
 * One-click databases (roadmap §14 D). Each runs in a container of its own on
 * the room's network, named after its kind, with its data on a volume of its
 * own. Hardened like the sandbox: the image's database user from the start, a
 * read-only root, no capabilities, and memory and process limits.
 *
 * Stop removes the container and keeps the data. A room's databases sleep when
 * its sandbox idles (stopped, not removed) and wake with it (`resume`).
 */
export class Databases {
  /** Starts in progress, with what each is doing. */
  private readonly jobs = new Map<string, { detail: string }>();
  /** Why the last start failed, until the next start, stop or delete. */
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly docker: Docker,
    private readonly env: Env,
  ) {}

  async list(roomId: string): Promise<DatabaseStatus[]> {
    const filters = { label: [`${LABEL_ROOM}=${roomId}`, `${LABEL_ROLE}=database`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`] };
    const [containers, volumes] = await Promise.all([
      this.docker.listContainers({ all: true, filters }),
      this.docker.listVolumes({ filters }).then((r) => r.Volumes ?? []),
    ]);
    const password = databasePassword(this.env.SERVICE_SECRET, roomId);
    return DATABASE_KINDS.map((kind): DatabaseStatus => {
      const key = this.key(roomId, kind);
      const status = ((): Pick<DatabaseStatus, "state" | "detail"> => {
        const job = this.jobs.get(key);
        if (job) return { state: "starting", detail: job.detail };
        const failure = this.failures.get(key);
        if (failure) return { state: "failed", detail: failure };
        const container = containers.find((c) => c.Labels[LABEL_KIND] === kind);
        if (container?.State === "running") {
          if (container.Status.includes("(healthy)")) return { state: "running" };
          if (container.Status.includes("(unhealthy)")) return { state: "failed", detail: "It's running but not answering. Stop it and start it again." };
          return { state: "starting", detail: "Starting up" };
        }
        // 137 and 143 are signals (a stop, a kill) and 255 a Docker restart; anything else is the database's own error.
        const exit = /^Exited \((\d+)\)/.exec(container?.Status ?? "")?.[1];
        if (exit && !["0", "137", "143", "255"].includes(exit)) return { state: "failed", detail: `It stopped with an error (exit code ${exit}). Start it again, or delete its data.` };
        if (container || volumes.some((v) => v.Labels?.[LABEL_KIND] === kind)) return { state: "stopped" };
        return { state: "off" };
      })();
      return { kind, ...status, connection: this.connection(kind, password) };
    });
  }

  /** Start a database (made, with its image downloaded, the first time). Returns at once; `list` follows it. */
  start(sandbox: Sandbox, kind: DatabaseKind): void {
    const key = this.key(sandbox.roomId, kind);
    if (this.jobs.has(key)) return;
    this.failures.delete(key);
    const job = { detail: "Starting" };
    this.jobs.set(key, job);
    void this.bringUp(sandbox, kind, job)
      .catch((error: Error) => {
        log.error(`room ${sandbox.roomId}: ${kind} didn't start`, error);
        this.failures.set(key, `It didn't start: ${error.message}`);
      })
      .finally(() => this.jobs.delete(key));
  }

  /** Stop a database. Its data stays; it doesn't wake with the sandbox until started again. */
  async stop(roomId: string, kind: DatabaseKind): Promise<void> {
    this.failures.delete(this.key(roomId, kind));
    const container = this.docker.getContainer(this.name(roomId, kind));
    await container.stop({ t: 15 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  }

  /** Delete a database and its data. */
  async remove(roomId: string, kind: DatabaseKind): Promise<void> {
    await this.stop(roomId, kind);
    await this.docker
      .getVolume(this.volume(roomId, kind))
      .remove()
      .catch((error: { statusCode?: number }) => {
        if (error.statusCode !== 404) throw error;
      });
    log.info(`room ${roomId}: deleted its ${kind} database`);
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
    const started = await this.startExec(roomId, kind, ["timeout", "600", ...cmd], env, false);
    if ("down" in started) return started;
    const body = new PassThrough();
    const stderr = new Collector(64 * 1024);
    this.docker.modem.demuxStream(started.stream, body, stderr);
    const done = ended(started.stream).then(async () => {
      body.end();
      const { ExitCode } = await started.exec.inspect();
      return { exitCode: ExitCode ?? null, stderr: stderr.text().trim() };
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
    const started = await this.startExec(roomId, kind, ["timeout", "600", ...cmd], env, true);
    if ("down" in started) return done(started.down);
    const stdout = new Collector(64 * 1024);
    const stderr = new Collector(64 * 1024);
    this.docker.modem.demuxStream(started.stream, stdout, stderr);
    const finished = ended(started.stream);
    // Not ended afterwards: the client stops after `bytes`, and on some Docker
    // setups ending our side would close the connection before its answer.
    try {
      started.stream.write(head);
      for (let next = await chunks.next(); !next.done; next = await chunks.next()) {
        if (started.stream.destroyed) break;
        if (!started.stream.write(Buffer.from(next.value))) await once(started.stream, "drain");
      }
    } catch {
      // The client stopped reading (an error part-way); its answer says why.
    }
    await finished;
    started.stream.destroy();
    const { ExitCode } = await started.exec.inspect();
    const out = lastLines(stdout.text(), 40);
    const notes = lastLines(stderr.text(), 20);
    if (ExitCode !== 0) {
      return { results: out ? [{ type: "value", text: out }] : [], error: ExitCode === 124 ? "Loading took longer than 10 minutes and was stopped." : notes || `It failed (exit code ${ExitCode}).`, ms: Date.now() - t0 };
    }
    const results: QueryResultSet[] = [];
    if (out) results.push({ type: "value", text: out });
    if (notes) results.push({ type: "message", text: notes });
    results.push({ type: "message", text: `Loaded ${bytes.toLocaleString("en")} bytes.` });
    return { results, error: null, ms: Date.now() - t0 };
  }

  /** Delete a database's data and start it again, empty. */
  async reset(sandbox: Sandbox, kind: DatabaseKind): Promise<void> {
    await this.remove(sandbox.roomId, kind);
    this.start(sandbox, kind);
  }

  /** The sandbox went idle: the room's databases sleep (stopped, data kept). */
  async pause(roomId: string): Promise<void> {
    for (const info of await this.containers(roomId, "running")) {
      await this.docker.getContainer(info.Id).stop({ t: 15 }).catch(() => {});
    }
  }

  /** The sandbox started: databases that slept with it wake up. */
  async resume(roomId: string): Promise<void> {
    for (const info of await this.containers(roomId, "exited")) {
      await this.docker.getContainer(info.Id).start().catch((error: Error) => log.warn(`room ${roomId}: couldn't wake ${info.Labels[LABEL_KIND]}: ${error.message}`));
    }
  }

  private async bringUp(sandbox: Sandbox, kind: DatabaseKind, job: { detail: string }): Promise<void> {
    const spec = SPECS[kind];
    await sandbox.ensureNetwork();
    const present = await this.docker.getImage(spec.image).inspect().then(() => true, () => false);
    if (!present) {
      job.detail = `Downloading ${DATABASES[kind].name} (the first time only)`;
      const stream = (await this.docker.pull(spec.image)) as NodeJS.ReadableStream;
      await new Promise<void>((resolve, reject) => this.docker.modem.followProgress(stream, (error: Error | null) => (error ? reject(error) : resolve())));
    }
    job.detail = "Starting";
    const container = this.docker.getContainer(this.name(sandbox.roomId, kind));
    const info = await container.inspect().catch(() => null);
    if (info?.State.Running) return;
    if (!info) await this.create(sandbox, kind);
    await container.start();
    log.info(`room ${sandbox.roomId}: started its ${kind} database`);
  }

  private async create(sandbox: Sandbox, kind: DatabaseKind): Promise<void> {
    const spec = SPECS[kind];
    const password = databasePassword(this.env.SERVICE_SECRET, sandbox.roomId);
    const labels = { [LABEL_MANAGED]: "1", [LABEL_NAMESPACE]: this.env.SANDBOX_NAMESPACE, [LABEL_ROOM]: sandbox.roomId, [LABEL_ROLE]: "database", [LABEL_KIND]: kind };
    const mb = spec.memoryMb * 1024 * 1024;
    // A new volume starts as the image's data folder, owned by its database user.
    await this.docker.createVolume({ Name: this.volume(sandbox.roomId, kind), Labels: labels });
    await this.docker.createContainer({
      name: this.name(sandbox.roomId, kind),
      Image: spec.image,
      User: spec.user,
      Env: spec.env(password),
      ...(spec.cmd && { Cmd: spec.cmd(password) }),
      Labels: labels,
      // Quick checks while it starts, then a slow one.
      Healthcheck: { Test: ["CMD-SHELL", spec.health], StartPeriod: 180e9, StartInterval: 2e9, Interval: 30e9, Timeout: 10e9, Retries: 3 } as Docker.HealthConfig,
      HostConfig: {
        NetworkMode: sandbox.network,
        ReadonlyRootfs: true,
        Tmpfs: Object.fromEntries(spec.tmpfs.map((path) => [path, "rw,nosuid,nodev,mode=1777,size=64m"])),
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        PidsLimit: 256,
        Memory: mb,
        MemorySwap: mb,
        NanoCpus: 1e9,
        Mounts: [{ Type: "volume", Source: this.volume(sandbox.roomId, kind), Target: spec.data }],
        LogConfig: { Type: "json-file", Config: { "max-size": "2m", "max-file": "1" } },
      },
      NetworkingConfig: { EndpointsConfig: { [sandbox.network]: { Aliases: [kind] } } },
    });
  }

  /**
   * Run a client inside the database's container, as its database user,
   * stopped after 30 seconds (exit code 124). "down" when it isn't running.
   */
  private async exec(
    roomId: string,
    kind: DatabaseKind,
    cmd: string[],
    env: string[] = [],
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; cut: boolean } | { down: string }> {
    const started = await this.startExec(roomId, kind, ["timeout", "30", ...cmd], env, false);
    if ("down" in started) return started;
    const stdout = new Collector(MAX_OUTPUT);
    const stderr = new Collector(64 * 1024);
    this.docker.modem.demuxStream(started.stream, stdout, stderr);
    await ended(started.stream);
    const { ExitCode } = await started.exec.inspect();
    return { stdout: stdout.text(), stderr: stderr.text(), exitCode: ExitCode ?? null, cut: stdout.cut };
  }

  /** Start a client inside the database's container, as its database user. "down" when it isn't running. */
  private async startExec(roomId: string, kind: DatabaseKind, cmd: string[], env: string[], stdin: boolean): Promise<{ exec: Docker.Exec; stream: Duplex } | { down: string }> {
    const container = this.docker.getContainer(this.name(roomId, kind));
    let exec: Docker.Exec;
    try {
      exec = await container.exec({ Cmd: cmd, Env: env, AttachStdin: stdin, AttachStdout: true, AttachStderr: true });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 409) return { down: `${DATABASES[kind].name} isn't running. Start it first.` };
      throw error;
    }
    const stream = (await exec.start({ hijack: true, stdin })) as Duplex;
    return { exec, stream };
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

  private containers(roomId: string, state: "running" | "exited"): Promise<Docker.ContainerInfo[]> {
    const label = [`${LABEL_ROOM}=${roomId}`, `${LABEL_ROLE}=database`, `${LABEL_NAMESPACE}=${this.env.SANDBOX_NAMESPACE}`];
    return this.docker.listContainers({ all: true, filters: { label, status: [state] } }).catch(() => []);
  }

  private key(roomId: string, kind: DatabaseKind): string {
    return `${roomId}:${kind}`;
  }

  private name(roomId: string, kind: DatabaseKind): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-${kind}-${roomId.toLowerCase()}`;
  }

  private volume(roomId: string, kind: DatabaseKind): string {
    return `cc-${this.env.SANDBOX_NAMESPACE}-db-${kind}-${roomId.toLowerCase()}`;
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

/** Resolves once a hijacked exec stream is over, however it ends. */
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
