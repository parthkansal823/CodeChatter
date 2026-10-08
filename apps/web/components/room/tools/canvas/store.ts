import type * as Y from "yjs";

import { readShape, type CanvasKind, type Shape } from "./shape";
import { childrenIndex } from "./tree";

type Listener = () => void;

const sameIds = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Immutable snapshots of the shapes in a Y.Map, with subscriptions narrow
 * enough that a change re-renders only what it touches: one shape's view
 * listens to that shape, a frame's child list listens to structure changes
 * (added, removed, reordered, reparented), and panels that need everything
 * listen to any change. Snapshots keep their identity until they change,
 * which is what useSyncExternalStore needs.
 */
export class ShapeStore {
  private shapes = new Map<string, Shape>();
  private byId = new Map<string, Set<Listener>>();
  private structureListeners = new Set<Listener>();
  private anyListeners = new Set<Listener>();
  private allSnapshot: ReadonlyMap<string, Shape> | null = null;
  private childIdsCache = new Map<string | null, string[]>();
  private structureStale = true;
  private picks = new WeakMap<readonly string[], Shape[]>();

  private readonly map: Y.Map<Y.Map<unknown>>;
  private readonly kind: CanvasKind;
  /** Ids of frames with auto layout, so reflow only looks at them. */
  readonly autoFrames = new Set<string>();
  /** The shapes the last change touched (including removed ones). */
  lastChanged: ReadonlySet<string> = new Set();

  constructor(map: Y.Map<Y.Map<unknown>>, kind: CanvasKind) {
    this.map = map;
    this.kind = kind;
    map.forEach((entry, id) => this.put(id, readShape(id, entry, kind)));
    map.observeDeep(this.onChange);
  }

  destroy() {
    this.map.unobserveDeep(this.onChange);
  }

  private onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    const changed = new Set<string>();
    let structure = false;
    for (const event of events) {
      const keys = (event as Y.YMapEvent<unknown>).keysChanged;
      if (event.target === this.map) {
        keys.forEach((id) => changed.add(id));
        structure = true;
        continue;
      }
      const id = event.path[0];
      if (typeof id !== "string") continue;
      changed.add(id);
      if (keys?.has("z") || keys?.has("parentId") || keys?.has("type")) structure = true;
    }
    if (changed.size === 0) return;
    for (const id of changed) {
      const entry = this.map.get(id);
      if (entry) this.put(id, readShape(id, entry, this.kind));
      else this.remove(id);
    }
    this.lastChanged = changed;
    this.allSnapshot = null;
    if (structure) this.structureStale = true;
    for (const id of changed) this.byId.get(id)?.forEach((listener) => listener());
    if (structure) [...this.structureListeners].forEach((listener) => listener());
    [...this.anyListeners].forEach((listener) => listener());
  };

  private put(id: string, shape: Shape) {
    this.shapes.set(id, shape);
    if (shape.type === "frame" && shape.layout !== "none") this.autoFrames.add(id);
    else this.autoFrames.delete(id);
  }

  private remove(id: string) {
    this.shapes.delete(id);
    this.autoFrames.delete(id);
  }

  get = (id: string): Shape | undefined => this.shapes.get(id);

  has = (id: string) => this.shapes.has(id);

  get size() {
    return this.shapes.size;
  }

  /** Every shape; a new Map only after something changed. */
  all = (): ReadonlyMap<string, Shape> => {
    this.allSnapshot ??= new Map(this.shapes);
    return this.allSnapshot;
  };

  /** Child ids of a frame (null: the canvas), bottom first. Unchanged lists keep their identity. */
  childIds = (parentId: string | null): string[] => {
    if (this.structureStale) {
      const index = childrenIndex(this.shapes);
      const next = new Map<string | null, string[]>();
      for (const [parent, list] of index) {
        const ids = list.map((s) => s.id);
        const previous = this.childIdsCache.get(parent);
        next.set(parent, sameIds(previous, ids) ? previous! : ids);
      }
      this.childIdsCache = next;
      this.structureStale = false;
    }
    let ids = this.childIdsCache.get(parentId);
    if (!ids) this.childIdsCache.set(parentId, (ids = []));
    return ids;
  };

  /** The shapes for a list of ids (missing ones dropped); the same array while none of them changed. */
  pick = (ids: readonly string[]): Shape[] => {
    const next = ids.map((id) => this.shapes.get(id)).filter((s): s is Shape => Boolean(s));
    const previous = this.picks.get(ids);
    if (previous && previous.length === next.length && previous.every((s, i) => s === next[i])) return previous;
    this.picks.set(ids, next);
    return next;
  };

  subscribeShape = (id: string, listener: Listener) => {
    let set = this.byId.get(id);
    if (!set) this.byId.set(id, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.byId.delete(id);
    };
  };

  subscribeStructure = (listener: Listener) => {
    this.structureListeners.add(listener);
    return () => {
      this.structureListeners.delete(listener);
    };
  };

  subscribeAny = (listener: Listener) => {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  };
}
