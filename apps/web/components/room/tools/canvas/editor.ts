import { randomId } from "@codechatter/workspace-model";
import * as Y from "yjs";

import { Atom } from "./atom";
import { fontOf, linearEnds, shapeBounds, textFrame } from "./draw";
import {
  alignRects,
  center,
  distributeRects,
  normalizePoints,
  pointInRect,
  rotatePoint,
  scalePoints,
  unionRects,
  type AlignMode,
  type Point,
  type Rect,
} from "./geometry";
import { isValidKey, keyBetween, keysBetween } from "./order";
import {
  defaultsFor,
  hasText,
  isLinear,
  parseShape,
  pointStride,
  shapeData,
  shapeEntries,
  TYPE_LABEL,
  type CanvasKind,
  type Shape,
  type ShapePatch,
  type ShapeProps,
  type ShapeType,
} from "./shape";
import type { Guide } from "./snap";
import { ShapeStore } from "./store";
import { layoutText, STICKY_PADDING, type Measure } from "./text-layout";
import { ancestors, childrenIndex, descendantsOf, effectiveHidden, effectiveLocked, effectiveParent, isContainer, topLevelIds } from "./tree";

export type ToolId = "select" | "hand" | "frame" | "rect" | "ellipse" | "line" | "arrow" | "text" | "pen" | "sticky" | "eraser";

/** screen = world × zoom + (x, y) */
export type Camera = { x: number; y: number; zoom: number };
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export type ClipboardPayload = { type: "codechatter/shapes"; version: 1; shapes: Shape[] };
export type Draft = { points: number[]; stroke: string; strokeWidth: number };
export type LayerDrop = "above" | "below" | "inside";

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const TEXT_KEYS = ["text", "fontSize", "fontWeight", "w", "wrap", "type"] as const;

function toYMap(data: ShapeProps): Y.Map<unknown> {
  const entry = new Y.Map<unknown>();
  for (const [key, value] of shapeEntries(data, true)) entry.set(key, value);
  return entry;
}

/**
 * Everything a canvas does, outside React: the shapes (through ShapeStore),
 * the commands that change them, and the local UI state (camera, selection,
 * tool) as atoms. React components subscribe to the slices they draw; pointer
 * handling calls commands. Only this person's own edits are undoable, and one
 * gesture (a whole drag, a whole text edit) is one undo step.
 */
export class Editor {
  readonly map: Y.Map<Y.Map<unknown>>;
  readonly store: ShapeStore;
  readonly undoManager: Y.UndoManager;

