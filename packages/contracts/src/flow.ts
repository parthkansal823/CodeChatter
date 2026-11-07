/**
 * The Flow tool: a room's data as a graph of datasets and the recipes that make them, as Dataiku shows it. Underneath it's a dbt project in
 * the room's files, which dbt Core reads and builds in the sandbox, on DuckDB, so a project made here runs anywhere dbt does.
 */
import { z } from "zod";

const DatasetName = z.string().regex(/^\w[\w.-]{0,127}$/, "That isn't a dataset's name.");

export const FlowInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("graph") }),
  z.object({ op: z.literal("status") }),
  z.object({
    op: z.literal("build"),
    /** Null builds the whole project. */
    dataset: DatasetName.nullable().default(null),
    /** "needs": this and what it's made from. "after": this and what's made from it. */
    scope: z.enum(["needs", "after", "only"]).default("needs"),
    /** Rebuild incremental tables from nothing. */
    fresh: z.boolean().default(false),
  }),
  z.object({ op: z.literal("stop") }),
  z.object({ op: z.literal("preview"), dataset: DatasetName }),
  z.object({ op: z.literal("profile"), dataset: DatasetName }),
  z.object({ op: z.literal("failures"), check: z.string().regex(/^test\.[\w.-]{1,250}$/, "That isn't a check.") }),
  z.object({ op: z.literal("runs") }),
  z.object({ op: z.literal("run"), id: z.string().regex(/^[\w-]{1,64}$/, "That isn't a run.") }),
]);
export type FlowInput = z.infer<typeof FlowInput>;

/** What dbt says happened to something: success, error and skipped, and for checks pass, warn and fail. */
export type FlowResult = { status: string | null; at: number | null; ms: number | null; failures: number | null; message: string | null };
export type FlowDataset = {
  id: string;
  kind: "model" | "seed" | "snapshot" | "source";
  name: string;
  language: "sql" | "python" | null;
  file: string | null;
  description: string;
  materialized: string | null;
  dependsOn: string[];
  result: FlowResult | null;
  /** Its file has changed since it was last built. */
  changed: boolean;
};
export type FlowCheck = {
  id: string;
  name: string;
  /** dbt's name for a rule written in YAML (not_null, unique...), null for one written as SQL. */
  rule: string | null;
  column: string | null;
  values: unknown[] | null;
  severity: string;
  of: string | null;
  file: string | null;
  result: FlowResult | null;
};
export type FlowCounts = { done: number; warned: number; failed: number; skipped: number };
export type FlowState = "idle" | "running" | "succeeded" | "warned" | "failed" | "stopped";
export type FlowLive = {
  state: FlowState;
  id: string | null;
  by?: string | null;
  dataset?: string | null;
  scope?: string | null;
  fresh?: boolean;
  startedAt?: number;
  finishedAt?: number | null;
  /** What's happened so far to each thing in this build, by dbt's id. */
  nodes: Record<string, string>;
  counts?: FlowCounts | null;
  message?: string | null;
  log: string[];
};
export type FlowGraph = {
  project: { path: string; name: string; others: number } | null;
  datasets: FlowDataset[];
  checks: FlowCheck[];
  /** What's wrong with the project, when dbt can't read it. What's listed is then from when it last could. */
  problem: string | null;
  live: FlowLive;
};
export type FlowRows = { name: string; columns: string[]; types: string[]; rows: Array<Array<string | null>>; truncated: boolean; built: boolean };
export type FlowColumnProfile = {
  name: string;
  type: string;
  nulls: number;
  distinct: number;
  min: string | null;
  max: string | null;
  mean: string | null;
  std: string | null;
  q25: string | null;
  q50: string | null;
  q75: string | null;
  top: Array<{ value: string | null; count: number }>;
};
export type FlowProfile = { name: string; built: boolean; rows: number | null; columns: FlowColumnProfile[] };
export type FlowRunSummary = Pick<FlowLive, "id" | "by" | "state" | "dataset" | "scope" | "fresh" | "startedAt" | "finishedAt" | "counts" | "message">;
