/**
 * The Lakehouse tool: a room's Delta Lake tables and MLflow runs, made with Spark in its notebooks. Spark, Delta Lake and MLflow are the
 * open-source tools Databricks is built on, and they come with the full sandbox image.
 */
import { z } from "zod";

const TableName = z.string().regex(/^\w[\w.-]{0,127}$/, "That isn't a table's name.");

export const LakehouseInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("overview") }),
  z.object({ op: z.literal("history"), table: TableName }),
  z.object({ op: z.literal("preview"), table: TableName, version: z.number().int().min(0).nullable().default(null) }),
  z.object({ op: z.literal("runs") }),
]);
export type LakehouseInput = z.infer<typeof LakehouseInput>;

export type LakehouseTable = { name: string; version: number; versions: number; rows: number | null; columns: Array<{ name: string; type: string }>; bytes: number; at: number | null; problem: string | null };
export type LakehouseCommit = { version: number; at: number | null; operation: string; rowsWritten: number | null; rowsChanged: number | null; engine: string };
export type LakehousePreview = { table: string; version: number | null; columns: string[]; rows: Array<Array<string | null>>; truncated: boolean };
export type LakehouseRun = { id: string; name: string; experiment: string; status: string; at: number | null; ms: number | null; params: Record<string, string>; metrics: Record<string, number> };

/** The columns a set of runs can be compared by: anything any of them logged. */
export function runColumns(runs: readonly LakehouseRun[]): { params: string[]; metrics: string[] } {
  const params = new Set<string>();
  const metrics = new Set<string>();
  for (const run of runs) {
    for (const name of Object.keys(run.params)) params.add(name);
    for (const name of Object.keys(run.metrics)) metrics.add(name);
  }
  return { params: [...params].sort(), metrics: [...metrics].sort() };
}
