import { z } from "zod";

/**
 * One-click databases (roadmap §14 D). Each runs in a container of its own on
 * the room's private network (ADR 0007), where code in the sandbox reaches it
 * by name: `postgres:5432`, `mysql:3306` and so on. Containers, images and
 * credentials: apps/runner/src/databases.ts.
 */
export const DATABASE_KINDS = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type DatabaseKind = (typeof DATABASE_KINDS)[number];

export const DATABASES: Record<DatabaseKind, { name: string; port: number; env: string; terminal: string }> = {
  postgres: { name: "PostgreSQL 18", port: 5432, env: "POSTGRES_URL", terminal: "psql" },
  mysql: { name: "MySQL 8.4", port: 3306, env: "MYSQL_URL", terminal: "mysql -h mysql -u app app" },
  mariadb: { name: "MariaDB 11.8", port: 3306, env: "MARIADB_URL", terminal: "mariadb -h mariadb -u app app" },
  mongo: { name: "MongoDB 8.0", port: 27017, env: "MONGODB_URL", terminal: 'npx mongosh "$MONGODB_URL"' },
  redis: { name: "Redis (Valkey 9)", port: 6379, env: "REDIS_URL", terminal: 'redis-cli -u "$REDIS_URL"' },
};

/**
 * off: never started, no data. starting: downloading or starting up.
 * running: accepting connections. stopped: data kept, not running.
 * failed: it didn't start (detail says why).
 */
export type DatabaseState = "off" | "starting" | "running" | "stopped" | "failed";

export type DatabaseConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
  /** Environment variables that hold it in every terminal and Run. */
  env: string[];
};

export type DatabaseStatus = {
  kind: DatabaseKind;
  state: DatabaseState;
  /** While starting, what it's doing; when failed, why. */
  detail?: string;
  /** Only for people who can run code in the room. */
  connection?: DatabaseConnection;
};

/**
 * One result from the query console (runner: database-queries.ts). Rows for
 * SQL results, Redis replies and MongoDB documents; a message for a statement's
 * status ("INSERT 0 1"); a value for any other MongoDB answer, as JSON.
 */
export type QueryResultSet =
  | { type: "rows"; columns: string[]; rows: (string | null)[][]; truncated?: boolean }
  | { type: "message"; text: string }
  | { type: "value"; text: string };

export type QueryResult = {
  results: QueryResultSet[];
  /** What went wrong, after any results that came before it. */
  error: string | null;
  ms: number;
  /** For a table preview: the query that made it, to edit in the console. */
  query?: string;
};

/** A table, view, collection or key, for the table browser. */
export type DatabaseTable = { name: string; schema?: string; detail?: string };

/** SQL for the SQL databases, one mongosh expression for MongoDB, one command per line for Redis. */
export const QueryInput = z.object({ query: z.string().trim().min(1, "Write a query first.").max(100_000) });
export const TablePreviewInput = z.object({ name: z.string().min(1).max(512), schema: z.string().max(512).optional() });
