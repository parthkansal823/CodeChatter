import type { Rect } from "./geometry";

/** A snap guide line in canvas units: `at` on its axis, spanning from→to on the other. */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

/**
 * Which lines of the moving rect may snap, as fractions of its size
 * (0 = left/top edge, 0.5 = centre, 1 = right/bottom edge). A move snaps all
 * three; dragging a resize handle snaps only the edge under the pointer.
 */
export type SnapLines = { x: number[]; y: number[] };

export const MOVE_LINES: SnapLines = { x: [0, 0.5, 1], y: [0, 0.5, 1] };
const TARGET_LINES = [0, 0.5, 1];
const EPSILON = 0.01;

const line = (r: Rect, axis: "x" | "y", f: number) => (axis === "x" ? r.x + r.w * f : r.y + r.h * f);

function bestOffset(moving: Rect, targets: Rect[], threshold: number, axis: "x" | "y", fractions: number[]): number | null {
  let best: number | null = null;
  for (const f of fractions) {
    const m = line(moving, axis, f);
    for (const t of targets) {
      for (const g of TARGET_LINES) {
        const offset = line(t, axis, g) - m;
        if (Math.abs(offset) <= threshold && (best === null || Math.abs(offset) < Math.abs(best))) best = offset;
      }
    }
  }
  return best;
}

function guidesFor(snapped: Rect, targets: Rect[], axis: "x" | "y", fractions: number[]): Guide[] {
  const other = axis === "x" ? "y" : "x";
  const byLine = new Map<number, Guide>();
  for (const f of fractions) {
    const m = line(snapped, axis, f);
    for (const t of targets) {
      for (const g of TARGET_LINES) {
        const at = line(t, axis, g);
        if (Math.abs(at - m) > EPSILON) continue;
        const from = Math.min(line(snapped, other, 0), line(t, other, 0));
        const to = Math.max(line(snapped, other, 1), line(t, other, 1));
        const key = Math.round(at * 100) / 100;
        const existing = byLine.get(key);
        if (existing) {
          existing.from = Math.min(existing.from, from);
          existing.to = Math.max(existing.to, to);
        } else byLine.set(key, { axis, at, from, to });
      }
    }
  }
  return [...byLine.values()];
}

/**
 * Snap a moving rect to other shapes' edges and centres. Returns the offset
 * to apply (0 on an axis with nothing within `threshold`) and the guide lines
 * to draw for every alignment the snapped rect now has.
 */
export function snapRect(
  moving: Rect,
  targets: Rect[],
  threshold: number,
  lines: SnapLines = MOVE_LINES,
): { dx: number; dy: number; guides: Guide[] } {
  const dx = bestOffset(moving, targets, threshold, "x", lines.x);
  const dy = bestOffset(moving, targets, threshold, "y", lines.y);
  const snapped = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) };
  const guides = [
    ...(dx === null ? [] : guidesFor(snapped, targets, "x", lines.x)),
    ...(dy === null ? [] : guidesFor(snapped, targets, "y", lines.y)),
  ];
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}
