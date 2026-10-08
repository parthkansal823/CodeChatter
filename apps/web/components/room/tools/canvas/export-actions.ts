"use client";

import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";
import { resolveColor } from "@/lib/css-color";

import { expandInstances } from "./components";
import type { Editor } from "./editor";
import { exportSvg, frameHtml, shapeCss, type ExportContext } from "./export";
import { fontStacks, measureText } from "./measure";

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

export function downloadSvg(editor: Editor, name: string) {
  const out = exportSvg(exportIds(editor), exportContext(editor));
  if (!out) return void toast.error("There's nothing to export yet.");
  download(new Blob([out.svg], { type: "image/svg+xml" }), `${name}.svg`);
}

export async function downloadPng(editor: Editor, name: string, scale = 2) {
  const out = exportSvg(exportIds(editor), exportContext(editor));
  if (!out) return void toast.error("There's nothing to export yet.");
  const url = URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(out.width * scale));
    canvas.height = Math.max(1, Math.round(out.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("no blob");
    download(blob, `${name}.png`);
  } catch {
    toast.error("Couldn't make a PNG of this. Try exporting SVG instead.");
  } finally {
    URL.revokeObjectURL(url);
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
