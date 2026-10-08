/** Plain geometry for the canvas: no DOM, no Yjs, so it can be unit-tested. */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const pointInRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const expandRect = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 });

/** Where a handle sits on a rect. */
export function handlePoint(r: Rect, handle: Handle): Point {
  const x = handle.includes("w") ? r.x : handle.includes("e") ? r.x + r.w : r.x + r.w / 2;
  const y = handle.includes("n") ? r.y : handle.includes("s") ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/**
 * The bounds after dragging a handle by (dx, dy). Dragging past the opposite
 * edge flips the box instead of giving it a negative size. With keepRatio,
 * corners scale by the larger of the two moves and edges scale the other
 * dimension around the centre, like design tools do with Shift.
 */
export function resizeBounds(start: Rect, handle: Handle, dx: number, dy: number, keepRatio = false): Rect {
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.w;
  let y1 = start.y + start.h;
  const movesW = handle.includes("w");
  const movesE = handle.includes("e");
  const movesN = handle.includes("n");
  const movesS = handle.includes("s");
  if (movesW) x0 += dx;
  if (movesE) x1 += dx;
  if (movesN) y0 += dy;
  if (movesS) y1 += dy;

  if (keepRatio && start.w > 0 && start.h > 0) {
    const sx = (x1 - x0) / start.w;
    const sy = (y1 - y0) / start.h;
    const horizontal = movesW || movesE;
    const vertical = movesN || movesS;
    if (horizontal && vertical) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      const w = start.w * s * Math.sign(sx || 1);
      const h = start.h * s * Math.sign(sy || 1);
      if (movesW) x0 = x1 - w;
      else x1 = x0 + w;
      if (movesN) y0 = y1 - h;
      else y1 = y0 + h;
    } else if (horizontal) {
      const h = start.h * Math.abs(sx);
      const cy = start.y + start.h / 2;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    } else if (vertical) {
      const w = start.w * Math.abs(sy);
      const cx = start.x + start.w / 2;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
    }
  }
  return rectFromPoints({ x: x0, y: y0 }, { x: x1, y: y1 });
}

/** Map a rect that sat inside `from` to the same relative place inside `to` (multi-select resize). */
export function mapRect(r: Rect, from: Rect, to: Rect): Rect {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return { x: to.x + (r.x - from.x) * sx, y: to.y + (r.y - from.y) * sy, w: r.w * sx, h: r.h * sy };
}

/** Scale relative points (stride 2 or 3; the third value is pressure and isn't scaled). */
export function scalePoints(points: number[], stride: number, sx: number, sy: number): number[] {
  return points.map((v, i) => (i % stride === 0 ? v * sx : i % stride === 1 ? v * sy : v));
}

export function pointsBounds(points: number[], stride: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < points.length; i += stride) {
    const x = points[i]!;
    const y = points[i + 1]!;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Absolute points → a shape's (x, y, w, h) plus points relative to its
 * top-left, the form shapes store.
 */
export function normalizePoints(absolute: number[], stride: number): { rect: Rect; points: number[] } {
  const rect = pointsBounds(absolute, stride);
  const points = absolute.map((v, i) => (i % stride === 0 ? v - rect.x : i % stride === 1 ? v - rect.y : v));
  return { rect, points };
}

/** Snap the angle of a→b to 45° steps (Shift while drawing a line). */
export function snapAngle(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
}

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

/** New top-left corners that align every rect to the group's edge or centre. */
export function alignRects(rects: Rect[], mode: AlignMode): Point[] {
  const bounds = unionRects(rects);
  if (!bounds) return [];
  return rects.map((r) => {
    switch (mode) {
      case "left":
        return { x: bounds.x, y: r.y };
      case "hcenter":
        return { x: bounds.x + (bounds.w - r.w) / 2, y: r.y };
      case "right":
        return { x: bounds.x + bounds.w - r.w, y: r.y };
      case "top":
        return { x: r.x, y: bounds.y };
      case "vcenter":
        return { x: r.x, y: bounds.y + (bounds.h - r.h) / 2 };
      case "bottom":
        return { x: r.x, y: bounds.y + bounds.h - r.h };
    }
  });
}

/**
 * Equal gaps between rects along an axis, keeping the first and last in
 * place. Returns new top-left corners in the input's order.
 */
export function distributeRects(rects: Rect[], axis: "x" | "y"): Point[] {
  const result = rects.map((r) => ({ x: r.x, y: r.y }));
  if (rects.length < 3) return result;
  const pos = (r: Rect) => (axis === "x" ? r.x : r.y);
  const size = (r: Rect) => (axis === "x" ? r.w : r.h);
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => pos(a.r) - pos(b.r));
  const first = order[0]!.r;
  const last = order[order.length - 1]!.r;
  const span = pos(last) + size(last) - pos(first);
  const total = order.reduce((sum, { r }) => sum + size(r), 0);
  const gap = (span - total) / (order.length - 1);
  let cursor = pos(first);
  for (const { r, i } of order) {
    if (axis === "x") result[i]!.x = cursor;
    else result[i]!.y = cursor;
    cursor += size(r) + gap;
  }
  return result;
}

/** Rotate p around c by deg degrees (clockwise in screen space, where y points down). */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/**
 * Where the ray from the centre of `r` towards `toward` leaves its outline,
 * pushed out by `gap`. Connectors attach to shapes this way, so they follow
 * the shapes around. Ellipses use the ellipse, everything else the box.
 */
export function outlinePoint(r: Rect, toward: Point, ellipse: boolean, gap = 0): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return c;
  const rx = r.w / 2;
  const ry = r.h / 2;
  let t: number;
  if (ellipse) {
    t = rx === 0 || ry === 0 ? 0 : 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  } else {
    const tx = dx === 0 ? Infinity : rx / Math.abs(dx);
    const ty = dy === 0 ? Infinity : ry / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  const ux = dx / length;
  const uy = dy / length;
  return { x: c.x + dx * t + ux * gap, y: c.y + dy * t + uy * gap };
}

/** The two back corners of an arrowhead at `tip`, pointing along from→tip. */
export function arrowHead(from: Point, tip: Point, size: number): [Point, Point] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) },
    { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) },
  ];
}

export const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
