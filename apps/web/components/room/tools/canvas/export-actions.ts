"use client";

import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import { resolveColor } from "@/lib/css-color";

import { expandInstances } from "./components";
import type { Editor } from "./editor";
import { exportSvg, frameHtml, shapeCss, type ExportContext } from "./export";
import { fontStacks, measureText } from "./measure";
import { imagesToPdf, type PdfPage } from "./pdf";

/** Export context for the current theme: tokens resolve to the colours on screen right now. */
export function exportContext(editor: Editor): ExportContext {
  const cache = new Map<string, string>();
  return {
    // Instances become plain frames with their component's content, so export never meets one.
    shapes: expandInstances(editor.store.all()),
    resolve: (color) => {
      if (!color || color === "none") return "none";
      let resolved = cache.get(color);
      if (resolved === undefined) {
        resolved = resolveColor(color);
        cache.set(color, resolved);
      }
      return resolved;
    },
    measure: measureText,
    fonts: fontStacks(),
  };
}

export function fileName(...parts: string[]): string {
  const base = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "export";
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What to export: the selection, or everything when nothing is selected. */
export function exportIds(editor: Editor): string[] {
  const selected = editor.topSelection();
  return selected.length ? selected : editor.store.childIds(null);
}

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf";
export type ExportScope = "selection" | "all" | "frames";
export type PaperSize = "fit" | "a4" | "letter";

/** Everything the export dialog asks, like draw.io does before it exports. */
export type ExportOptions = {
  name: string;
  format: ExportFormat;
  /** The selection, everything, or (PDF of a design) one page per top-level frame. */
  scope: ExportScope;
  /** Pixels per canvas unit for PNG and JPEG, and for the pictures in a PDF. */
  scale: number;
  /** Space around the drawing, in canvas units. */
  border: number;
  background: "transparent" | "canvas" | "white";
  grid: boolean;
  /** PDF only: a page the size of the drawing, or a sheet of paper. */
  paper: PaperSize;
  landscape: boolean;
};

/** Top-level frames of a design: a PDF can give each its own page. */
export function topFrames(editor: Editor): string[] {
  if (editor.kind !== "design") return [];
  return editor.store.childIds(null).filter((id) => editor.get(id)?.type === "frame" && !editor.get(id)?.hidden);
}

function targets(editor: Editor, scope: ExportScope): string[][] {
  if (scope === "frames") return topFrames(editor).map((id) => [id]);
  if (scope === "selection") return [editor.topSelection()];
  return [editor.store.childIds(null)];
}

// Paper in points, and a half-inch margin around the drawing on it.
const PAPER: Record<Exclude<PaperSize, "fit">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGIN = 36;
// Browsers refuse very large canvases; a huge board gets a lower scale instead of failing.
const MAX_SIDE = 8192;
const PT_PER_PX = 0.75;

/** Puts a background and the dot grid (as on the canvas) behind an exported drawing. */
function decorate(svg: string, fill: string | null, grid: string | null): string {
  const view = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(svg);
  if (!view || (!fill && !grid)) return svg;
  const [x, y, w, h] = view.slice(1).map(Number);
  const box = `x="${x}" y="${y}" width="${w}" height="${h}"`;
  const layers =
    (grid ? `<defs><pattern id="cc-export-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${grid}"/></pattern></defs>` : "") +
    (fill ? `<rect ${box} fill="${fill}"/>` : "") +
    (grid ? `<rect ${box} fill="url(#cc-export-grid)"/>` : "");
  return svg.replace(/(<svg[^>]*>)/, `$1${layers}`);
}

type Drawing = { svg: string; width: number; height: number };

/** The drawings an export would make with these options: one per file, or one per PDF page. */
export function exportDrawings(editor: Editor, options: ExportOptions): Drawing[] {
  const ctx = exportContext(editor);
  // JPEG and PDF pages have no transparency.
  const transparent = options.background === "transparent" && (options.format === "png" || options.format === "svg");
  const fill = transparent ? null : options.background === "white" ? "white" : ctx.resolve("var(--background)");
  const grid = options.grid ? ctx.resolve("var(--border)") : null;
  return targets(editor, options.scope)
    .map((ids) => exportSvg(ids, ctx, options.border))
    .filter((out): out is Drawing => out !== null)
    .map((out) => ({ ...out, svg: decorate(out.svg, fill, grid) }));
}

/** Pixel size of a picture at a scale, after the browser's canvas limit. */
export function pixelSize(drawing: { width: number; height: number }, scale: number): { width: number; height: number } {
  const fit = Math.min(scale, MAX_SIDE / Math.max(drawing.width, drawing.height, 1));
  return { width: Math.max(1, Math.round(drawing.width * fit)), height: Math.max(1, Math.round(drawing.height * fit)) };
}

async function rasterize(drawing: Drawing, scale: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([drawing.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    Object.assign(canvas, pixelSize(drawing, scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no blob"))), type, quality));

/** A drawing on a PDF page: the page fits the drawing, or the drawing fits a sheet of paper inside the margins. */
function pdfPage(jpeg: Uint8Array, canvas: HTMLCanvasElement, drawing: Drawing, options: ExportOptions): PdfPage {
  const base = { jpeg, pixelWidth: canvas.width, pixelHeight: canvas.height };
  const [w, h] = [drawing.width * PT_PER_PX, drawing.height * PT_PER_PX];
  if (options.paper === "fit") return { ...base, width: w, height: h };
  const [short, long] = PAPER[options.paper];
  const [pw, ph] = options.landscape ? [long, short] : [short, long];
  const k = Math.min((pw - 2 * MARGIN) / w, (ph - 2 * MARGIN) / h);
  const [bw, bh] = [w * k, h * k];
  return { ...base, width: pw, height: ph, box: { x: (pw - bw) / 2, y: (ph - bh) / 2, w: bw, h: bh } };
}

/** Makes the file the export dialog asked for and downloads it. False when there was nothing to export or it failed. */
export async function runExport(editor: Editor, options: ExportOptions): Promise<boolean> {
  const drawings = exportDrawings(editor, options);
  if (drawings.length === 0) {
    toast.error("There's nothing to export yet.");
    return false;
  }
  const file = `${fileName(options.name)}.${options.format === "jpeg" ? "jpg" : options.format}`;
  try {
    const [first] = drawings as [Drawing];
    if (options.format === "svg") download(new Blob([first.svg], { type: "image/svg+xml" }), file);
    else if (options.format !== "pdf") {
      const type = options.format === "png" ? "image/png" : "image/jpeg";
      download(await canvasBlob(await rasterize(first, options.scale), type, 0.92), file);
    } else {
      const pages: PdfPage[] = [];
      for (const drawing of drawings) {
        const canvas = await rasterize(drawing, options.scale);
        const jpeg = new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
        pages.push(pdfPage(jpeg, canvas, drawing, options));
      }
      download(new Blob([imagesToPdf(pages)], { type: "application/pdf" }), file);
    }
    return true;
  } catch {
    toast.error(`Couldn't make the ${options.format.toUpperCase()}. Try a smaller scale or another format.`);
    return false;
  }
}

export async function copyCss(editor: Editor) {
  const [id] = editor.selection.get();
  const shape = id ? editor.get(id) : undefined;
  if (!shape) return void toast.error("Select a shape to copy its CSS.");
  if (await copyText(shapeCss(shape, exportContext(editor)))) toast.success("CSS copied");
  else toast.error("Couldn't reach the clipboard.");
}

export async function copyHtml(editor: Editor) {
  const [id] = editor.selection.get();
  const html = id ? frameHtml(id, exportContext(editor)) : null;
  if (!html) return void toast.error("Select a frame to copy it as HTML and CSS.");
  if (await copyText(html)) toast.success("HTML and CSS copied");
  else toast.error("Couldn't reach the clipboard.");
}
