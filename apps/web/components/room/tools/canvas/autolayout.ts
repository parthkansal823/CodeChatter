import type { Point, Rect } from "./geometry";

/**
 * Auto layout for frames: children flow in a row or a column, like flexbox.
 * Pure: it takes the children's sizes in flow order and returns where each
 * goes, plus the frame's own size when it hugs its content.
 */
export type LayoutDirection = "none" | "row" | "column";
export type Justify = "start" | "center" | "end" | "between";
export type AlignItems = "start" | "center" | "end";

export type LayoutSpec = {
  direction: Exclude<LayoutDirection, "none">;
  gap: number;
  padX: number;
  padY: number;
  justify: Justify;
  alignItems: AlignItems;
  /** The frame shrinks or grows to fit its children instead of keeping its size. */
  hug: boolean;
};

export type LayoutResult = {
  /** Top-left corner of each child (same order as the input), in canvas units. */
  positions: Point[];
  /** The frame's box after layout (its own, unless it hugs). */
  frame: Rect;
};

/**
 * Lay out `sizes` inside `frame`. Children keep their sizes; only positions
 * (and the frame's size, when hugging) change.
 */
export function computeLayout(frame: Rect, spec: LayoutSpec, sizes: Array<{ w: number; h: number }>): LayoutResult {
  const row = spec.direction === "row";
  const main = (s: { w: number; h: number }) => (row ? s.w : s.h);
  const cross = (s: { w: number; h: number }) => (row ? s.h : s.w);
  const padMain = row ? spec.padX : spec.padY;
  const padCross = row ? spec.padY : spec.padX;
  const gaps = Math.max(0, sizes.length - 1) * spec.gap;
  const contentMain = sizes.reduce((sum, s) => sum + main(s), 0) + gaps;
  const contentCross = sizes.reduce((max, s) => Math.max(max, cross(s)), 0);

  let w = frame.w;
  let h = frame.h;
  if (spec.hug) {
    const mainSize = contentMain + padMain * 2;
    const crossSize = contentCross + padCross * 2;
    w = row ? mainSize : crossSize;
    h = row ? crossSize : mainSize;
  }
  const innerMain = (row ? w : h) - padMain * 2;
  const innerCross = (row ? h : w) - padCross * 2;

  // Free space on the main axis: "between" spreads it into the gaps, the rest shifts the start.
  const free = Math.max(0, innerMain - contentMain);
  let cursor = padMain;
  let gap = spec.gap;
  if (spec.justify === "center") cursor += free / 2;
  else if (spec.justify === "end") cursor += free;
  else if (spec.justify === "between" && sizes.length > 1) gap += free / (sizes.length - 1);

  const positions = sizes.map((s) => {
    const along = cursor;
    cursor += main(s) + gap;
    const room = innerCross - cross(s);
    const across = padCross + (spec.alignItems === "center" ? room / 2 : spec.alignItems === "end" ? room : 0);
    return row ? { x: frame.x + along, y: frame.y + across } : { x: frame.x + across, y: frame.y + along };
  });
  return { positions, frame: { x: frame.x, y: frame.y, w, h } };
}

/**
 * Where a dragged child belongs in the flow: the number of siblings whose
 * centre comes before the pointer along the main axis.
 */
export function insertionIndex(direction: "row" | "column", siblings: Rect[], dragged: Point): number {
  let index = 0;
  for (const s of siblings) {
    const centre = direction === "row" ? s.x + s.w / 2 : s.y + s.h / 2;
    if ((direction === "row" ? dragged.x : dragged.y) > centre) index++;
  }
  return index;
}
