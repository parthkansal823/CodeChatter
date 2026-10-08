import { schema, type DbHandle } from "@codechatter/db";
import { initDoc, isInitialised, parseDocName, templateFiles } from "@codechatter/workspace-model";
import type { Extension, onChangePayload, onLoadDocumentPayload, onStoreDocumentPayload } from "@hocuspocus/server";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import * as Y from "yjs";

import type { CollabContext } from "./access.js";

/**
 * Postgres persistence, as proven in spike S3b (ADR 0005):
 *  - onChange appends each locally originated update to doc_updates, buffered
 *    and flushed every 100 ms. Updates relayed from another instance carry
 *    origin {source:"redis"} and are logged by the instance they came from.
 *  - onStoreDocument appends whatever this replica holds beyond what it has
 *    persisted, so a crash of the originating instance loses nothing.
 *  - Snapshots are compacted from the log (never from a live replica) under an
 *    advisory lock, so a snapshot can't claim a seq whose update it lacks.
 *  - A new room is seeded from its template exactly once, even when two
 *    instances load it at the same moment.
 */
export function persistenceExtension(handle: DbHandle, instance: string): Extension {
  const { db } = handle;
  const pending = new Map<string, Array<{ update: Uint8Array; userId: string | null }>>();
  const persistedSV = new Map<string, Uint8Array>();

  async function flush() {
    const rows = [...pending].flatMap(([docName, updates]) =>
      updates.map(({ update, userId }) => ({ docName, origin: instance, userId, update })),
    );
    pending.clear();
    if (rows.length) await db.insert(schema.docUpdates).values(rows);
  }
  const timer = setInterval(() => void flush().catch((e) => console.error("[collab] flush failed", e)), 100);
  timer.unref();

  async function loadInto(doc: Y.Doc, docName: string) {
    const snap = await db.query.docSnapshots.findFirst({ where: eq(schema.docSnapshots.docName, docName) });
    if (snap) Y.applyUpdate(doc, snap.state);
    const rows = await db
      .select({ update: schema.docUpdates.update })
      .from(schema.docUpdates)
      .where(and(eq(schema.docUpdates.docName, docName), gt(schema.docUpdates.seq, snap?.seq ?? 0)))
      .orderBy(asc(schema.docUpdates.seq));
    for (const row of rows) Y.applyUpdate(doc, row.update);
  }

  async function seedIfEmpty(doc: Y.Doc, docName: string) {
    const parsed = parseDocName(docName);
    if (!parsed) return;
    await db.transaction(async (tx) => {
      // One seeder per document across all instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${docName}))`);
      const existing = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.docUpdates).where(eq(schema.docUpdates.docName, docName));
      if ((existing[0]?.n ?? 0) > 0) {
        // Another instance seeded while we waited: load its work instead.
        const rows = await tx.select({ update: schema.docUpdates.update }).from(schema.docUpdates).where(eq(schema.docUpdates.docName, docName)).orderBy(asc(schema.docUpdates.seq));
        for (const row of rows) Y.applyUpdate(doc, row.update);
        return;
      }
      const room = await tx.query.rooms.findFirst({ where: eq(schema.rooms.id, parsed.roomId), columns: { templateId: true } });
      const seeded = new Y.Doc();
      initDoc(seeded, room?.templateId ?? "blank", templateFiles(room?.templateId));
      const update = Y.encodeStateAsUpdate(seeded);
      await tx.insert(schema.docUpdates).values({ docName, origin: `${instance}:seed`, update });
      Y.applyUpdate(doc, update);
    });
  }

  async function compact(docName: string) {
    await db.transaction(async (tx) => {
      const [{ locked } = { locked: false }] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${`compact:${docName}`})) as locked`,
      );
      if (!locked) return;
      const [{ max } = { max: 0 }] = await tx
        .select({ max: sql<number>`coalesce(max(${schema.docUpdates.seq}), 0)::bigint` })
        .from(schema.docUpdates)
        .where(eq(schema.docUpdates.docName, docName));
      const snap = await tx.query.docSnapshots.findFirst({ where: eq(schema.docSnapshots.docName, docName) });
      if (Number(max) <= (snap?.seq ?? 0)) return;
      const doc = new Y.Doc();
      if (snap) Y.applyUpdate(doc, snap.state);
      const rows = await tx
        .select({ update: schema.docUpdates.update })
        .from(schema.docUpdates)
        .where(and(eq(schema.docUpdates.docName, docName), gt(schema.docUpdates.seq, snap?.seq ?? 0), lte(schema.docUpdates.seq, Number(max))))
        .orderBy(asc(schema.docUpdates.seq));
      for (const row of rows) Y.applyUpdate(doc, row.update);
      const state = Y.encodeStateAsUpdate(doc);
      await tx
        .insert(schema.docSnapshots)
        .values({ docName, seq: Number(max), state })
        .onConflictDoUpdate({ target: schema.docSnapshots.docName, set: { seq: Number(max), state, updatedAt: new Date() } });
    });
  }

  return {
    extensionName: "pg-persistence",

    async onLoadDocument({ document, documentName }: onLoadDocumentPayload) {
      await loadInto(document, documentName);
      // Only the files document is seeded from the room's template.
      if (parseDocName(documentName)?.kind === "files" && !isInitialised(document)) await seedIfEmpty(document, documentName);
      persistedSV.set(documentName, Y.encodeStateVector(document));
    },

    async onChange({ documentName, update, transactionOrigin, context }: onChangePayload<CollabContext>) {
      if (transactionOrigin && (transactionOrigin as { source?: string }).source === "redis") return;
      if (!pending.has(documentName)) pending.set(documentName, []);
      pending.get(documentName)!.push({ update, userId: context?.userId ?? null });
    },

    async onStoreDocument({ documentName, document }: onStoreDocumentPayload) {
      await flush();
      const known = persistedSV.get(documentName);
      const missing = known ? Y.encodeStateAsUpdate(document, known) : Y.encodeStateAsUpdate(document);
      // An empty diff encodes to 2 bytes (no structs, empty delete set).
      if (missing.length > 2) {
        await db.insert(schema.docUpdates).values({ docName: documentName, origin: `${instance}:store`, update: missing });
      }
      persistedSV.set(documentName, Y.encodeStateVector(document));
      await compact(documentName);
    },

    async afterUnloadDocument({ documentName }) {
      persistedSV.delete(documentName);
    },

    async onDestroy() {
      clearInterval(timer);
      await flush();
    },
  };
}
