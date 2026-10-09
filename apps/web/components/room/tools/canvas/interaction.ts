"use client";

import { linearEnds } from "./draw";
import type { Editor, ToolId } from "./editor";
import {
  handlePoint,
  mapRect,
  normalizePoints,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  resizeBounds,
  scalePoints,
  snapAngle,
  type Handle,
  type Point,
  type Rect,
} from "./geometry";
import { isLinear, pointStride, type Shape, type ShapePatch, type ShapeType } from "./shape";
import { snapRect } from "./snap";

export type HandleId = Handle | "start" | "end";

/** What the pointer is over, read from the DOM by the canvas. */
export type Hit = { shapeId: string | null; frameBody: boolean; handle: HandleId | null };

export type PointerInfo = {
  screen: Point;
  world: Point;
  button: number;
  shift: boolean;
  alt: boolean;
  pressure: number;
  hit: Hit;
};

type State =
  | { kind: "idle" }
  | { kind: "pan"; last: Point }
  | { kind: "press"; start: PointerInfo; id: string; wasSelected: boolean }
  | { kind: "move"; start: Point; origins: Shape[]; ids: string[]; bounds: Rect; targets: Rect[] }
  | { kind: "resize"; handle: Handle; start: Point; bounds: Rect; origins: Shape[]; targets: Rect[] }
  | { kind: "endpoint"; which: "start" | "end"; id: string }
  | { kind: "marquee"; start: Point; base: readonly string[]; scope: string | null }
  | { kind: "create"; type: ShapeType; start: Point; id: string | null; parentId: string | null; targets: Rect[] }
  | { kind: "line"; type: "line" | "arrow"; start: Point; id: string | null; startId: string | null; parentId: string | null }
  | { kind: "pen"; points: number[]; parentId: string | null }
  | { kind: "erase"; last: Point; hits: Set<string> };

const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;
const CREATE_TOOLS = new Set<ToolId>(["frame", "rect", "ellipse", "text", "sticky"]);
/** How often the eraser looks under a moving pointer, in screen pixels, so fast strokes don't skip thin lines. */
const ERASER_STEP = 4;

/**
 * Pointer gestures on the canvas as a small state machine: pan, click and
 * drag to move, resize, marquee, draw shapes, lines and pen strokes. It works
 * in canvas coordinates and writes through the editor, one undo step per
 * gesture. Nothing here touches React.
 */
export class Interaction {
  private state: State = { kind: "idle" };
  private wrote = false;
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Shapes drawn at a screen point (the canvas looks them up in the page). The eraser needs it mid-drag, when events only name the canvas. */
  private probe: ((screen: Point) => string[]) | null = null;

  setProbe(probe: ((screen: Point) => string[]) | null) {
    this.probe = probe;
  }

  get busy() {
    return this.state.kind !== "idle";
  }

  private snap(): boolean {
    return this.editor.kind === "design";
  }

  private threshold() {
    return SNAP_PX / this.editor.camera.get().zoom;
  }

  /** Rects of everything visible except `exclude`, as snap targets. Off-screen shapes can't be seen to align with. */
  private targets(exclude: Set<string>): Rect[] {
    const { w, h } = this.editor.viewport.get();
    const tl = this.editor.screenToWorld({ x: 0, y: 0 });
    const br = this.editor.screenToWorld({ x: w, y: h });
    const view = rectFromPoints(tl, br);
    const out: Rect[] = [];
    for (const shape of this.editor.store.all().values()) {
      if (exclude.has(shape.id) || shape.hidden || shape.type === "path") continue;
      const r = this.editor.bounds(shape.id);
      if (r && rectsIntersect(r, view)) out.push(r);
    }
    return out;
  }

  private write(fn: () => void) {
    this.wrote = true;
    this.editor.write(fn);
  }

  private round(n: number) {
    return this.editor.kind === "design" ? Math.round(n) : n;
  }