  readonly camera = new Atom<Camera>({ x: 0, y: 0, zoom: 1 });
  readonly viewport = new Atom<{ w: number; h: number }>({ w: 0, h: 0 });
  readonly selection = new Atom<readonly string[]>([]);
  /** The group whose immediate contents clicks currently select. Local, never shared. */
  readonly activeGroup = new Atom<string | null>(null);
  readonly tool = new Atom<ToolId>("select");
  readonly editingId = new Atom<string | null>(null);
  readonly guides = new Atom<Guide[]>([]);
  readonly marquee = new Atom<Rect | null>(null);
  readonly draft = new Atom<Draft | null>(null);
  /** Shapes the eraser has touched this stroke; they fade, and go when the pointer lifts. */
  readonly erasing = new Atom<ReadonlySet<string>>(new Set());
  /** The shape a connector being drawn would attach to. */
  readonly target = new Atom<string | null>(null);
  readonly readOnly = new Atom<boolean>(false);
  /** Space is held: dragging pans whatever the tool. */
  readonly spacePan = new Atom<boolean>(false);
  /** The shape under the pointer, outlined as a hint of what a click would select. */
  readonly hoverId = new Atom<string | null>(null);
  readonly history = new Atom<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false });
  /** Whiteboard colours new notes and strokes start with. */
  readonly style = new Atom<{ note: string; ink: string; width: number }>({ note: "var(--p-8-soft)", ink: "var(--foreground)", width: 4 });

  readonly doc: Y.Doc;
  readonly kind: CanvasKind;
  private readonly measure: Measure;
  private unsubscribe: () => void;
  private writeDepth = 0;
  private populatedGroups = new Set<string>();
  private readonly maintenanceOrigin = {};

  constructor(doc: Y.Doc, kind: CanvasKind, measure: Measure) {
    this.doc = doc;
    this.kind = kind;
    this.measure = measure;
    this.map = doc.getMap<Y.Map<unknown>>("shapes");
    this.store = new ShapeStore(this.map, kind);
    // An infinite capture window: steps are cut explicitly at the start and
    // end of every command and gesture, so a slow drag is still one step.
    this.undoManager = new Y.UndoManager(this.map, { trackedOrigins: new Set([this]), captureTimeout: Number.POSITIVE_INFINITY });
    const syncHistory = () =>
      this.history.set({ canUndo: this.undoManager.undoStack.length > 0, canRedo: this.undoManager.redoStack.length > 0 });
    this.undoManager.on("stack-item-added", syncHistory);
    this.undoManager.on("stack-item-popped", syncHistory);
    this.undoManager.on("stack-cleared", syncHistory);
    this.unsubscribe = this.store.subscribeAny(this.prune);
    this.populatedGroups = this.groupParents();
    this.doc.on("afterTransaction", this.maintainGroups);
  }

  destroy() {
    this.doc.off("afterTransaction", this.maintainGroups);
    this.unsubscribe();
    this.undoManager.destroy();
    this.store.destroy();
  }

  /** Someone else (or an undo) removed shapes: drop them from the selection and stop editing them. */
  private prune = () => {
    const selection = this.selection.get();
    const kept = selection.filter((id) => this.store.has(id));
    if (kept.length !== selection.length) this.selection.set(kept);
    const editing = this.editingId.get();
    if (editing && !this.store.has(editing)) this.editingId.set(null);
    const active = this.activeGroup.get();
    if (active && (this.store.get(active)?.type !== "group" || effectiveHidden(this.store.all(), active) || effectiveLocked(this.store.all(), active))) this.activeGroup.set(null);
  };

  // ---------------------------------------------------------------- queries

  get = (id: string) => this.store.get(id);

  bounds(id: string): Rect | null {
    const shape = this.store.get(id);
    return shape ? shapeBounds(shape, this.store.get) : null;
  }

  selectionBounds(ids: readonly string[] = this.selection.get()): Rect | null {
    return unionRects(ids.map((id) => this.bounds(id)).filter((r): r is Rect => r !== null));
  }

  /** Selected ids minus those inside a selected frame. */
  topSelection(ids: readonly string[] = this.selection.get()): string[] {
    return topLevelIds(this.store.all(), ids);
  }

  /** Resolve a leaf hit to the outer group, or to an immediate child while drilling in. */
  resolveHit(id: string | null): string | null {
    const all = this.store.all();
    if (!id || !all.has(id) || effectiveHidden(all, id) || effectiveLocked(all, id)) return null;
    const active = this.activeGroup.get();
    let resolved = id;
    for (const ancestor of ancestors(all, id)) {
      if (ancestor.id === active) break;
      if (ancestor.type === "group") resolved = ancestor.id;
    }
    return resolved;
  }

  enterGroup(id: string): boolean {
    const all = this.store.all();
    if (all.get(id)?.type !== "group" || effectiveHidden(all, id) || effectiveLocked(all, id)) return false;
    this.stopEditing();
    this.activeGroup.set(id);
    this.selection.set([]);
    return true;
  }

  exitGroup(): boolean {
    const id = this.activeGroup.get();
    if (!id) return false;
    const parent = ancestors(this.store.all(), id).find((shape) => shape.type === "group");
    this.activeGroup.set(parent?.id ?? null);
    this.selection.set(this.store.has(id) ? [id] : []);
    return true;
  }

  /** The shapes a move of `ids` carries: them plus everything inside them. */
  carried(ids: readonly string[]): Shape[] {
    const all = this.store.all();
    const index = childrenIndex(all);
    const out = new Map<string, Shape>();
    for (const id of topLevelIds(all, ids)) {
      const shape = all.get(id);
      if (!shape) continue;
      out.set(id, shape);
      for (const d of descendantsOf(index, id)) out.set(d.id, d);
    }
    return [...out.values()];
  }

  /** Every shape in drawing order (bottom first). */
  paintOrder(): Shape[] {
    const index = childrenIndex(this.store.all());
    return [...(index.get(null) ?? [])].flatMap((shape) => [shape, ...descendantsOf(index, shape.id)]);
  }

  /** The innermost visible frame under a point, ignoring `exclude`. */
  frameAt(p: Point, exclude: Set<string> = new Set()): string | null {
    let found: string | null = null;
    const all = this.store.all();
    for (const shape of this.paintOrder()) {
      if (shape.type !== "frame" || exclude.has(shape.id) || effectiveHidden(all, shape.id) || effectiveLocked(all, shape.id)) continue;
      if (ancestors(all, shape.id).some((ancestor) => ancestor.type === "frame" && !pointInRect(p, ancestor))) continue;
      if (pointInRect(p, shape)) found = shape.id;
    }
    return found;
  }

  /** The topmost shape a connector can attach to under a point. */
  attachableAt(p: Point, exclude: Set<string> = new Set()): string | null {
    const order = this.paintOrder();
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i]!;
      if (effectiveHidden(this.store.all(), s.id) || effectiveLocked(this.store.all(), s.id) || exclude.has(s.id) || isLinear(s.type) || s.type === "path" || isContainer(s)) continue;
      if (pointInRect(p, s)) return s.id;
    }
    return null;
  }

  // ---------------------------------------------------------------- writing

  /** Start a gesture: the writes until endGesture() are one undo step. */
  beginGesture() {
    this.undoManager.stopCapturing();
  }

  endGesture() {
    this.undoManager.stopCapturing();
  }

  /** Write as this person (undoable), inside the current step. */
  write(fn: () => void) {
    if (this.readOnly.get()) return;
    const outer = this.writeDepth++ === 0;
    const candidates = outer ? this.groupParents() : null;
    try {
      this.doc.transact(() => {
        fn();
        if (candidates) this.cleanupEmptyGroups(candidates);
      }, this);
    } finally {
      this.writeDepth--;
    }
  }

  /** Read raw parent keys: the immutable store stays frozen during a transaction. */
  private groupParents(): Set<string> {
    const out = new Set<string>();
    for (const entry of this.map.values()) {
      const parent = entry.get("parentId");
      if (typeof parent === "string" && this.map.get(parent)?.get("type") === "group") out.add(parent);
    }
    return out;
  }

  private cleanupEmptyGroups(candidates: Set<string>) {
    let populated = this.groupParents();
    let again = true;
    while (again) {
      again = false;
      for (const id of candidates) {
        const entry = this.map.get(id);
        if (entry?.get("type") !== "group" || populated.has(id)) continue;
        const parent = entry.get("parentId");
        this.map.delete(id);
        if (typeof parent === "string") candidates.add(parent);
        again = true;
      }
      if (again) populated = this.groupParents();
    }
  }

  /** Independent peer deletions can empty a group only after their updates merge. */
  private maintainGroups = (transaction: Y.Transaction) => {
    if (transaction.origin === this.maintenanceOrigin) return;
    const populated = this.groupParents();
    const emptied = new Set([...this.populatedGroups].filter((id) => !populated.has(id)));
    this.populatedGroups = populated;
    if (emptied.size) this.doc.transact(() => this.cleanupEmptyGroups(emptied), this.maintenanceOrigin);
    this.populatedGroups = this.groupParents();
  };

  /** A discrete command: its own undo step. */
  change(fn: () => void) {
    this.beginGesture();
    this.write(fn);
    this.endGesture();
  }

  /** Set only the keys that differ; text shapes re-measure when their text or box changes. */
  apply(id: string, patch: ShapePatch) {
    const entry = this.map.get(id);
    const shape = this.store.get(id);
    if (!entry || !shape) return;
    const next = { ...patch, ...this.relayout(shape, patch) };
    if (shape.type === "group") {
      delete next.x; delete next.y; delete next.w; delete next.h; delete next.rotation;
    }
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (entry.get(key) === value) continue;
      entry.set(key, value);
    }
  }

  update(id: string, patch: ShapePatch) {
    this.updateMany([[id, patch]]);
  }

  updateMany(patches: Array<[string, ShapePatch]>) {
    this.change(() => patches.forEach(([id, patch]) => {
      if (this.store.get(id)?.type === "group" && patch.rotation) this.rotateGroup(id, patch.rotation);
      this.apply(id, patch);
    }));
  }

  private rotateGroup(id: string, degrees: number) {
    const group = this.store.get(id);
    if (!group) return;
    const index = childrenIndex(this.store.all());
    const origin = center(group);
    const pending = [...(index.get(id) ?? [])];
    while (pending.length) {
      const shape = pending.pop()!;
      if (shape.type === "group") { pending.push(...(index.get(shape.id) ?? [])); continue; }
      if (isLinear(shape.type)) {
        const pivot = center(shape);
        const ends = linearEnds(shape, this.store.get).map((p) => rotatePoint(rotatePoint(p, pivot, shape.rotation), origin, degrees));
        const { rect, points } = normalizePoints(ends.flatMap((p) => [p.x, p.y]), 2);
        // Attached ends already follow rotated targets. Bake the free geometry and avoid a second SVG rotation.
        this.apply(shape.id, { ...rect, points, rotation: 0 });
        continue;
      }
      const rotated = rotatePoint(center(shape), origin, degrees);
      const dx = rotated.x - center(shape).x;
      const dy = rotated.y - center(shape).y;
      this.apply(shape.id, { x: shape.x + dx, y: shape.y + dy, rotation: shape.rotation + degrees });
      // A frame's SVG transform rotates its subtree; translate those children with the frame only.
      if (shape.type === "frame") for (const child of descendantsOf(index, shape.id)) {
        if (child.type !== "group") this.apply(child.id, { x: child.x + dx, y: child.y + dy });
      }
    }
  }

  /**
   * Set a shape's box from the properties panel. Lines and pen strokes scale
   * their points to match, text boxes wrap at the new width, and a frame's
   * contents stay where they are.
   */
  setBox(id: string, box: Partial<Rect>) {
    const s = this.store.get(id);
    if (!s) return;
    const next = { x: box.x ?? s.x, y: box.y ?? s.y, w: Math.max(1, box.w ?? s.w), h: Math.max(1, box.h ?? s.h) };
    const patch: ShapePatch = { ...next };
    if (s.type === "group") {
      const sx = s.w ? next.w / s.w : 1;
      const sy = s.h ? next.h / s.h : 1;
      this.change(() => {
        for (const child of this.carried([id])) {
          if (child.type === "group") continue;
          const resized: ShapePatch = { x: next.x + (child.x - s.x) * sx, y: next.y + (child.y - s.y) * sy, w: child.w * sx, h: child.h * sy };
          if (isLinear(child.type) || child.type === "path") resized.points = scalePoints(child.points, pointStride(child.type), sx, sy);
          if (child.type === "text") { resized.wrap = true; delete resized.h; }
          this.apply(child.id, resized);
        }
      });
      return;
    }
    if (isLinear(s.type) || s.type === "path") {
      patch.points = scalePoints(s.points, pointStride(s.type), s.w ? next.w / s.w : 1, s.h ? next.h / s.h : 1);
    }
    if (s.type === "text") {
      patch.wrap = true;
      if (box.h === undefined) delete patch.h;
    }
    this.update(id, patch);
  }

  private relayout(shape: Shape, patch: ShapePatch): ShapePatch {
    const merged = { ...shape, ...patch };
    if (!hasText(merged.type) || !TEXT_KEYS.some((key) => key in patch)) return {};
    const frame = textFrame(merged);
    const layout = layoutText(merged.text, frame.width, fontOf(merged), this.measure);
    if (merged.type === "sticky") {
      const needed = layout.height + STICKY_PADDING * 2;
      return needed > merged.h ? { h: needed } : {};
    }
    const h = Math.max(layout.height, Math.round(merged.fontSize * 1.3));
    return merged.wrap ? { h } : { w: Math.max(2, layout.width + 2), h };
  }

  /** The key of the topmost child of `parentId` (null when it has none, or garbage). */
  private lastKey(parentId: string | null): string | null {
    const ids = this.store.childIds(parentId);
    const last = ids.length ? this.store.get(ids[ids.length - 1]!)?.z : null;
    return last && isValidKey(last) ? last : null;
  }

  /** A key above every current child of `parentId`. */
  private topKey(parentId: string | null): string {
    return keyBetween(this.lastKey(parentId), null);
  }

  private nextName(type: ShapeType): string {
    let count = 0;
    for (const shape of this.store.all().values()) if (shape.type === type) count++;
    return `${TYPE_LABEL[type]} ${count + 1}`;
  }

  /** Add a shape inside the current step. Returns its id. */
  create(type: ShapeType, props: ShapePatch = {}): string {
    const id = randomId();
    if (this.readOnly.get()) return id;
    const parentId = props.parentId === undefined ? this.activeGroup.get() : props.parentId;
    const base = { ...defaultsFor(type, this.kind), name: this.nextName(type), ...props, type, parentId };
    const data = { ...base, z: props.z ?? this.topKey(parentId) };
    const draft = parseShape(id, data, this.kind);
    const sized = { ...data, ...this.relayout(draft, { text: draft.text }) };
    this.write(() => this.map.set(id, toYMap(sized)));
    return id;
  }

  /** Delete shapes and everything inside them. Connectors attached to them stay where they were drawn. */
  deleteShapes(ids: readonly string[]) {
    if (this.readOnly.get() || ids.length === 0) return;
    const eligible = this.topSelection(ids).filter((id) => !effectiveLocked(this.store.all(), id));
    const doomed = new Set(this.carried(eligible).map((s) => s.id));
    this.change(() => {
      for (const shape of this.store.all().values()) {
        if (doomed.has(shape.id)) continue;
        const detachStart = !!shape.startId && doomed.has(shape.startId);
        const detachEnd = !!shape.endId && doomed.has(shape.endId);
        if (detachStart || detachEnd) this.apply(shape.id, this.detach(shape, detachStart, detachEnd));
      }
      doomed.forEach((id) => this.map.delete(id));
    });
    this.selection.set(this.selection.get().filter((id) => !doomed.has(id)));
  }

  /** A patch that turns a connector's attached ends into free points where they are drawn now. */
  detach(shape: Shape, start = true, end = true): ShapePatch {
    const [a, b] = linearEnds(shape, this.store.get);
    const { rect, points } = normalizePoints([a.x, a.y, b.x, b.y], 2);
    return {
      ...rect,
      points,
      startId: start ? null : shape.startId,
      endId: end ? null : shape.endId,
    };
  }

  /** Move shapes (and what's inside them) by a delta, as one step. */
  nudge(ids: readonly string[], dx: number, dy: number) {
    if (this.readOnly.get()) return;
    const eligible = this.topSelection(ids).filter((id) => !effectiveLocked(this.store.all(), id));
    const moving = this.carried(eligible).filter((s) => s.type !== "group");
    const movingIds = new Set(moving.map((s) => s.id));
    this.change(() => {
      for (const s of moving) {
        const frozen = this.freezeIfLeaving(s, movingIds);
        this.apply(s.id, { ...frozen, x: (frozen.x ?? s.x) + dx, y: (frozen.y ?? s.y) + dy });
      }
    });
  }

  /** A connector moving without the shape it's attached to lets go of it. */
  freezeIfLeaving(shape: Shape, moving: Set<string>): ShapePatch {
    if (!isLinear(shape.type)) return {};
    const leaveStart = !!shape.startId && !moving.has(shape.startId);
    const leaveEnd = !!shape.endId && !moving.has(shape.endId);
    return leaveStart || leaveEnd ? this.detach(shape, leaveStart, leaveEnd) : {};
  }

  /**
   * After a move, put each moved shape in the frame its centre landed in
   * (or back on the canvas), on top of that frame's children.
   */
  reparent(ids: readonly string[]) {
    if (this.kind !== "design") return;
    const all = this.store.all();
    const top = topLevelIds(all, ids);
    const exclude = new Set(this.carried(top).map((s) => s.id));
    for (const id of top) {
      const shape = all.get(id);
      const bounds = this.bounds(id);
      if (!shape || !bounds) continue;
      // Drilling into a group edits its contents without silently pulling them out on pointer-up.
      if (all.get(effectiveParent(all, id) ?? "")?.type === "group") continue;
      const parentId = this.frameAt(center(bounds), exclude);
      const scopedParent = this.activeGroup.get() ?? parentId;
      if (scopedParent !== effectiveParent(all, id)) this.apply(id, { parentId: scopedParent, z: this.topKey(scopedParent) });
    }
  }

  duplicate(ids: readonly string[]): string[] {
    const payload = this.copyPayload(ids);
    return payload ? this.paste(payload, { x: 16, y: 16 }) : [];
  }

  copyPayload(ids: readonly string[]): ClipboardPayload | null {
    const top = new Set(this.topSelection(ids));
    if (top.size === 0) return null;
    const carried = new Set(this.carried([...top]).map((s) => s.id));
    const shapes = this.paintOrder().filter((s) => carried.has(s.id));
    return { type: "codechatter/shapes", version: 1, shapes };
  }

  /**
   * Paste shapes with fresh ids, on top of their new parent's children.
   * Frames keep their contents; connectors keep attachments that were copied
   * with them and let go of the rest. `offset` shifts everything (duplicate);
   * `at` centres the paste on a canvas point instead.
   */
  paste(payload: ClipboardPayload, place: { x: number; y: number; at?: boolean }): string[] {
    if (this.readOnly.get() || payload.shapes.length === 0) return [];
    const source = new Map(payload.shapes.map((s) => [s.id, parseShape(s.id, s as unknown as Record<string, unknown>, this.kind)]));
    const ids = new Map([...source.keys()].map((id) => [id, randomId()]));
    const lookup = (id: string) => source.get(id) ?? this.store.get(id);
    let dx = place.x;
    let dy = place.y;
    if (place.at) {
      const bounds = unionRects([...source.values()].map((s) => shapeBounds(s, lookup)));
      if (bounds) {
        dx = place.x - (bounds.x + bounds.w / 2);
        dy = place.y - (bounds.y + bounds.h / 2);
      }
    }
    const rootIds = new Set(topLevelIds(source, source.keys()));
    const roots = [...source.values()].filter((s) => rootIds.has(s.id));
    const rootParent = (s: Shape) => (!place.at && s.parentId && isContainer(this.store.get(s.parentId)) ? s.parentId : this.activeGroup.get());
    const keysByParent = new Map<string | null, string[]>();
    for (const root of roots) {
      const parent = rootParent(root);
      keysByParent.set(parent, [...(keysByParent.get(parent) ?? []), root.id]);
    }
    const zFor = new Map<string, string>();
    for (const [parent, members] of keysByParent) {
      const keys = keysBetween(this.lastKey(parent), null, members.length);
      members.forEach((id, i) => zFor.set(id, keys[i]!));
    }
    const created: string[] = [];
    this.change(() => {
      for (const s of source.values()) {
        let shape = s;
        if (isLinear(s.type)) {
          const leaveStart = !!s.startId && !source.has(s.startId);
          const leaveEnd = !!s.endId && !source.has(s.endId);
          if (leaveStart || leaveEnd) {
            const [a, b] = linearEnds(s, lookup);
            const { rect, points } = normalizePoints([a.x, a.y, b.x, b.y], 2);
            shape = { ...s, ...rect, points, startId: leaveStart ? null : s.startId, endId: leaveEnd ? null : s.endId };
          }
        }
        const isRoot = rootIds.has(s.id);
        const newId = ids.get(s.id)!;
        const data = {
          ...shapeData(shape),
          x: shape.x + dx,
          y: shape.y + dy,
          parentId: isRoot ? rootParent(s) : ids.get(s.parentId!)!,
          z: isRoot ? zFor.get(s.id)! : isValidKey(s.z) ? s.z : "a0",
          startId: shape.startId ? (ids.get(shape.startId) ?? null) : null,
          endId: shape.endId ? (ids.get(shape.endId) ?? null) : null,
        };
        this.map.set(newId, toYMap(data));
        if (isRoot) created.push(newId);
      }
    });
    this.selection.set(created);
    return created;
  }

  /** A plain reason the current selection cannot become one transparent group. */
  groupingError(): string | null {
    if (this.readOnly.get()) return "Canvas is read-only.";
    const all = this.store.all();
    const top = this.topSelection();
    if (top.length < 2) return "Select at least two shapes.";
    if (top.some((id) => effectiveLocked(all, id))) return "Unlock the selected shapes first.";
    if (new Set(top.map((id) => effectiveParent(all, id))).size !== 1) return "Select shapes in the same frame or group.";
    return null;
  }

  /** Keep absolute geometry and child z keys; the group replaces the highest selected sibling. */
  groupSelection(): string | null {
    if (this.groupingError()) return null;
    const top = this.topSelection();
    const parentId = effectiveParent(this.store.all(), top[0]!);
    const selected = new Set(top);
    const highest = this.store.childIds(parentId).filter((id) => selected.has(id)).at(-1)!;
    const bounds = this.selectionBounds(top)!;
    let id = "";
    this.change(() => {
      id = this.create("group", { ...bounds, parentId, z: this.store.get(highest)!.z });
      for (const child of top) this.apply(child, { parentId: id });
    });
    this.selection.set([id]);
    return id;
  }

  /** Replace groups in their sibling order with their immediate children, without moving anything. */
  ungroupSelection(): string[] {
    if (this.readOnly.get()) return [];
    const all = this.store.all();
    const groups = this.topSelection().filter((id) => all.get(id)?.type === "group" && !effectiveLocked(all, id));
    if (!groups.length) return [];
    const chosen = new Set(groups);
    const parents = new Set(groups.map((id) => effectiveParent(all, id)));
    const promoted: string[] = [];
    this.change(() => {
      for (const parent of parents) {
        const moved = new Set<string>();
        const order: string[] = [];
        for (const id of this.store.childIds(parent)) {
          if (!chosen.has(id)) { order.push(id); continue; }
          for (const child of this.store.childIds(id)) {
            this.apply(child, { parentId: parent });
            moved.add(child); promoted.push(child); order.push(child);
          }
          this.map.delete(id);
        }
        this.rekey(order, moved);
      }
    });
    this.selection.set(promoted);
    return promoted;
  }

  /** Wrap the selection in a new frame: the frame takes the topmost shape's place. */
  frameSelection(): string | null {
    const top = this.topSelection().filter((id) => this.store.has(id));
    const bounds = this.selectionBounds(top);
    if (this.readOnly.get() || this.kind !== "design" || top.length === 0 || !bounds) return null;
    const shapes = top.map((id) => this.store.get(id)!);
    const parents = new Set(shapes.map((s) => s.parentId));
    const parentId = parents.size === 1 ? shapes[0]!.parentId : null;
    const siblings = this.store.childIds(parentId).map((id) => this.store.get(id)!);
    const highest = siblings.filter((s) => top.includes(s.id)).at(-1);
    const above = highest ? siblings[siblings.indexOf(highest) + 1] : undefined;
    let frameId = "";
    this.change(() => {
      frameId = this.create("frame", {
        ...bounds,
        parentId,
        fill: "none",
        z: highest ? safeKey(highest.z, above?.z ?? null) : undefined,
      });
      for (const s of shapes) this.apply(s.id, { parentId: frameId });
    });
    this.selection.set([frameId]);
    return frameId;
  }

  /**
   * Give `ordered` (a parent's full child list in its new order) keys that
   * sort that way, writing only the moved ids when their neighbours allow.
   */
  private rekey(ordered: string[], moved: Set<string>) {
    const zOf = (id: string) => this.store.get(id)?.z ?? "a0";
    const fixed = ordered.map((id) => (moved.has(id) ? null : zOf(id)));
    // Fixed keys must still ascend (ties from concurrent edits break this); if not, renumber all.
    const fixedKeys = fixed.filter((z): z is string => z !== null);
    const clean = fixedKeys.every((z, i) => isValidKey(z) && (i === 0 || fixedKeys[i - 1]! < z));
    if (!clean) {
      keysBetween(null, null, ordered.length).forEach((z, i) => this.apply(ordered[i]!, { z }));
      return;
    }
    let i = 0;
    let previous: string | null = null;
    while (i < ordered.length) {
      if (fixed[i] !== null) {
        previous = fixed[i]!;
        i++;
        continue;
      }
      let j = i;
      while (j < ordered.length && fixed[j] === null) j++;
      const next = j < ordered.length ? fixed[j]! : null;
      const keys = keysBetween(previous, next, j - i);
      for (let k = i; k < j; k++) this.apply(ordered[k]!, { z: keys[k - i]! });
      previous = keys[keys.length - 1]!;
      i = j;
    }
  }

  /** Bring forward / send backward one step, or all the way. */
  reorder(ids: readonly string[], where: "forward" | "backward" | "front" | "back") {
    if (this.readOnly.get()) return;
    const top = new Set(this.topSelection(ids));
    const parents = new Set([...top].map((id) => effectiveParent(this.store.all(), id)));
    this.change(() => {
      for (const parent of parents) {
        const siblings = [...this.store.childIds(parent)];
        const moving = siblings.filter((id) => top.has(id));
        if (moving.length === 0) continue;
        let order = siblings;
        if (where === "front") order = [...siblings.filter((id) => !top.has(id)), ...moving];
        else if (where === "back") order = [...moving, ...siblings.filter((id) => !top.has(id))];
        else {
          order = [...siblings];
          const step = where === "forward" ? 1 : -1;
          const indices = order.map((_, i) => i).filter((i) => top.has(order[i]!));
          if (step === 1) indices.reverse();
          for (const i of indices) {
            let j = i + step;
            while (j >= 0 && j < order.length && top.has(order[j]!)) j += step;
            if (j < 0 || j >= order.length) continue;
            const [id] = order.splice(i, 1);
            order.splice(j, 0, id!);
          }
        }
        this.rekey(order, new Set(moving));
      }
    });
  }

  /** Layers panel drop: put `ids` above or below `targetId`, or inside it when it's a frame. */
  moveInLayers(ids: readonly string[], targetId: string, where: LayerDrop) {
    const all = this.store.all();
    const target = this.store.get(targetId);
    if (this.readOnly.get() || !target) return;
    const moving = this.topSelection(ids).filter((id) => id !== targetId && !effectiveLocked(all, id));
    const inside = new Set(this.carried(moving).map((s) => s.id));
    if (inside.has(targetId) || moving.length === 0) return; // a frame can't go inside itself
    const parentId = where === "inside" && isContainer(target) ? targetId : effectiveParent(this.store.all(), targetId);
    if (parentId && effectiveLocked(all, parentId)) return;
    const siblings = this.store.childIds(parentId).filter((id) => !moving.includes(id));
    let at = siblings.length;
    if (where !== "inside") {
      const index = siblings.indexOf(targetId);
      at = where === "above" ? index + 1 : index;
    }
    const order = [...siblings.slice(0, at), ...moving, ...siblings.slice(at)];
    this.change(() => {
      for (const id of moving) this.apply(id, { parentId });
      this.rekey(order, new Set(moving));
    });
  }

  align(mode: AlignMode) {
    const top = this.topSelection().filter((id) => !effectiveLocked(this.store.all(), id));
    if (top.length < 2) return;
    const rects = top.map((id) => this.bounds(id)!);
    this.moveEach(top, rects, alignRects(rects, mode));
  }

  distribute(axis: "x" | "y") {
    const top = this.topSelection().filter((id) => !effectiveLocked(this.store.all(), id));
    if (top.length < 3) return;
    const rects = top.map((id) => this.bounds(id)!);
    this.moveEach(top, rects, distributeRects(rects, axis));
  }

  private moveEach(ids: string[], rects: Rect[], targets: Point[]) {
    const all = this.store.all();
    const index = childrenIndex(all);
    const moving = new Set(this.carried(ids).map((s) => s.id));
    this.change(() => {
      ids.forEach((id, i) => {
        const dx = targets[i]!.x - rects[i]!.x;
        const dy = targets[i]!.y - rects[i]!.y;
        if (!dx && !dy) return;
        for (const s of [all.get(id)!, ...descendantsOf(index, id)]) {
          if (s.type === "group") continue;
          const frozen = this.freezeIfLeaving(s, moving);
          this.apply(s.id, { ...frozen, x: (frozen.x ?? s.x) + dx, y: (frozen.y ?? s.y) + dy });
        }
      });
    });
  }

  // ------------------------------------------------------------- text editing

  startEditing(id: string) {
    const shape = this.store.get(id);
    if (this.readOnly.get() || !shape || !hasText(shape.type) || effectiveLocked(this.store.all(), id)) return;
    this.beginGesture();
    this.selection.set([id]);
    this.editingId.set(id);
  }

  setText(id: string, text: string) {
    this.write(() => this.apply(id, { text }));
  }

  /** Leave text editing; an empty text box is removed rather than left invisible. */
  stopEditing() {
    const id = this.editingId.get();
    if (!id) return;
    this.editingId.set(null);
    const shape = this.store.get(id);
    if (shape?.type === "text" && !shape.text.trim()) {
      this.write(() => this.map.delete(id));
      this.selection.set([]);
    }
    this.endGesture();
  }

  // ---------------------------------------------------------------- history

  undo() {
    this.stopEditing();
    this.undoManager.undo();
    this.prune();
  }

  redo() {
    this.stopEditing();
    this.undoManager.redo();
    this.prune();
  }

  // -------------------------------------------------------------- selection

  select(ids: readonly string[]) {
    this.selection.set(ids);
  }

  toggleSelected(id: string) {
    const current = this.selection.get();
    this.selection.set(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  selectAll() {
    this.selection.set(this.store.childIds(this.activeGroup.get()).filter((id) => {
      const s = this.store.get(id);
      return s && !effectiveHidden(this.store.all(), id) && !effectiveLocked(this.store.all(), id);
    }));
  }

  // ----------------------------------------------------------------- camera

  screenToWorld(p: Point): Point {
    const { x, y, zoom } = this.camera.get();
    return { x: (p.x - x) / zoom, y: (p.y - y) / zoom };
  }

  worldToScreen(p: Point): Point {
    const { x, y, zoom } = this.camera.get();
    return { x: p.x * zoom + x, y: p.y * zoom + y };
  }

  panBy(dx: number, dy: number) {
    const cam = this.camera.get();
    this.camera.set({ ...cam, x: cam.x + dx, y: cam.y + dy });
  }

  /** Zoom keeping the canvas point under `screen` where it is. */
  zoomAt(screen: Point, zoom: number) {
    const next = clampZoom(zoom);
    const world = this.screenToWorld(screen);
    this.camera.set({ zoom: next, x: screen.x - world.x * next, y: screen.y - world.y * next });
  }

  zoomBy(factor: number, around?: Point) {
    const { w, h } = this.viewport.get();
    this.zoomAt(around ?? { x: w / 2, y: h / 2 }, this.camera.get().zoom * factor);
  }

  /** Fit the given shapes (default: everything) in view, never past 200%. */
  zoomToFit(ids?: readonly string[]) {
    const { w, h } = this.viewport.get();
    const bounds = this.selectionBounds(ids ?? this.store.childIds(null));
    if (!bounds || w === 0 || h === 0) {
      this.camera.set({ x: w / 2, y: h / 2, zoom: 1 });
      return;
    }
    const pad = 64;
    const zoom = clampZoom(Math.min((w - pad * 2) / Math.max(bounds.w, 1), (h - pad * 2) / Math.max(bounds.h, 1), 2));
    this.camera.set({ zoom, x: w / 2 - (bounds.x + bounds.w / 2) * zoom, y: h / 2 - (bounds.y + bounds.h / 2) * zoom });
  }

  /** The canvas point at the middle of the view. */
  viewCenter(): Point {
    const { w, h } = this.viewport.get();
    return this.screenToWorld({ x: w / 2, y: h / 2 });
  }
}

/** keyBetween that tolerates tied or invalid neighbours (concurrent edits) by going above `a`. */
function safeKey(a: string | null, b: string | null): string {
  const lower = a && isValidKey(a) ? a : null;
  const upper = b && isValidKey(b) && (!lower || lower < b) ? b : null;
  return keyBetween(lower, upper);
}
