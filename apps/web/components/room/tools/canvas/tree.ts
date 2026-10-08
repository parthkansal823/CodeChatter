import { compareOrder } from "./order";
import type { Shape } from "./shape";

/**
 * Children of every parent, in stacking order (bottom first). A shape whose
 * frame is gone (deleted by someone else mid-edit) is shown at the top level
 * rather than vanishing.
 */
export function childrenIndex(shapes: ReadonlyMap<string, Shape>): Map<string | null, Shape[]> {
  const index = new Map<string | null, Shape[]>();
  for (const shape of shapes.values()) {
    const parent = shape.parentId && shapes.get(shape.parentId)?.type === "frame" && !isCycle(shapes, shape) ? shape.parentId : null;
    let list = index.get(parent);
    if (!list) index.set(parent, (list = []));
    list.push(shape);
  }
  for (const list of index.values()) list.sort(compareOrder);
  return index;
}

/** Two concurrent reparents can make a loop (A in B, B in A); both then show at the top level. */
function isCycle(shapes: ReadonlyMap<string, Shape>, shape: Shape): boolean {
  const seen = new Set<string>([shape.id]);
  let parent = shape.parentId ? shapes.get(shape.parentId) : undefined;
  while (parent) {
    if (seen.has(parent.id)) return true;
    seen.add(parent.id);
    parent = parent.parentId ? shapes.get(parent.parentId) : undefined;
  }
  return false;
}

/** Every shape inside `id`, depth first in stacking order. */
export function descendantsOf(index: Map<string | null, Shape[]>, id: string): Shape[] {
  const out: Shape[] = [];
  const walk = (parent: string) => {
    for (const child of index.get(parent) ?? []) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Drop ids whose ancestor is also in the set (a selected frame already carries its children). */
export function topLevelIds(shapes: ReadonlyMap<string, Shape>, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => {
    let parentId = shapes.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (set.has(parentId)) return false;
      seen.add(parentId);
      parentId = shapes.get(parentId)?.parentId ?? null;
    }
    return shapes.has(id);
  });
}
