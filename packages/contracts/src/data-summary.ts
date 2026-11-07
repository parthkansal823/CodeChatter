/**
 * Explain this data: the numbers behind a table of results, worked out by DuckDB in the sandbox (sandbox/image/summarize_data.py), for
 * the AI to explain. A model shown rows guesses at sums and averages, and only sees a few of them.
 */
import { z } from "zod";

export const DATA_LIMITS = { rows: 5_000, columns: 100, cellChars: 20_000, nameChars: 300, sampleRows: 5, sampleCellChars: 500, bodyBytes: 12 * 1024 * 1024 } as const;

export const DataSummaryInput = z.object({
  columns: z.array(z.string().max(DATA_LIMITS.nameChars)).min(1, "There's nothing to summarize.").max(DATA_LIMITS.columns, "That's too many columns to summarize."),
  rows: z
    .array(z.array(z.string().max(DATA_LIMITS.cellChars).nullable()))
    .min(1, "There are no rows to summarize.")
    .max(DATA_LIMITS.rows, "That's too many rows to summarize."),
});
export type DataSummaryInput = z.infer<typeof DataSummaryInput>;

const Stat = z.string().max(400).nullable();

export const DataColumn = z.object({
  name: z.string(),
  type: z.string(),
  nullPercent: z.number(),
  /** DuckDB's estimate. */
  unique: z.number(),
  min: Stat,
  max: Stat,
  mean: Stat,
  std: Stat,
  q25: Stat,
  q50: Stat,
  q75: Stat,
  /** Values beyond 1.5 times the interquartile range. */
  outliers: z.number(),
  top: z.array(z.object({ value: Stat, count: z.number() })),
});
export type DataColumn = z.infer<typeof DataColumn>;

export const DataSummary = z.object({
  engine: z.string(),
  rows: z.number(),
  duplicates: z.number(),
  columns: z.array(DataColumn),
  /** Only the strong ones. */
  correlations: z.array(z.object({ a: z.string(), b: z.string(), r: z.number() })),
});
export type DataSummary = z.infer<typeof DataSummary>;

/** What the AI's given with the question. */
export const ExplainDataContext = z.object({
  source: z.enum(["query", "notebook"]),
  /** False when these are only the rows that came back or were shown, and there are more. */
  complete: z.boolean(),
  summary: DataSummary,
  sample: z.object({
    columns: z.array(z.string().max(DATA_LIMITS.nameChars)).max(DATA_LIMITS.columns),
    rows: z.array(z.array(z.string().max(DATA_LIMITS.sampleCellChars).nullable())).max(DATA_LIMITS.sampleRows),
  }),
});
export type ExplainDataContext = z.infer<typeof ExplainDataContext>;

/** The first few rows, with long values cut, for the model to see what the data looks like. */
export function sampleOf(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | null>>): ExplainDataContext["sample"] {
  return { columns: columns.slice(0, DATA_LIMITS.columns), rows: rows.slice(0, DATA_LIMITS.sampleRows).map((row) => row.slice(0, DATA_LIMITS.columns).map((value) => (value === null ? null : value.slice(0, DATA_LIMITS.sampleCellChars)))) };
}

/** One column's numbers, as a line of text for the model. */
export function describeColumn(column: DataColumn): string {
  const parts = [`${column.nullPercent}% empty`, `about ${column.unique} distinct`];
  if (column.min !== null) parts.push(`from ${column.min} to ${column.max}`);
  if (column.mean !== null) parts.push(`mean ${column.mean}`, `std ${column.std}`, `quartiles ${column.q25}, ${column.q50}, ${column.q75}`, `${column.outliers} outliers`);
  if (column.top.length) parts.push(`most common: ${column.top.map((item) => `${item.value} (${item.count})`).join(", ")}`);
  return `${column.name} (${column.type}): ${parts.join("; ")}`;
}
