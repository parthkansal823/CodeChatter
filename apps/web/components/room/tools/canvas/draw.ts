import { getStroke } from "perfect-freehand";

import { arrowHead, center, outlinePoint, pointsBounds, type Point, type Rect } from "./geometry";
import type { Shape } from "./shape";
import { STICKY_PADDING, type Font } from "./text-layout";

/**
 * Drawing math shared by the live SVG canvas and the SVG/HTML export, so an
 * exported file looks like the canvas.
 */
export type Lookup = (id: string) => Shape | undefined;

const r2 = (n: number) => Math.round(n * 100) / 100;

const outlines = new WeakMap<number[], Map<number, string>>();

/**
 * A pen stroke's outline as SVG path data (relative to the shape's origin).
 * Pressure from a mouse is a flat 0.5, so it's simulated from speed instead.
 */
export function freehandPath(points: number[], strokeWidth: number): string {
  let bySize = outlines.get(points);
  const cached = bySize?.get(strokeWidth);
  if (cached !== undefined) return cached;
  const input: number[][] = [];
  let realPressure = false;
  for (let i = 0; i + 2 < points.length; i += 3) {
    input.push([points[i]!, points[i + 1]!, points[i + 2]!]);
    if (points[i + 2] !== 0.5) realPressure = true;
  }
  const stroke = getStroke(input, {
    size: Math.max(1, strokeWidth * 2),
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: !realPressure,
    last: true,
  });
  let d = "";
  if (stroke.length > 0) {
    const parts: Array<string | number> = ["M", r2(stroke[0]![0]), r2(stroke[0]![1]), "Q"];
    stroke.forEach(([x0, y0], i) => {
      const [x1, y1] = stroke[(i + 1) % stroke.length]!;
      parts.push(r2(x0), r2(y0), r2((x0 + x1) / 2), r2((y0 + y1) / 2));
    });
    parts.push("Z");
    d = parts.join(" ");
  }
  if (!bySize) {
    bySize = new Map();
    outlines.set(points, bySize);
  }
  bySize.set(strokeWidth, d);
  return d;
}

/**
 * A line or arrow's two ends in canvas units. A whiteboard connector's end
 * that is attached to a shape follows that shape: it starts where the line
 * between the two centres leaves the shape's outline.
 */
export function linearEnds(shape: Shape, lookup: Lookup): [Point, Point] {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = shape.points;
  let a: Point = { x: shape.x + x1, y: shape.y + y1 };
  let b: Point = { x: shape.x + x2, y: shape.y + y2 };
  const start = shape.startId ? lookup(shape.startId) : undefined;
  const end = shape.endId ? lookup(shape.endId) : undefined;
  const startRect = start && !start.hidden ? rectOf(start) : null;
  const endRect = end && !end.hidden ? rectOf(end) : null;
  const towardB = endRect ? center(endRect) : b;
  const towardA = startRect ? center(startRect) : a;
  if (startRect) a = outlinePoint(startRect, towardB, start!.type === "ellipse", 6);
  if (endRect) b = outlinePoint(endRect, towardA, end!.type === "ellipse", 6);
  return [a, b];
}

const rectOf = (s: Shape): Rect => ({ x: s.x, y: s.y, w: s.w, h: s.h });

/** The box a shape occupies (before rotation). Attached connectors are measured where they're drawn. */
export function shapeBounds(shape: Shape, lookup: Lookup): Rect {
  if ((shape.type === "line" || shape.type === "arrow") && (shape.startId || shape.endId)) {
    const [a, b] = linearEnds(shape, lookup);
    return pointsBounds([a.x, a.y, b.x, b.y], 2);
  }
  return rectOf(shape);
}

/** SVG path data for a line or arrow, with the arrowhead as a closed triangle. */
export function linearPaths(shape: Shape, lookup: Lookup): { line: string; head: string | null } {
  const [a, b] = linearEnds(shape, lookup);
  const line = `M ${r2(a.x)} ${r2(a.y)} L ${r2(b.x)} ${r2(b.y)}`;
  if (shape.type !== "arrow") return { line, head: null };
  const size = Math.max(8, shape.strokeWidth * 4);
  const [l, r] = arrowHead(a, b, size);
  return { line, head: `M ${r2(b.x)} ${r2(b.y)} L ${r2(l.x)} ${r2(l.y)} L ${r2(r.x)} ${r2(r.y)} Z` };
}

export const fontOf = (shape: Shape): Font => ({
  size: shape.fontSize,
  weight: shape.fontWeight,
  family: shape.type === "sticky" ? "note" : "sans",
});

/** Where a shape's text sits: the box it wraps in (null width: no wrapping). */
export function textFrame(shape: Shape): { x: number; y: number; width: number | null } {
  if (shape.type === "sticky") {
    return { x: shape.x + STICKY_PADDING, y: shape.y + STICKY_PADDING, width: Math.max(1, shape.w - STICKY_PADDING * 2) };
  }
  return { x: shape.x, y: shape.y, width: shape.wrap ? Math.max(1, shape.w) : null };
}

/** SVG transform for a rotated shape, or undefined. */
export function rotationTransform(shape: Shape): string | undefined {
  if (!shape.rotation) return undefined;
  return `rotate(${r2(shape.rotation)} ${r2(shape.x + shape.w / 2)} ${r2(shape.y + shape.h / 2)})`;
}

/** The text colour on a sticky note: soft note colours are always paired with black text. */
export const STICKY_TEXT = "var(--brand-foreground)";
