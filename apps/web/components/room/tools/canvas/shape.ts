import type * as Y from "yjs";

import type { AlignItems, Justify, LayoutDirection } from "./autolayout";

/**
 * One shape on a design canvas or whiteboard, as stored in the document:
 *
 *   shapes: Y.Map<shapeId, Y.Map{ type, x, y, w, h, fill, … }>
 *
 * Every property is its own key, so two people changing different
 * properties of one shape (one moves it, one recolours it) both win.
 * Coordinates are absolute canvas units, not relative to the parent frame:
 * moving a frame moves its children explicitly, but hit testing, snapping and
 * export never have to walk parents to find where something is.
 */
export type ShapeType = "frame" | "rect" | "ellipse" | "line" | "arrow" | "text" | "path" | "image" | "sticky" | "instance";
export type TextAlign = "left" | "center" | "right";
export type CanvasKind = "design" | "board";
export type Transition = "none" | "dissolve" | "slide-left" | "slide-right" | "slide-up" | "slide-down";

/** What an instance may change about a shape inside its component. */
export const OVERRIDABLE = ["text", "fill", "stroke", "opacity", "hidden"] as const;
export type OverrideKey = (typeof OVERRIDABLE)[number];
export type OverrideValue = string | number | boolean;
/** Per instance: overrides by the id of the shape inside the main component. */
export type Overrides = Record<string, Partial<Record<OverrideKey, OverrideValue>>>;

export type Shape = {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, around the centre. */
  rotation: number;
  /** A colour: a design token ("var(--p-2)"), a custom "#rrggbb" the user picked, or "none". */
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  /** 0–1. */
  opacity: number;
  text: string;
  fontSize: number;
  fontWeight: number;
  textAlign: TextAlign;
  /** Text wraps at `w`; otherwise the box grows to fit its longest line. */
  wrap: boolean;
  /**
   * Relative to (x, y). Paths: [x, y, pressure, …]. Lines and arrows: [x1, y1, x2, y2].
   * Resizing scales them, so (x, y, w, h) stays the bounding box.
   */
  points: number[];
  /** The frame this shape sits in (clipped by it and moved with it). */
  parentId: string | null;
  /** Fractional index among siblings (order.ts); higher draws on top. */
  z: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  /** Images: a data URL. */
  src: string;
  /** Whiteboard connectors: the shapes an arrow's ends are attached to. */
  startId: string | null;
  endId: string | null;
  /** Frames: a main component that instances can be made from. */
  component: boolean;
  /** Instances: the main component this one shows. */
  instanceOf: string | null;
  /** Instances: this instance's changes to shapes inside its component. */
  overrides: Overrides;
  /** Frames: auto layout of the children (none leaves them where they are). */
  layout: LayoutDirection;
  gap: number;
  padX: number;
  padY: number;
  justify: Justify;
  alignItems: AlignItems;
  /** Auto layout frames: shrink or grow to fit the children. */
  hug: boolean;
  /** Prototype: clicking this shape in Present goes to this frame. */
  link: string | null;
  transition: Transition;
  /** Frames: where Present starts. */
  flowStart: boolean;
};

export type ShapeProps = Omit<Shape, "id">;
/** Overrides are written one key at a time (setOverride), never as a patch. */
export type ShapePatch = Partial<Omit<ShapeProps, "overrides">>;

/** Points per vertex in `points`. */
export const pointStride = (type: ShapeType) => (type === "path" ? 3 : 2);
export const isLinear = (type: ShapeType) => type === "line" || type === "arrow";
export const hasText = (type: ShapeType) => type === "text" || type === "sticky";
export const isBox = (type: ShapeType) => type === "rect" || type === "frame" || type === "image" || type === "sticky";

export const TYPE_LABEL: Record<ShapeType, string> = {
  frame: "Frame",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  text: "Text",
  path: "Pen",
  image: "Image",
  sticky: "Sticky note",
  instance: "Instance",
};

