/** Read-time group geometry: peers only write leaf geometry, never stale group unions. */
import { shapeBounds } from "./draw";
import { center, pointsBounds, rotatePoint, unionRects } from "./geometry";
import type { Shape } from "./shape";
import { childrenIndex } from "./tree";

/** Derive transparent group boxes bottom-up. Unchanged snapshots retain their identity. */
export function normalizeGroups(shapes: ReadonlyMap<string, Shape>): ReadonlyMap<string, Shape> {
  const groups = [...shapes.values()].filter((shape) => shape.type === "group");
  if (!groups.length) return shapes;
  const next = new Map(shapes);
  const index = childrenIndex(shapes);
  const order: Shape[] = [];
  // An explicit postorder handles deep groups and malformed orphan/cyclic parents.
  const pending = [...(index.get(null) ?? [])].reverse();
  while (pending.length) {
    const shape = pending.pop()!;
    order.push(shape);
    const children = index.get(shape.id) ?? [];
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const shape = order[i]!;
    if (shape.type !== "group") continue;
    const box = unionRects((index.get(shape.id) ?? []).map((child) => {
      const current = next.get(child.id)!;
      const rect = shapeBounds(current, (id) => next.get(id));
      if (!current.rotation) return rect;
      const c = center(rect);
      const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h }];
      return pointsBounds(corners.flatMap((p) => { const r = rotatePoint(p, c, current.rotation); return [r.x, r.y]; }), 2);
    })) ?? { x: shape.x, y: shape.y, w: 0, h: 0 };
    if (shape.x !== box.x || shape.y !== box.y || shape.w !== box.w || shape.h !== box.h || shape.rotation !== 0) {
      next.set(shape.id, { ...shape, ...box, rotation: 0 });
    }
  }
  return next;
}
