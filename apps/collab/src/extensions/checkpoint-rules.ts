import type { CheckpointKind } from "@codechatter/contracts";

/**
 * When collab makes a checkpoint, and which old ones it lets go: the rules on their own,
 * so they can be tested without a database (checkpoints.ts uses them).
 */

/** Automatic checkpoints come this often while the files change. */
export const AUTO_EVERY_MS = 10 * 60_000;

/** Kept per room: the newest of each kind made by the system; named ones and saved ones are kept. */
export const KEEP = { auto: 100, pre_restore: 50, pre_ai: 50 } as const;

type Latest = { kind: CheckpointKind; at: number } | null;

/** Whether `changed` decides it: no need to compare the files when the answer doesn't depend on it. */
export function needsCompare(kind: CheckpointKind, latest: Latest, input: { now: number; every?: number }): boolean {
  if (kind === "manual" || !latest) return false;
  return kind !== "auto" || input.now - latest.at >= (input.every ?? AUTO_EVERY_MS);
}

/**
 * Whether to make one now. Automatic: when the files changed since the newest checkpoint
 * and it's old enough. Before a restore or an AI edit: unless nothing changed since the
 * newest (two AI edits in a row need one). Saved by hand: always.
 */
export function shouldMake(kind: CheckpointKind, latest: Latest, input: { now: number; changed: boolean; every?: number }): boolean {
  if (kind === "manual" || !latest) return true;
  if (kind === "auto") return input.changed && input.now - latest.at >= (input.every ?? AUTO_EVERY_MS);
  return input.changed;
}

/** The ids to delete (rows newest first): past the newest KEEP[kind] of a kind, those without a name. */
export function prunable(rows: Array<{ id: string; kind: CheckpointKind; label: string | null }>): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const row of rows) {
    const keep = KEEP[row.kind as keyof typeof KEEP];
    if (keep === undefined || row.label) continue;
    const n = (seen.get(row.kind) ?? 0) + 1;
    seen.set(row.kind, n);
    if (n > keep) out.push(row.id);
  }
  return out;
}