const BASE: ShapeProps = {
  type: "rect",
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  fill: "var(--input)",
  stroke: "none",
  strokeWidth: 1,
  radius: 0,
  opacity: 1,
  text: "",
  fontSize: 16,
  fontWeight: 400,
  textAlign: "left",
  wrap: false,
  points: [],
  parentId: null,
  z: "a0",
  name: "",
  hidden: false,
  locked: false,
  src: "",
  startId: null,
  endId: null,
  component: false,
  instanceOf: null,
  overrides: {},
  layout: "none",
  gap: 8,
  padX: 16,
  padY: 16,
  justify: "start",
  alignItems: "start",
  hug: false,
  link: null,
  transition: "dissolve",
  flowStart: false,
};

/** What a new shape of a type starts with before the tool fills in position and size. */
export function defaultsFor(type: ShapeType, kind: CanvasKind): ShapeProps {
  const board = kind === "board";
  switch (type) {
    case "frame":
      return { ...BASE, type, fill: "var(--background)" };
    case "rect":
      return board ? { ...BASE, type, fill: "none", stroke: "var(--foreground)", strokeWidth: 2, radius: 8 } : { ...BASE, type };
    case "ellipse":
      return board ? { ...BASE, type, fill: "none", stroke: "var(--foreground)", strokeWidth: 2 } : { ...BASE, type };
    case "line":
    case "arrow":
      return { ...BASE, type, fill: "none", stroke: "var(--foreground)", strokeWidth: 2 };
    case "path":
      return { ...BASE, type, fill: "none", stroke: "var(--foreground)", strokeWidth: board ? 4 : 2 };
    case "text":
      return { ...BASE, type, fill: "var(--foreground)", fontSize: board ? 20 : 16, h: 21 };
    case "image":
      return { ...BASE, type, fill: "none" };
    case "sticky":
      return { ...BASE, type, w: 200, h: 200, fill: "var(--p-8-soft)", fontSize: 18, wrap: true };
    case "instance":
      return { ...BASE, type, fill: "none" };
  }
}

