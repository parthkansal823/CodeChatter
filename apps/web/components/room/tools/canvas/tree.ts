import { compareOrder } from "./order";
import type { Shape } from "./shape";

/** Frames clip children; groups carry children without painting or clipping. */
export const isContainer = (shape: Shape | undefined): boolean => shape?.type === "frame" || shape?.type === "group";

/** Missing containers and concurrent parent cycles leave shapes visible at the root. */
export function effectiveParent(shapes: ReadonlyMap<string, Shape>, id: string): string | null {
  const parentId = shapes.get(id)?.parentId ?? null;
  if (!parentId || !isContainer(shapes.get(parentId))) return null;
  const seen = new Set([id]);
  let cursor: string | null = parentId;
  while (cursor && isContainer(shapes.get(cursor))) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    cursor = shapes.get(cursor)?.parentId ?? null;
  }
  return parentId;
}

/** Effective ancestors, nearest first. */
export function ancestors(shapes: ReadonlyMap<string, Shape>, id: string): Shape[] {
  const out: Shape[] = [];
  let parent = effectiveParent(shapes, id);
  while (parent) {
    out.push(shapes.get(parent)!);
    const next = shapes.get(parent)?.parentId ?? null;
    parent = next && isContainer(shapes.get(next)) ? next : null;
  }
  return out;
}

export const effectiveHidden = (shapes: ReadonlyMap<string, Shape>, id: string): boolean =>
  !!shapes.get(id)?.hidden || ancestors(shapes, id).some((shape) => shape.hidden);

export const effectiveLocked = (shapes: ReadonlyMap<string, Shape>, id: string): boolean =>
  !!shapes.get(id)?.locked || ancestors(shapes, id).some((shape) => shape.locked);

/**
 * Children of every parent, in stacking order (bottom first). A shape whose
 * frame is gone (deleted by someone else mid-edit) is shown at the top level
 * rather than vanishing.
 */
export function childrenIndex(shapes: ReadonlyMap<string, Shape>): Map<string | null, Shape[]> {
  const index = new Map<string | null, Shape[]>();
  for (const shape of shapes.values()) {
    const parent = effectiveParent(shapes, shape.id);
    let list = index.get(parent);
    if (!list) index.set(parent, (list = []));
    list.push(shape);
  }
  for (const list of index.values()) list.sort(compareOrder);
  return index;
}

/** Every descendant, depth first in stacking order, without consuming the call stack. */
export function descendantsOf(index: Map<string | null, Shape[]>, id: string): Shape[] {
  const out: Shape[] = [];
  const seen = new Set([id]);
  const pending = [...(index.get(id) ?? [])].reverse();
  while (pending.length) {
    const child = pending.pop()!;
    if (seen.has(child.id)) continue;
    seen.add(child.id);
    out.push(child);
    const children = index.get(child.id) ?? [];
    for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
  }
  return out;
}

/** Drop ids whose ancestor is also in the set (a selected frame already carries its children). */
export function topLevelIds(shapes: ReadonlyMap<string, Shape>, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return [...set].filter((id) => shapes.has(id) && !ancestors(shapes, id).some((shape) => set.has(shape.id)));
}