  down(info: PointerInfo, panning: boolean) {
    const editor = this.editor;
    const tool = editor.tool.get();
    this.wrote = false;
    if (panning || info.button === 1 || tool === "hand") {
      this.state = { kind: "pan", last: info.screen };
      return;
    }
    if (info.button !== 0) return;
    if (editor.editingId.get()) editor.stopEditing();
    const readOnly = editor.readOnly.get();
    const { hit } = info;

    if (readOnly || tool === "select") {
      if (!readOnly && hit.handle) return this.startHandle(hit.handle, info);
      const shape = hit.shapeId ? editor.get(hit.shapeId) : undefined;
      // A top-level frame's empty area starts a marquee unless the frame is already selected.
      const selected = editor.selection.get();
      const bodyOfTopFrame = shape?.type === "frame" && hit.frameBody && !shape.parentId && !selected.includes(shape.id);
      if (shape && !bodyOfTopFrame) {
        const wasSelected = selected.includes(shape.id);
        if (info.shift) editor.toggleSelected(shape.id);
        else if (!wasSelected) editor.select([shape.id]);
        if (!readOnly && editor.selection.get().includes(shape.id)) this.state = { kind: "press", start: info, id: shape.id, wasSelected };
        return;
      }
      if (readOnly) {
        editor.select([]);
        this.state = { kind: "pan", last: info.screen };
        return;
      }
      const base = info.shift ? selected : [];
      if (!info.shift) editor.select([]);
      this.state = { kind: "marquee", start: info.world, base, scope: editor.kind === "design" ? editor.frameAt(info.world) : null };
      return;
    }

    editor.beginGesture();
    const parentId = editor.kind === "design" ? editor.frameAt(info.world) : null;
    if (CREATE_TOOLS.has(tool)) {
      const type = tool as ShapeType;
      const start = this.snapPoint(info.world, new Set());
      this.state = { kind: "create", type, start, id: null, parentId: type === "frame" && !parentId ? null : parentId, targets: this.targets(new Set()) };
    } else if (tool === "line" || tool === "arrow") {
      const startId = editor.kind === "board" ? editor.attachableAt(info.world) : null;
      this.state = { kind: "line", type: tool, start: this.snapPoint(info.world, new Set()), id: null, startId, parentId };
    } else if (tool === "pen") {
      this.state = { kind: "pen", points: [info.world.x, info.world.y, info.pressure], parentId };
      this.showDraft();
    } else if (tool === "eraser") {
      this.state = { kind: "erase", last: info.screen, hits: new Set() };
      this.eraseAlong(info.screen, info.screen);
    }
  }

  private snapPoint(p: Point, exclude: Set<string>): Point {
    if (!this.snap()) return p;
    const { dx, dy } = snapRect({ x: p.x, y: p.y, w: 0, h: 0 }, this.targets(exclude), this.threshold(), { x: [0], y: [0] });
    return { x: this.round(p.x + dx), y: this.round(p.y + dy) };
  }

  private showDraft() {
    if (this.state.kind !== "pen") return;
    const { ink, width } = this.editor.style.get();
    const board = this.editor.kind === "board";
    this.editor.draft.set({ points: this.state.points, stroke: board ? ink : "var(--foreground)", strokeWidth: board ? width : 2 });
  }

  private startHandle(handle: HandleId, info: PointerInfo) {
    const editor = this.editor;
    const ids = editor.topSelection().filter((id) => !editor.get(id)?.locked);
    if (ids.length === 0) return;
    editor.beginGesture();
    if (handle === "start" || handle === "end") {
      this.state = { kind: "endpoint", which: handle, id: ids[0]! };
      return;
    }
    const bounds = editor.selectionBounds(ids);
    if (!bounds) return;
    // Resizing one frame leaves its contents where they are; resizing a group scales everything in it.
    const single = ids.length === 1 && editor.get(ids[0]!)?.type === "frame";
    const origins = single ? [editor.get(ids[0]!)!] : editor.carried(ids);
    // Attached connectors are drawn from their shapes; freeze any whose shapes stay put.
    const moving = new Set(origins.map((s) => s.id));
    const frozen = origins.map((s) => {
      const patch = editor.freezeIfLeaving(s, moving);
      if (Object.keys(patch).length) this.write(() => editor.apply(s.id, patch));
      return editor.get(s.id) ?? s;
    });
    this.state = { kind: "resize", handle, start: info.world, bounds, origins: frozen, targets: this.targets(moving) };
  }

