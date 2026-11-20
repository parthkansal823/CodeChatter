/**
 * Which runs are kept, flow by flow (host.mjs writes them, automation.py reads them): each flow keeps its own last runs (its settings' `keepRuns`, 50
 * when it doesn't say), rather than the room's last 50 between them all, so a busy flow doesn't push out a quiet one's. Each kept run has a marker in
 * its flow's folder of the index (`by-flow/<key>/<run id>`, holding how it ended), so a flow's runs are found without reading every run. A run that's
 * waiting is never dropped, and the room keeps at most MOST_ROOM_RUNS runs, whatever its flows say.
 */
import { createHash } from "node:crypto";

export const DEFAULT_KEEP_RUNS = 50;
export const MOST_KEEP_RUNS = 500;
export const MOST_ROOM_RUNS = 1000;
const FLOW_ID = /^[\w-]{1,100}$/;

/** A flow's folder in the index: its id, which stays with it when its file moves, or, without one, its path, hashed to a safe name. */
export function flowKeyOf(flowId, path) {
  if (typeof flowId === "string" && FLOW_ID.test(flowId)) return flowId;
  return `path-${createHash("sha256").update(String(path ?? "")).digest("hex").slice(0, 24)}`;
}

/** How many runs a flow keeps: its settings' `keepRuns`, a whole number from 1 to MOST_KEEP_RUNS, or the default. */
export function keepRunsOf(flow) {
  const wanted = flow?.settings?.keepRuns;
  return Number.isInteger(wanted) && wanted >= 1 ? Math.min(wanted, MOST_KEEP_RUNS) : DEFAULT_KEEP_RUNS;
}

/**
 * The runs to drop from a flow's: given its markers (`{ id, status }`) and how many it keeps, the oldest beyond that number, but never one waiting
 * (PAUSED), which is kept until it carries on. Run ids start with when they started, so they sort by time.
 */
export function runsToDrop(markers, keep) {
  const newestFirst = [...markers].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return newestFirst.slice(keep).filter((marker) => marker.status !== "PAUSED").map((marker) => marker.id);
}
