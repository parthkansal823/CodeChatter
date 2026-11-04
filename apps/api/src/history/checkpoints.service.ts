import type { CheckpointSummary } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";

import { DB } from "../infra/tokens.js";

/** At most this many in the list, newest first (collab keeps fewer: checkpoint-rules.ts). */
const LIST_LIMIT = 500;

/**
 * A room's checkpoints (made by collab: apps/collab/src/extensions/checkpoints.ts): the
 * list, one's stored Yjs state for the browser to read, and naming or deleting one.
 */
@Injectable()
export class CheckpointsService {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private readonly columns = {
    id: schema.checkpoints.id,
    kind: schema.checkpoints.kind,
    label: schema.checkpoints.label,
    createdAt: schema.checkpoints.createdAt,
    seq: schema.checkpoints.seq,
    byId: schema.user.id,
    byName: schema.user.name,
    size: sql<number>`octet_length(${schema.checkpoints.state})::int`,
  };

  async list(roomId: string): Promise<CheckpointSummary[]> {
    const rows = await this.handle.db
      .select(this.columns)
      .from(schema.checkpoints)
      .leftJoin(schema.user, eq(schema.checkpoints.createdBy, schema.user.id))
      .where(eq(schema.checkpoints.roomId, roomId))
      .orderBy(desc(schema.checkpoints.createdAt))
      .limit(LIST_LIMIT);
    return rows.map(toSummary);
  }

  async state(roomId: string, id: string): Promise<Uint8Array> {
    const [row] = await this.handle.db
      .select({ state: schema.checkpoints.state })
      .from(schema.checkpoints)
      .where(and(eq(schema.checkpoints.roomId, roomId), eq(schema.checkpoints.id, id)));
    if (!row) throw new NotFoundException("That checkpoint isn't in this room (it may have been deleted).");
    return row.state;
  }

  /** Name it, or take its name away; a named one is never let go automatically. */
  async rename(roomId: string, id: string, label: string | null): Promise<CheckpointSummary> {
    const [updated] = await this.handle.db
      .update(schema.checkpoints)
      .set({ label: label || null })
      .where(and(eq(schema.checkpoints.roomId, roomId), eq(schema.checkpoints.id, id)))
      .returning({ id: schema.checkpoints.id });
    if (!updated) throw new NotFoundException("That checkpoint isn't in this room (it may have been deleted).");
    const [row] = await this.handle.db
      .select(this.columns)
      .from(schema.checkpoints)
      .leftJoin(schema.user, eq(schema.checkpoints.createdBy, schema.user.id))
      .where(eq(schema.checkpoints.id, id));
    return toSummary(row!);
  }

  async remove(roomId: string, id: string): Promise<void> {
    const deleted = await this.handle.db
      .delete(schema.checkpoints)
      .where(and(eq(schema.checkpoints.roomId, roomId), eq(schema.checkpoints.id, id)))
      .returning({ id: schema.checkpoints.id });
    if (!deleted.length) throw new NotFoundException("That checkpoint isn't in this room (it may have been deleted).");
  }
}

type Row = {
  id: string;
  kind: CheckpointSummary["kind"];
  label: string | null;
  createdAt: Date;
  seq: number;
  byId: string | null;
  byName: string | null;
  size: number;
};

const toSummary = (row: Row): CheckpointSummary => ({
  id: row.id,
  kind: row.kind,
  label: row.label,
  at: row.createdAt.toISOString(),
  seq: Number(row.seq),
  by: row.byId && row.byName ? { id: row.byId, name: row.byName } : null,
  size: row.size,
});