  move(info: PointerInfo) {
    const editor = this.editor;
    const state = this.state;
    switch (state.kind) {
      case "pan":
        editor.panBy(info.screen.x - state.last.x, info.screen.y - state.last.y);
        state.last = info.screen;
        return;
      case "erase":
        this.eraseAlong(state.last, info.screen);
        state.last = info.screen;
        return;
      case "press": {
        const d = Math.hypot(info.screen.x - state.start.screen.x, info.screen.y - state.start.screen.y);
        if (d < DRAG_THRESHOLD) return;
        this.startMove(state.start.world);
        this.move(info);
        return;
      }
      case "move": {
        let dx = info.world.x - state.start.x;
        let dy = info.world.y - state.start.y;
        if (info.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (this.snap() && !info.alt) {
          const moved = { ...state.bounds, x: state.bounds.x + dx, y: state.bounds.y + dy };
          const snapped = snapRect(moved, state.targets, this.threshold());
          dx += snapped.dx;
          dy += snapped.dy;
          editor.guides.set(snapped.guides);
        }
        dx = this.round(dx);
        dy = this.round(dy);
        this.write(() => {
          for (const o of state.origins) editor.apply(o.id, { x: o.x + dx, y: o.y + dy });
        });
        return;
      }
      case "resize":
        this.resize(state, info);
        return;
      case "endpoint":
        this.dragEndpoint(state, info);
        return;
      case "marquee": {
        const rect = rectFromPoints(state.start, info.world);
        editor.marquee.set(rect);
        editor.select([...new Set([...state.base, ...this.inMarquee(rect, state.scope)])]);
        return;
      }
      case "create":
        this.dragCreate(state, info);
        return;
      case "line":
        this.dragLine(state, info);
        return;
      case "pen": {
        const last = state.points.length;
        const px = state.points[last - 3]!;
        const py = state.points[last - 2]!;
        // Skip sub-pixel jitter: it only makes the stroke heavier.
        if (Math.hypot(info.world.x - px, info.world.y - py) * editor.camera.get().zoom < 1.5) return;
        state.points = [...state.points, info.world.x, info.world.y, info.pressure];
        this.showDraft();
        return;
      }
      default:
        return;
    }
  }

  private startMove(start: Point) {
    const editor = this.editor;
    const ids = editor.topSelection().filter((id) => !editor.get(id)?.locked);
    const bounds = editor.selectionBounds(ids);
    if (ids.length === 0 || !bounds) {
      this.state = { kind: "idle" };
      return;
    }
    editor.beginGesture();
    const carried = editor.carried(ids);
    const moving = new Set(carried.map((s) => s.id));
    const origins = carried.map((s) => {
      const patch = editor.freezeIfLeaving(s, moving);
      if (Object.keys(patch).length) this.write(() => editor.apply(s.id, patch));
      return editor.get(s.id) ?? s;
    });
    this.state = { kind: "move", start, origins, ids, bounds, targets: this.snap() ? this.targets(moving) : [] };
  }

  private resize(state: Extract<State, { kind: "resize" }>, info: PointerInfo) {
    const editor = this.editor;
    let dx = info.world.x - state.start.x;
    let dy = info.world.y - state.start.y;
    const { handle, bounds } = state;
    if (this.snap() && !info.alt) {
      const p = handlePoint(bounds, handle);
      const lines = { x: handle.includes("e") || handle.includes("w") ? [0] : [], y: handle.includes("n") || handle.includes("s") ? [0] : [] };
      const snapped = snapRect({ x: p.x + dx, y: p.y + dy, w: 0, h: 0 }, state.targets, this.threshold(), lines);
      dx += snapped.dx;
      dy += snapped.dy;
      editor.guides.set(snapped.guides);
    }
    const single = state.origins.length === 1 ? state.origins[0]! : null;
    const keepRatio = info.shift || single?.type === "image";
    const raw = resizeBounds(bounds, handle, dx, dy, keepRatio);
    const next = { x: this.round(raw.x), y: this.round(raw.y), w: Math.max(1, this.round(raw.w)), h: Math.max(1, this.round(raw.h)) };
    this.write(() => {
      for (const o of state.origins) {
        const r = mapRect(o, bounds, next);
        const patch: ShapePatch = { x: r.x, y: r.y, w: r.w, h: r.h };
        if (isLinear(o.type) || o.type === "path") {
          const sx = o.w === 0 ? 1 : r.w / o.w;
          const sy = o.h === 0 ? 1 : r.h / o.h;
          patch.points = scalePoints(o.points, pointStride(o.type), sx, sy);
        }
        // Resizing a text box sets its wrapping width; its height follows the text.
        if (o.type === "text") {
          patch.wrap = true;
          delete patch.h;
        }
        editor.apply(o.id, patch);
      }
    });
  }

  private dragEndpoint(state: Extract<State, { kind: "endpoint" }>, info: PointerInfo) {
    const editor = this.editor;
    const shape = editor.get(state.id);
    if (!shape || !isLinear(shape.type)) return;
    const [a, b] = linearEnds(shape, editor.store.get);
    const attachTo = editor.kind === "board" ? editor.attachableAt(info.world, new Set([shape.id])) : null;
    editor.target.set(attachTo);
    const fixed = state.which === "start" ? b : a;
    let moved = this.snapPoint(info.world, new Set([shape.id]));
    if (info.shift) moved = snapAngle(fixed, moved);
    const [p1, p2] = state.which === "start" ? [moved, fixed] : [fixed, moved];
    const { rect, points } = normalizePoints([p1.x, p1.y, p2.x, p2.y], 2);
    const bind: ShapePatch = state.which === "start" ? { startId: attachTo } : { endId: attachTo };
    this.write(() => editor.apply(shape.id, { ...rect, points, ...bind }));
  }

  private inMarquee(rect: Rect, scope: string | null): string[] {
    const editor = this.editor;
    const out: string[] = [];
    for (const id of editor.store.childIds(scope)) {
      const shape = editor.get(id);
      const bounds = editor.bounds(id);
      if (!shape || !bounds || shape.hidden || shape.locked) continue;
      const hit = shape.type === "frame" && !scope ? rectContains(rect, bounds) || rectsIntersect(rect, bounds) : rectsIntersect(rect, bounds);
      if (hit) out.push(id);
    }
    return out;
  }

  private dragCreate(state: Extract<State, { kind: "create" }>, info: PointerInfo) {
    const editor = this.editor;
    const zoom = editor.camera.get().zoom;
    const far = Math.hypot(info.world.x - state.start.x, info.world.y - state.start.y) * zoom >= DRAG_THRESHOLD;
    if (!state.id && !far) return;
    let end = info.world;
    if (this.snap() && !info.alt) {
      const snapped = snapRect({ x: end.x, y: end.y, w: 0, h: 0 }, state.targets, this.threshold(), { x: [0], y: [0] });
      end = { x: end.x + snapped.dx, y: end.y + snapped.dy };
      editor.guides.set(snapped.guides);
    }
    if (info.shift) {
      const side = Math.max(Math.abs(end.x - state.start.x), Math.abs(end.y - state.start.y));
      end = { x: state.start.x + side * Math.sign(end.x - state.start.x || 1), y: state.start.y + side * Math.sign(end.y - state.start.y || 1) };
    }
    const raw = rectFromPoints(state.start, end);
    const rect = { x: this.round(raw.x), y: this.round(raw.y), w: Math.max(1, this.round(raw.w)), h: Math.max(1, this.round(raw.h)) };
    const extra: ShapePatch = state.type === "text" ? { wrap: true } : state.type === "sticky" ? { fill: editor.style.get().note } : {};
    this.write(() => {
      if (!state.id) state.id = editor.create(state.type, { ...rect, ...extra, ...this.boardInk(state.type), parentId: state.parentId });
      else editor.apply(state.id, rect);
    });
  }

  /** Whiteboard shapes start in the chosen ink colour. */
  private boardInk(type: ShapeType): ShapePatch {
    if (this.editor.kind !== "board") return {};
    const { ink } = this.editor.style.get();
    if (type === "rect" || type === "ellipse" || type === "line" || type === "arrow" || type === "path") return { stroke: ink };
    if (type === "text") return { fill: ink };
    return {};
  }

  private dragLine(state: Extract<State, { kind: "line" }>, info: PointerInfo) {
    const editor = this.editor;
    const zoom = editor.camera.get().zoom;
    if (!state.id && Math.hypot(info.world.x - state.start.x, info.world.y - state.start.y) * zoom < DRAG_THRESHOLD) return;
    const exclude = new Set(state.id ? [state.id] : []);
    const endId = editor.kind === "board" ? editor.attachableAt(info.world, exclude) : null;
    editor.target.set(endId && endId !== state.startId ? endId : null);
    let end = this.snapPoint(info.world, exclude);
    if (info.shift) end = snapAngle(state.start, end);
    const { rect, points } = normalizePoints([state.start.x, state.start.y, end.x, end.y], 2);
    const binding: ShapePatch = { startId: state.startId, endId: endId && endId !== state.startId ? endId : null };
    this.write(() => {
      if (!state.id) state.id = editor.create(state.type, { ...rect, points, ...binding, ...this.boardInk(state.type), parentId: state.parentId });
      else editor.apply(state.id, { ...rect, points, ...binding });
    });
  }

  up(info: PointerInfo) {
    const editor = this.editor;
    const state = this.state;
    this.state = { kind: "idle" };
    editor.guides.set([]);
    editor.target.set(null);
    switch (state.kind) {
      case "press":
        // Clicking one of several selected shapes (without dragging) selects just it.
        if (!info.shift && state.wasSelected && editor.selection.get().length > 1) editor.select([state.id]);
        return;
      case "move":
        this.write(() => editor.reparent(state.ids));
        editor.endGesture();
        return;
      case "resize":
      case "endpoint":
        editor.endGesture();
        return;
      case "marquee":
        editor.marquee.set(null);
        return;
      case "create":
        this.finishCreate(state);
        return;
      case "line": {
        editor.endGesture();
        if (state.id) {
          editor.select([state.id]);
          editor.tool.set("select");
        }
        return;
      }
      case "pen":
        this.finishPen(state);
        return;
      case "erase":
        // Everything touched goes in one change, so one undo brings it all back.
        editor.erasing.set(new Set());
        editor.deleteShapes([...state.hits]);
        editor.endGesture();
        return;
      default:
        return;
    }
  }

  private finishCreate(state: Extract<State, { kind: "create" }>) {
    const editor = this.editor;
    let id = state.id;
    if (!id) {
      // A click without a drag: a default-sized shape at the pointer (notes centre on it).
      const size = state.type === "sticky" ? 200 : 100;
      const at = state.type === "sticky" ? { x: state.start.x - size / 2, y: state.start.y - size / 2 } : state.start;
      const props: ShapePatch =
        state.type === "text" ? { x: at.x, y: at.y } : { x: this.round(at.x), y: this.round(at.y), w: size, h: size };
      const extra: ShapePatch = state.type === "sticky" ? { fill: editor.style.get().note } : {};
      this.write(() => {
        id = editor.create(state.type, { ...props, ...extra, ...this.boardInk(state.type), parentId: state.parentId });
      });
    }
    if (!id) return;
    editor.tool.set("select");
    if (state.type === "text" || state.type === "sticky") {
      // The gesture continues into typing, so creating and typing undo together.
      editor.selection.set([id]);
      editor.editingId.set(id);
      return;
    }
    editor.endGesture();
    editor.select([id]);
  }

  /** Marks what the eraser passes over between two pointer positions. Frames hold other shapes and locked shapes stay put, so it leaves both. */
  private eraseAlong(from: Point, to: Point) {
    if (this.state.kind !== "erase" || !this.probe) return;
    const { hits } = this.state;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / ERASER_STEP));
    let changed = false;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const id of this.probe({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })) {
        if (hits.has(id)) continue;
        const shape = this.editor.get(id);
        if (!shape || shape.type === "frame" || this.lockedAt(id)) continue;
        hits.add(id);
        changed = true;
      }
    }
    if (changed) this.editor.erasing.set(new Set(hits));
  }

  private lockedAt(id: string): boolean {
    for (let shape = this.editor.get(id); shape; shape = shape.parentId ? this.editor.get(shape.parentId) : undefined) {
      if (shape.locked) return true;
    }
    return false;
  }

  private finishPen(state: Extract<State, { kind: "pen" }>) {
    const editor = this.editor;
    editor.draft.set(null);
    const points = state.points.length === 3 ? [...state.points, state.points[0]! + 0.1, state.points[1]! + 0.1, state.points[2]!] : state.points;
    const { rect, points: relative } = normalizePoints(points, 3);
    const { ink, width } = editor.style.get();
    const board = editor.kind === "board";
    this.write(() => {
      editor.create("path", { ...rect, points: relative, stroke: board ? ink : "var(--foreground)", ...(board && { strokeWidth: width }), parentId: state.parentId });
    });
    editor.endGesture();
  }

  /** Escape or a lost pointer mid-gesture: undo what the gesture wrote. */
  cancel() {
    const editor = this.editor;
    const state = this.state;
    this.state = { kind: "idle" };
    editor.guides.set([]);
    editor.marquee.set(null);
    editor.draft.set(null);
    editor.target.set(null);
    editor.erasing.set(new Set());
    if (state.kind === "marquee") editor.select(state.base);
    if (["move", "resize", "endpoint", "create", "line", "erase"].includes(state.kind)) {
      editor.endGesture();
      if (this.wrote) editor.undo();
    }
  }
}
