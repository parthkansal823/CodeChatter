import { OVERRIDABLE, type Overrides, type Shape } from "./shape";
import { childrenIndex, descendantsOf } from "./tree";

/**
 * Components: a frame marked as a main component, and instances that show
 * its content wherever they're placed. An instance stores no copy of the
 * content, only where it sits and what it overrides, so changing the main
 * component updates every instance. Pure helpers; the editor and renderer
 * build on them.
 */
type Lookup = (id: string) => Shape | undefined;

/** Instances inside components inside instances can loop; stop expanding past this depth. */
const MAX_DEPTH = 6;

/** The id of a shape drawn inside an instance (it exists only while rendering or exporting). */
export const virtualId = (instanceId: string, shapeId: string) => `${instanceId}~${shapeId}`;

/** The main component an instance shows, if it still exists and still is one. */
export function mainOf(instance: Shape, lookup: Lookup): Shape | undefined {
  const main = instance.instanceOf ? lookup(instance.instanceOf) : undefined;
  return main && main.type === "frame" && main.component ? main : undefined;
}

/** A shape inside a component, as one instance sees it. */
export function withOverrides(shape: Shape, overrides: Overrides): Shape {
  const changes = overrides[shape.id];
  if (!changes) return shape;
  const next = { ...shape };
  for (const key of OVERRIDABLE) {
    const value = changes[key];
    if (value === undefined) continue;
    // Only accept the type the property holds, so a bad value from an old client can't break drawing.
    if (typeof value === typeof shape[key]) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/** Everything inside a main component, in drawing order, as the shapes an instance at (x, y) would show. */
export function instanceContent(instance: Shape, main: Shape, shapes: ReadonlyMap<string, Shape>): Shape[] {
  const index = childrenIndex(shapes);
  const dx = instance.x - main.x;
  const dy = instance.y - main.y;
  return descendantsOf(index, main.id).map((child) => {
    const seen = withOverrides(child, instance.overrides);
    return {
      ...seen,
      id: virtualId(instance.id, child.id),
      x: seen.x + dx,
      y: seen.y + dy,
      parentId: child.parentId === main.id ? instance.id : child.parentId ? virtualId(instance.id, child.parentId) : instance.id,
      startId: child.startId ? virtualId(instance.id, child.startId) : null,
      endId: child.endId ? virtualId(instance.id, child.endId) : null,
    };
  });
}

/**
 * The same shapes with every instance replaced by a plain frame holding
 * copies of its component's content. Export, inspect and code generation
 * work on this, so they never need to know about components.
 */
export function expandInstances(shapes: ReadonlyMap<string, Shape>): Map<string, Shape> {
  const out = new Map(shapes);
  const lookup: Lookup = (id) => shapes.get(id);
  const expand = (instance: Shape, depth: number) => {
    const main = mainOf(instance, lookup);
    if (!main || depth > MAX_DEPTH) return;
    out.set(instance.id, {
      ...instance,
      type: "frame",
      w: main.w,
      h: main.h,
      fill: main.fill,
      stroke: main.stroke,
      strokeWidth: main.strokeWidth,
      radius: main.radius,
      layout: main.layout,
      gap: main.gap,
      padX: main.padX,
      padY: main.padY,
      justify: main.justify,
      alignItems: main.alignItems,
      hug: main.hug,
      component: false,
      instanceOf: null,
    });
    for (const copy of instanceContent(instance, main, shapes)) {
      out.set(copy.id, copy);
      if (copy.type === "instance") expand(copy, depth + 1);
    }
  };
  for (const shape of shapes.values()) if (shape.type === "instance") expand(shape, 0);
  return out;
}

/** The shapes inside a component that an instance can override, with what each can change. */
export function overridableIn(main: Shape, shapes: ReadonlyMap<string, Shape>): Shape[] {
  const index = childrenIndex(shapes);
  return descendantsOf(index, main.id).filter((s) => s.type !== "instance" && s.type !== "frame");
}

/** Instances of a component, for "N instances" and for what to detach when it's deleted. */
export function instancesOf(mainId: string, shapes: ReadonlyMap<string, Shape>): Shape[] {
  return [...shapes.values()].filter((s) => s.type === "instance" && s.instanceOf === mainId);
}
