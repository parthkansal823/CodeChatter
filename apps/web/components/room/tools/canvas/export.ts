import { freehandPath, fontOf, linearPaths, rotationTransform, shapeBounds, STICKY_TEXT, textFrame, type Lookup } from "./draw";
import { round, unionRects, type Rect } from "./geometry";
import { TYPE_LABEL, type Shape } from "./shape";
import { alignX, layoutText, lineHeight, type Measure } from "./text-layout";
import { childrenIndex, descendantsOf } from "./tree";

/**
 * Export and handoff: SVG, CSS and HTML as strings. Pure, so it runs in unit
 * tests; the browser side (export-actions.ts) supplies colour resolution
 * (tokens → "#rrggbb" in the current theme) and text measuring.
 */
export type ExportContext = {
  shapes: ReadonlyMap<string, Shape>;
  /** A stored colour (token or custom) → a concrete CSS colour. */
  resolve: (color: string) => string;
  measure: Measure;
  fonts: { sans: string; note: string };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => String(round(v));
const paint = (ctx: ExportContext, color: string) => (!color || color === "none" ? "none" : esc(ctx.resolve(color)));

function lookupIn(ctx: ExportContext): Lookup {
  return (id) => ctx.shapes.get(id);
}

function textSvg(shape: Shape, ctx: ExportContext): string {
  if (!shape.text) return "";
  const font = fontOf(shape);
  const frame = textFrame(shape);
  const layout = layoutText(shape.text, frame.width, font, ctx.measure);
  const boxWidth = frame.width ?? layout.width;
  const { x, anchor } = alignX(shape.textAlign, frame.x, boxWidth);
  const lh = lineHeight(font.size);
  const family = font.family === "note" ? ctx.fonts.note : ctx.fonts.sans;
  const color = shape.type === "sticky" ? STICKY_TEXT : shape.fill;
  const spans = layout.lines
    .map((line, i) => `<tspan x="${n(x)}" y="${n(frame.y + i * lh + lh / 2)}">${esc(line) || " "}</tspan>`)
    .join("");
  return `<text font-family="${esc(family)}" font-size="${n(font.size)}" font-weight="${font.weight}" fill="${paint(ctx, color)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve">${spans}</text>`;
}

function strokeAttrs(shape: Shape, ctx: ExportContext): string {
  if (shape.stroke === "none" || shape.strokeWidth <= 0) return "";
  return ` stroke="${paint(ctx, shape.stroke)}" stroke-width="${n(shape.strokeWidth)}"`;
}

function shapeSvg(shape: Shape, ctx: ExportContext, index: Map<string | null, Shape[]>, defs: string[]): string {
  if (shape.hidden) return "";
  const { x, y, w, h } = shape;
  const radius = shape.radius ? ` rx="${n(Math.min(shape.radius, w / 2, h / 2))}"` : "";
  let body: string;
  switch (shape.type) {
    case "frame": {
      const clipId = `clip-${defs.length}`;
      defs.push(`<clipPath id="${clipId}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${radius}/></clipPath>`);
      const children = (index.get(shape.id) ?? []).map((child) => shapeSvg(child, ctx, index, defs)).join("");
      body =
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${radius} fill="${paint(ctx, shape.fill)}"${strokeAttrs(shape, ctx)}/>` +
        (children ? `<g clip-path="url(#${clipId})">${children}</g>` : "");
      break;
    }
    case "rect":
    case "sticky":
      body = `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${radius} fill="${paint(ctx, shape.fill)}"${strokeAttrs(shape, ctx)}/>` + textSvg(shape, ctx);
      break;
    case "ellipse":
      body = `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${paint(ctx, shape.fill)}"${strokeAttrs(shape, ctx)}/>`;
      break;
    case "line":
    case "arrow": {
      const { line, head } = linearPaths(shape, lookupIn(ctx));
      const color = paint(ctx, shape.stroke);
      body =
        `<path d="${line}" fill="none" stroke="${color}" stroke-width="${n(shape.strokeWidth)}" stroke-linecap="round"/>` +
        (head ? `<path d="${head}" fill="${color}" stroke="${color}" stroke-width="${n(shape.strokeWidth)}" stroke-linejoin="round"/>` : "");
      break;
    }
    case "path":
      body = `<path transform="translate(${n(x)} ${n(y)})" d="${freehandPath(shape.points, shape.strokeWidth)}" fill="${paint(ctx, shape.stroke)}"/>`;
      break;
    case "text":
      body = textSvg(shape, ctx);
      break;
    case "image":
      body = shape.src
        ? `<image href="${esc(shape.src)}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`
        : "";
      break;
    case "instance":
      // The export context holds expanded shapes (expandInstances), so instances arrive as frames.
      body = "";
      break;
  }
  const attrs = [
    shape.opacity < 1 ? ` opacity="${n(shape.opacity)}"` : "",
    rotationTransform(shape) ? ` transform="${rotationTransform(shape)}"` : "",
  ].join("");
  return attrs ? `<g${attrs}>${body}</g>` : body;
}

/**
 * An SVG document of the given shapes (and everything inside frames among
 * them), cropped to their bounds plus padding.
 */
export function exportSvg(ids: string[], ctx: ExportContext, padding = 0): { svg: string; width: number; height: number } | null {
  const index = childrenIndex(ctx.shapes);
  const lookup = lookupIn(ctx);
  const roots = ids.map((id) => ctx.shapes.get(id)).filter((s): s is Shape => Boolean(s) && !s!.hidden);
  const bounds = unionRects(roots.map((s) => shapeBounds(s, lookup)));
  if (!bounds) return null;
  // Pen strokes and thick lines reach past their points; leave room for them.
  const bleed = Math.max(0, ...roots.flatMap((s) => [s, ...descendantsOf(index, s.id)]).map((s) => (s.type === "frame" ? 0 : s.strokeWidth * 2)));
  const pad = padding + (roots.every((s) => s.type === "frame") ? 0 : bleed);
  const view: Rect = { x: bounds.x - pad, y: bounds.y - pad, w: Math.max(1, bounds.w + pad * 2), h: Math.max(1, bounds.h + pad * 2) };
  // Keep the canvas's stacking order, not the order things were selected in.
  const order = new Map<string, number>();
  let i = 0;
  const walk = (parent: string | null) => {
    for (const child of index.get(parent) ?? []) {
      order.set(child.id, i++);
      walk(child.id);
    }
  };
  walk(null);
  roots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const defs: string[] = [];
  const body = roots.map((shape) => shapeSvg(shape, ctx, index, defs)).join("");
  const width = Math.ceil(view.w);
  const height = Math.ceil(view.h);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body +
    `</svg>`;
  return { svg, width, height };
}

/** A declaration's value, with the design token it came from as a comment. */
function colorDecl(ctx: ExportContext, prop: string, color: string, suffix = ""): string {
  const token = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
  return `${prop}: ${suffix}${ctx.resolve(color)};${token ? ` /* ${token} */` : ""}`;
}

function styleDecls(shape: Shape, ctx: ExportContext): string[] {
  const decls: string[] = [];
  const hasFill = shape.fill !== "none" && shape.fill !== "";
  const hasStroke = shape.stroke !== "none" && shape.strokeWidth > 0;
  switch (shape.type) {
    case "text":
      if (hasFill) decls.push(colorDecl(ctx, "color", shape.fill));
      decls.push(
        `font-family: ${ctx.fonts.sans};`,
        `font-size: ${n(shape.fontSize)}px;`,
        `font-weight: ${shape.fontWeight};`,
        `line-height: ${lineHeight(shape.fontSize)}px;`,
        `text-align: ${shape.textAlign};`,
        `white-space: pre-wrap;`,
      );
      break;
    case "line":
    case "arrow": {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = shape.points;
      decls.push(`width: ${n(Math.hypot(x2 - x1, y2 - y1))}px;`, `height: 0;`);
      if (hasStroke) decls.push(colorDecl(ctx, "border-top", shape.stroke, `${n(shape.strokeWidth)}px solid `));
      const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      if (round(angle) !== 0) decls.push(`transform: rotate(${n(angle)}deg);`, `transform-origin: 0 0;`);
      return decls;
    }
    case "sticky":
      if (hasFill) decls.push(colorDecl(ctx, "background", shape.fill));
      decls.push(colorDecl(ctx, "color", STICKY_TEXT), `font-family: ${ctx.fonts.note};`, `font-size: ${n(shape.fontSize)}px;`, `padding: 16px;`, `box-sizing: border-box;`);
      break;
    default:
      if (hasFill && shape.type !== "path" && shape.type !== "image") decls.push(colorDecl(ctx, "background", shape.fill));
  }
  if (hasStroke && shape.type !== "path" && shape.type !== "text") decls.push(colorDecl(ctx, "border", shape.stroke, `${n(shape.strokeWidth)}px solid `));
  if (shape.type === "ellipse") decls.push(`border-radius: 50%;`);
  else if (shape.radius > 0) decls.push(`border-radius: ${n(shape.radius)}px;`);
  if (shape.opacity < 1) decls.push(`opacity: ${n(shape.opacity)};`);
  if (shape.rotation) decls.push(`transform: rotate(${n(shape.rotation)}deg);`);
  return decls;
}

/** "Copy CSS" for one shape: its size and look, the way design tools hand them off. */
export function shapeCss(shape: Shape, ctx: ExportContext): string {
  const size = shape.type === "line" || shape.type === "arrow" ? [] : [`width: ${n(shape.w)}px;`, `height: ${n(shape.h)}px;`];
  const label = shape.name || TYPE_LABEL[shape.type];
  return [`/* ${label.replace(/\*\//g, "")} */`, ...size, ...styleDecls(shape, ctx)].join("\n");
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(s) ? s : `el-${s || "shape"}`;
}

/**
 * "Copy as HTML/CSS" for a frame: one absolutely positioned element per
 * shape inside a relatively positioned box, with a <style> block. Pen
 * strokes and lines become inline SVG; that's the honest way to hand them off.
 */
export function frameHtml(frameId: string, ctx: ExportContext): string | null {
  const frame = ctx.shapes.get(frameId);
  if (!frame || frame.type !== "frame") return null;
  const index = childrenIndex(ctx.shapes);
  const used = new Map<string, number>();
  const className = (shape: Shape) => {
    const base = slug(shape.name || TYPE_LABEL[shape.type]);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
  const rules: string[] = [];
  const rule = (cls: string, decls: string[]) => rules.push(`.${cls} {\n${decls.map((d) => `  ${d}`).join("\n")}\n}`);

  const element = (shape: Shape, parent: Shape | null, depth: number): string => {
    if (shape.hidden) return "";
    const cls = className(shape);
    const indent = "  ".repeat(depth);
    const position = parent
      ? [`position: absolute;`, `left: ${n(shape.x - parent.x)}px;`, `top: ${n(shape.y - parent.y)}px;`]
      : [`position: relative;`];
    const size = [`width: ${n(shape.w)}px;`, `height: ${n(shape.h)}px;`];
    switch (shape.type) {
      case "frame": {
        rule(cls, [...position, ...size, ...styleDecls(shape, ctx), `overflow: hidden;`]);
        const children = (index.get(shape.id) ?? []).map((child) => element(child, shape, depth + 1)).filter(Boolean);
        return `${indent}<div class="${cls}">${children.length ? `\n${children.join("\n")}\n${indent}` : ""}</div>`;
      }
      case "text":
        rule(cls, [...position, ...(shape.wrap ? [`width: ${n(shape.w)}px;`] : [`white-space: pre;`]), `margin: 0;`, ...styleDecls(shape, ctx)]);
        return `${indent}<p class="${cls}">${esc(shape.text)}</p>`;
      case "sticky":
        rule(cls, [...position, ...size, ...styleDecls(shape, ctx), `margin: 0;`, `white-space: pre-wrap;`]);
        return `${indent}<p class="${cls}">${esc(shape.text)}</p>`;
      case "image":
        rule(cls, [...position, ...size, ...styleDecls(shape, ctx), `object-fit: fill;`]);
        return `${indent}<img class="${cls}" src="${esc(shape.src)}" alt="${esc(shape.name)}" />`;
      case "line":
      case "arrow":
      case "path": {
        const svg = exportSvg([shape.id], ctx);
        if (!svg) return "";
        const bounds = shapeBounds(shape, lookupIn(ctx));
        const bleed = (svg.width - bounds.w) / 2;
        rule(cls, [
          `position: absolute;`,
          `left: ${n(bounds.x - bleed - (parent?.x ?? 0))}px;`,
          `top: ${n(bounds.y - bleed - (parent?.y ?? 0))}px;`,
          `overflow: visible;`,
        ]);
        return `${indent}${svg.svg.replace("<svg ", `<svg class="${cls}" `)}`;
      }
      default:
        rule(cls, [...position, ...size, ...styleDecls(shape, ctx)]);
        return `${indent}<div class="${cls}"></div>`;
    }
  };

  const markup = element(frame, null, 0);
  return `<style>\n${rules.join("\n")}\n</style>\n${markup}\n`;
}
