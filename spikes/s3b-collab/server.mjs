// S3b spike: Hocuspocus 4 instance with the Redis extension (Valkey) and a
// Postgres persistence extension built the way apps/collab will build it.
//
// Durability model:
//  - onChange appends each *locally originated* update to doc_updates
//    (buffered, flushed every 100 ms). Updates relayed from another instance
//    carry transactionOrigin {source:"redis"} and are logged by their origin.
//  - onStoreDocument appends whatever this replica holds beyond what it has
//    persisted (Y.encodeStateAsUpdate(doc, persistedSV)). If the origin
//    instance died before flushing, any surviving replica still writes it.
//    Duplicates are harmless: Yjs updates are idempotent.
//  - Snapshots are built from the database, never from a live replica, under
//    an advisory lock, so a snapshot can't claim a seq whose update it lacks.
import { Server } from "@hocuspocus/server";
import { Redis } from "@hocuspocus/extension-redis";
import postgres from "postgres";
import * as Y from "yjs";

const INSTANCE = process.env.INSTANCE ?? "x";
const sql = postgres(process.env.DATABASE_URL, { max: 5, onnotice: () => {} });

async function migrate() {
  await sql`select pg_advisory_lock(42)`;
  try {
    await sql`create table if not exists doc_updates (
      doc_name text not null,
      seq bigint generated always as identity,
      ts timestamptz not null default now(),
      origin text not null,
      update bytea not null,
      primary key (doc_name, seq))`;
    await sql`create table if not exists doc_snapshots (
      doc_name text primary key,
      seq bigint not null,
      state bytea not null,
      updated_at timestamptz not null default now())`;
  } finally {
    await sql`select pg_advisory_unlock(42)`;
  }
}

const pending = new Map(); // docName -> Uint8Array[]
const persistedSV = new Map(); // docName -> state vector this replica knows is in the DB

async function flush() {
  const rows = [];
  for (const [doc_name, updates] of pending) {
    for (const u of updates) rows.push({ doc_name, origin: INSTANCE, update: Buffer.from(u) });
  }
  pending.clear();
  if (rows.length) await sql`insert into doc_updates ${sql(rows, "doc_name", "origin", "update")}`;
}
setInterval(() => flush().catch((e) => console.error("flush failed", e.message)), 100);

async function loadInto(ydoc, docName) {
  const [snap] = await sql`select seq, state from doc_snapshots where doc_name = ${docName}`;
  if (snap) Y.applyUpdate(ydoc, snap.state);
  const rows = await sql`select update from doc_updates where doc_name = ${docName} and seq > ${snap?.seq ?? 0} order by seq`;
  for (const r of rows) Y.applyUpdate(ydoc, r.update);
}

async function compact(docName) {
  await sql.begin(async (tx) => {
    const [{ locked }] = await tx`select pg_try_advisory_xact_lock(hashtext(${docName})) as locked`;
    if (!locked) return;
    const [{ max }] = await tx`select coalesce(max(seq), 0) as max from doc_updates where doc_name = ${docName}`;
    const doc = new Y.Doc();
    const [snap] = await tx`select seq, state from doc_snapshots where doc_name = ${docName}`;
    if (snap) Y.applyUpdate(doc, snap.state);
    const rows = await tx`select update from doc_updates where doc_name = ${docName} and seq > ${snap?.seq ?? 0} and seq <= ${max} order by seq`;
    for (const r of rows) Y.applyUpdate(doc, r.update);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    await tx`insert into doc_snapshots (doc_name, seq, state) values (${docName}, ${max}, ${state})
             on conflict (doc_name) do update set seq = excluded.seq, state = excluded.state, updated_at = now()`;
  });
}

const persistence = {
  extensionName: "pg-persistence",
  async onLoadDocument({ document, documentName }) {
    await loadInto(document, documentName);
    persistedSV.set(documentName, Y.encodeStateVector(document));
  },
  async onChange({ documentName, update, transactionOrigin }) {
    if (transactionOrigin && transactionOrigin.source === "redis") return;
    if (!pending.has(documentName)) pending.set(documentName, []);
    pending.get(documentName).push(update);
  },
  async onStoreDocument({ documentName, document }) {
    await flush();
    const known = persistedSV.get(documentName);
    const missing = known ? Y.encodeStateAsUpdate(document, known) : Y.encodeStateAsUpdate(document);
    // An empty diff encodes to 2 bytes (no structs, empty delete set).
    if (missing.length > 2) {
      await sql`insert into doc_updates (doc_name, origin, update) values (${documentName}, ${INSTANCE + ":store"}, ${Buffer.from(missing)})`;
    }
    persistedSV.set(documentName, Y.encodeStateVector(document));
    await compact(documentName);
  },
};

await migrate();

const server = new Server({
  name: INSTANCE,
  port: 8000,
  address: "0.0.0.0",
  quiet: true,
  debounce: 500,
  maxDebounce: 2000,
  extensions: [
    new Redis({ host: process.env.VALKEY_HOST ?? "valkey", port: 6379 }),
    persistence,
  ],
  async onAuthenticate({ token, connectionConfig }) {
    if (token === "viewer") {
      connectionConfig.readOnly = true;
      return { role: "viewer" };
    }
    if (token === "editor") return { role: "editor" };
    throw new Error("unauthorized");
  },
});

await server.listen();
console.log(`collab ${INSTANCE} listening`);
