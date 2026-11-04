import {
  CheckpointRequest,
  type CheckpointKind,
  type CheckpointReply,
  type CheckpointSummary,
  type CheckpointsChanged,
} from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { parseDocName } from "@codechatter/workspace-model";
import type { Document, Extension, onChangePayload, onStatelessPayload } from "@hocuspocus/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as Y from "yjs";

import type { CollabContext } from "./access.js";
import { AUTO_EVERY_MS, needsCompare, prunable, shouldMake } from "./checkpoint-rules.js";

/**
 * Checkpoints of a room's files (the History view): the files document's Yjs state, taken
 * from the live document so it has every edit collab has, in the checkpoints table.
 *  - Automatically, every AUTO_EVERY_MS while the files change (checked each minute).
 *  - When a browser asks over its connection (a stateless message, so it comes after that
 *    browser's own edits): saved by hand, or before a restore or an AI edit. Only someone
 *    who can edit the files may ask; the answer goes to that connection.
 *  - Everyone in the room hears that the list changed. Old automatic ones are let go
 *    (checkpoint-rules.ts). A room gets its first one when it first loads.
 * Several collab instances can hold the same document: an advisory lock per document
 * makes them take turns, and each decides against the newest row.
 */
export function checkpointsExtension(handle: DbHandle, options: { every?: number; tickMs?: number } = {}): Extension {
  const { db } = handle;
  const every = options.every ?? AUTO_EVERY_MS;
  const loaded = new Map<string, Document>();
  /** Files documents with edits made through this instance since its last automatic check. */
  const dirty = new Set<string>();

  /** Make one if the rules say so; the checkpoint that holds these files either way (none when the room has none). */
  async function make(
    docName: string,
    document: Document,
    kind: CheckpointKind,
    label: string | null,
    userId: string | null,
  ): Promise<{ checkpoint: CheckpointSummary | null; made: boolean; due: boolean }> {
    const roomId = parseDocName(docName)?.roomId;
    if (!roomId) return { checkpoint: null, made: false, due: false };
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checkpoint:${docName}`}))`);
      const [latest] = await tx
        .select({ id: schema.checkpoints.id, kind: schema.checkpoints.kind, createdAt: schema.checkpoints.createdAt })
        .from(schema.checkpoints)
        .where(and(eq(schema.checkpoints.roomId, roomId), eq(schema.checkpoints.docName, docName)))
        .orderBy(desc(schema.checkpoints.createdAt))
        .limit(1);
      const now = Date.now();
      const newest = latest ? { kind: latest.kind, at: latest.createdAt.getTime() } : null;
      let changed = true;
      const due = needsCompare(kind, newest, { now, every });
      if (latest && due) {
        const [row] = await tx.select({ state: schema.checkpoints.state }).from(schema.checkpoints).where(eq(schema.checkpoints.id, latest.id));
        changed = !row || !sameVector(Y.encodeStateVectorFromUpdate(row.state), Y.encodeStateVector(document));
      }
      if (!shouldMake(kind, newest, { now, changed, every })) return { id: latest?.id ?? null, made: false, due };
      const [{ seq } = { seq: 0 }] = await tx
        .select({ seq: sql<number>`coalesce(max(${schema.docUpdates.seq}), 0)::bigint` })
        .from(schema.docUpdates)
        .where(eq(schema.docUpdates.docName, docName));
      const [row] = await tx
        .insert(schema.checkpoints)
        .values({ roomId, docName, seq: Number(seq), kind, label, createdBy: userId, state: Y.encodeStateAsUpdate(document) })
        .returning({ id: schema.checkpoints.id });
      const all = await tx
        .select({ id: schema.checkpoints.id, kind: schema.checkpoints.kind, label: schema.checkpoints.label })
        .from(schema.checkpoints)
        .where(eq(schema.checkpoints.roomId, roomId))
        .orderBy(desc(schema.checkpoints.createdAt));
      const gone = prunable(all);
      if (gone.length) await tx.delete(schema.checkpoints).where(inArray(schema.checkpoints.id, gone));
      return { id: row!.id, made: true, due: true };
    });
    if (result.made) document.broadcastStateless(JSON.stringify({ type: "checkpoints-changed" } satisfies CheckpointsChanged));
    return { checkpoint: result.id ? await summary(result.id) : null, made: result.made, due: result.due };
  }

  async function summary(id: string): Promise<CheckpointSummary | null> {
    const [row] = await db
      .select({
        id: schema.checkpoints.id,
        kind: schema.checkpoints.kind,
        label: schema.checkpoints.label,
        createdAt: schema.checkpoints.createdAt,
        seq: schema.checkpoints.seq,
        byId: schema.user.id,
        byName: schema.user.name,
        size: sql<number>`octet_length(${schema.checkpoints.state})::int`,
      })
      .from(schema.checkpoints)
      .leftJoin(schema.user, eq(schema.checkpoints.createdBy, schema.user.id))
      .where(eq(schema.checkpoints.id, id));
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      at: row.createdAt.toISOString(),
      seq: Number(row.seq),
      by: row.byId && row.byName ? { id: row.byId, name: row.byName } : null,
      size: row.size,
    };
  }

  async function tick() {
    for (const docName of [...dirty]) {
      const document = loaded.get(docName);
      dirty.delete(docName);
      if (!document) continue;
      const result = await make(docName, document, "auto", null, null).catch((error) => {
        console.error(`[collab] checkpoint of ${docName} failed`, error);
        return null;
      });
      // Not due yet (or it failed): look again next time.
      if (!result || !result.due) dirty.add(docName);
    }
  }
  const timer = setInterval(() => void tick(), options.tickMs ?? 60_000);
  timer.unref();

  const isFiles = (docName: string) => parseDocName(docName)?.kind === "files";

  return {
    extensionName: "checkpoints",

    async afterLoadDocument({ documentName, document }) {
      if (!isFiles(documentName)) return;
      loaded.set(documentName, document);
      // A room's first checkpoint; or, when it's due, one of edits the last one missed (the room emptied first).
      await make(documentName, document, "auto", null, null).catch((error) => console.error(`[collab] first checkpoint of ${documentName} failed`, error));
    },

    async afterUnloadDocument({ documentName }) {
      loaded.delete(documentName);
      dirty.delete(documentName);
    },

    async onChange({ documentName, transactionOrigin }: onChangePayload) {
      // Edits relayed from another instance are that instance's to check.
      if ((transactionOrigin as { source?: string } | undefined)?.source === "redis") return;
      if (isFiles(documentName)) dirty.add(documentName);
    },

    async onStateless({ connection, documentName, document, payload }: onStatelessPayload) {
      let message: unknown;
      try {
        message = JSON.parse(payload);
      } catch {
        return;
      }
      if ((message as { type?: unknown })?.type !== "checkpoint") return;
      const parsed = CheckpointRequest.safeParse(message);
      const request = parsed.success ? parsed.data.request : String((message as { request?: unknown }).request ?? "").slice(0, 64);
      const reply = (answer: Omit<Extract<CheckpointReply, { ok: true }>, "type" | "request"> | { ok: false; error: string }) =>
        connection.sendStateless(JSON.stringify({ type: "checkpoint", request, ...answer } as CheckpointReply));
      if (!parsed.success) return reply({ ok: false, error: "That isn't a checkpoint request." });
      if (!isFiles(documentName)) return reply({ ok: false, error: "Only the room's files have checkpoints." });
      if (connection.readOnly) return reply({ ok: false, error: "You can't edit this room's files, so you can't save checkpoints." });
      const context = connection.context as CollabContext;
      try {
        const { checkpoint } = await make(documentName, document, parsed.data.kind, parsed.data.label, context.userId);
        if (!checkpoint) return reply({ ok: false, error: "Couldn't save the checkpoint." });
        reply({ ok: true, checkpoint });
      } catch (error) {
        console.error(`[collab] checkpoint of ${documentName} failed`, error);
        reply({ ok: false, error: "Couldn't save the checkpoint. Try again." });
      }
    },

    async onDestroy() {
      clearInterval(timer);
    },
  };
}

function sameVector(a: Uint8Array, b: Uint8Array): boolean {
  const left = Y.decodeStateVector(a);
  const right = Y.decodeStateVector(b);
  if (left.size !== right.size) return false;
  for (const [client, clock] of left) if (right.get(client) !== clock) return false;
  return true;
}