const SHAPE_TYPES = new Set<string>(["frame", "rect", "ellipse", "line", "arrow", "text", "path", "image", "sticky", "instance"]);
const ALIGNS = new Set<string>(["left", "center", "right"]);
const DIRECTIONS = new Set<string>(["none", "row", "column"]);
const JUSTIFIES = new Set<string>(["start", "center", "end", "between"]);
const ITEM_ALIGNS = new Set<string>(["start", "center", "end"]);
const TRANSITIONS = new Set<string>(["none", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down"]);

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const idOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
const oneOf = <T extends string>(set: Set<string>, value: unknown, fallback: T) => (typeof value === "string" && set.has(value) ? (value as T) : fallback);

const OVERRIDE_KEY = /^o\.([^.]+)\.(\w+)$/;
const OVERRIDE_PROPS = new Set<string>(OVERRIDABLE);

/** An override is stored as the key `o.<shape id>.<property>`, so two people overriding different things both win. */
export const overrideKey = (shapeId: string, prop: OverrideKey) => `o.${shapeId}.${prop}`;

function readOverrides(data: Record<string, unknown>): Overrides {
  const out: Overrides = {};
  for (const [key, value] of Object.entries(data)) {
    const match = OVERRIDE_KEY.exec(key);
    if (!match || !OVERRIDE_PROPS.has(match[2]!)) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    (out[match[1]!] ??= {})[match[2] as OverrideKey] = value;
  }
  return out;
}

/**
 * Read a shape from plain data (a Y.Map's JSON or a clipboard payload).
 * Anything missing or malformed falls back to the type's default, so a peer
 * on an older version can't break everyone's canvas.
 */
export function parseShape(id: string, data: Record<string, unknown>, kind: CanvasKind = "design"): Shape {
  const type = (SHAPE_TYPES.has(str(data.type, "")) ? data.type : "rect") as ShapeType;
  const d = defaultsFor(type, kind);
  // Keep the stored array itself when it's clean: renderers cache pen outlines by its identity.
  const isNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const points = Array.isArray(data.points) ? (data.points.every(isNumber) ? data.points : data.points.filter(isNumber)) : d.points;
  return {
    id,
    type,
    x: num(data.x, d.x),
    y: num(data.y, d.y),
    w: Math.max(0, num(data.w, d.w)),
    h: Math.max(0, num(data.h, d.h)),
    rotation: num(data.rotation, d.rotation),
    fill: str(data.fill, d.fill),
    stroke: str(data.stroke, d.stroke),
    strokeWidth: Math.max(0, num(data.strokeWidth, d.strokeWidth)),
    radius: Math.max(0, num(data.radius, d.radius)),
    opacity: Math.min(1, Math.max(0, num(data.opacity, d.opacity))),
    text: str(data.text, d.text),
    fontSize: Math.max(1, num(data.fontSize, d.fontSize)),
    fontWeight: num(data.fontWeight, d.fontWeight),
    textAlign: oneOf(ALIGNS, data.textAlign, d.textAlign),
    wrap: bool(data.wrap, d.wrap),
    points,
    parentId: idOrNull(data.parentId),
    z: str(data.z, d.z),
    name: str(data.name, d.name),
    hidden: bool(data.hidden, d.hidden),
    locked: bool(data.locked, d.locked),
    src: str(data.src, d.src),
    startId: idOrNull(data.startId),
    endId: idOrNull(data.endId),
    component: bool(data.component, d.component),
    instanceOf: idOrNull(data.instanceOf),
    overrides: readOverrides(data),
    layout: oneOf(DIRECTIONS, data.layout, d.layout),
    gap: Math.max(0, num(data.gap, d.gap)),
    padX: Math.max(0, num(data.padX, d.padX)),
    padY: Math.max(0, num(data.padY, d.padY)),
    justify: oneOf(JUSTIFIES, data.justify, d.justify),
    alignItems: oneOf(ITEM_ALIGNS, data.alignItems, d.alignItems),
    hug: bool(data.hug, d.hug),
    link: idOrNull(data.link),
    transition: oneOf(TRANSITIONS, data.transition, d.transition),
    flowStart: bool(data.flowStart, d.flowStart),
  };
}

export function readShape(id: string, map: Y.Map<unknown>, kind: CanvasKind = "design"): Shape {
  const data: Record<string, unknown> = {};
  map.forEach((value, key) => {
    data[key] = value;
  });
  return parseShape(id, data, kind);
}

/** The shape as plain data, without its id (for the clipboard). */
export function shapeData(shape: Shape): ShapeProps {
  const { id: _id, ...rest } = shape;
  return rest;
}

/** Properties only some shapes use: a new shape stores them only when they differ from the default. */
const OPTIONAL_KEYS = new Set<string>([
  "component",
  "instanceOf",
  "layout",
  "gap",
  "padX",
  "padY",
  "justify",
  "alignItems",
  "hug",
  "link",
  "transition",
  "flowStart",
  "startId",
  "endId",
  "locked",
  "hidden",
  "rotation",
]);

/**
 * Key/value pairs for a Y.Map entry: every property its own key, overrides
 * flattened to `o.<id>.<prop>`. A new shape leaves optional properties out
 * while they're at their defaults, which keeps documents small.
 */
export function shapeEntries(props: Partial<ShapeProps>, omitDefaults = false): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (omitDefaults && OPTIONAL_KEYS.has(key) && value === (BASE as Record<string, unknown>)[key]) continue;
    if (key === "overrides") {
      for (const [shapeId, changes] of Object.entries(value as Overrides)) {
        for (const [prop, v] of Object.entries(changes)) if (v !== undefined) entries.push([overrideKey(shapeId, prop as OverrideKey), v]);
      }
    } else entries.push([key, value]);
  }
  return entries;
}
