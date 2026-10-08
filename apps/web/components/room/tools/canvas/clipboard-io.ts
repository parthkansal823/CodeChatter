"use client";

import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { toast } from "sonner";

import { copyText } from "@/lib/clipboard";

import type { ClipboardPayload, Editor } from "./editor";
import type { Point } from "./geometry";

/**
 * Copy and paste of shapes. Copies go to the system clipboard as JSON (so
 * they paste into another design or another tab) and to memory, in case the
 * clipboard isn't writable. Pasted images become image shapes; pasted text
 * becomes a text box (or a sticky note on a whiteboard).
 */
let memory: ClipboardPayload | null = null;

const MAX_IMAGE_SIDE = 1600;
/** Images live inside the shared document, so they're kept small. */
export const MAX_IMAGE_BYTES = 600_000;

export async function copySelection(editor: Editor, cut = false) {
  const payload = editor.copyPayload(editor.selection.get());
  if (!payload) return;
  memory = payload;
  await copyText(JSON.stringify(payload));
  if (cut) editor.deleteShapes(editor.selection.get());
}

function parsePayload(text: string): ClipboardPayload | null {
  if (!text.startsWith("{")) return null;
  try {
    const data = JSON.parse(text) as Partial<ClipboardPayload>;
    return data.type === "codechatter/shapes" && Array.isArray(data.shapes) ? (data as ClipboardPayload) : null;
  } catch {
    return null;
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function pasteShapes(editor: Editor, payload: ClipboardPayload) {
  // Paste in place (nudged) while the originals are on screen; otherwise in the middle of the view.
  const originals = payload.shapes.some((s) => editor.store.has(s.id));
  if (originals) editor.paste(payload, { x: 16, y: 16 });
  else editor.paste(payload, { ...editor.viewCenter(), at: true });
}

export function handlePaste(event: ClipboardEvent | ReactClipboardEvent, editor: Editor) {
  if (isEditable(event.target) || editor.readOnly.get()) return;
  const data = event.clipboardData;
  if (!data) return;
  const image = [...data.files].find((file) => file.type.startsWith("image/"));
  if (image) {
    event.preventDefault();
    void insertImage(editor, image, editor.viewCenter());
    return;
  }
  const text = data.getData("text/plain");
  const payload = parsePayload(text) ?? (text ? null : memory);
  event.preventDefault();
  if (payload) return pasteShapes(editor, payload);
  if (!text.trim()) return;
  const at = editor.viewCenter();
  let id = "";
  editor.change(() => {
    id =
      editor.kind === "board"
        ? editor.create("sticky", { x: at.x - 100, y: at.y - 100, text: text.slice(0, 2000), fill: editor.style.get().note })
        : editor.create("text", { x: at.x, y: at.y, text: text.slice(0, 5000), parentId: editor.frameAt(at) });
  });
  editor.select([id]);
}

/** Shrink an image until it fits the size cap: smaller dimensions first, then lower quality. */
export async function imageToDataUrl(file: Blob): Promise<{ src: string; w: number; h: number } | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  let scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 5; attempt++) {
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, w, h);
    const src = canvas.toDataURL("image/webp", 0.85);
    if (src.length <= MAX_IMAGE_BYTES) {
      bitmap.close();
      return { src, w, h };
    }
    scale *= 0.7;
  }
  bitmap.close();
  return null;
}

export async function insertImage(editor: Editor, file: Blob, at: Point) {
  const image = await imageToDataUrl(file);
  if (!image) return void toast.error("That image is too large or unreadable. Try a smaller PNG or JPEG.");
  // Shown no larger than 800 units on its long side; the pixels are kept for export.
  const fit = Math.min(1, 800 / Math.max(image.w, image.h));
  const w = Math.round(image.w * fit);
  const h = Math.round(image.h * fit);
  let id = "";
  editor.change(() => {
    id = editor.create("image", {
      x: Math.round(at.x - w / 2),
      y: Math.round(at.y - h / 2),
      w,
      h,
      src: image.src,
      parentId: editor.kind === "design" ? editor.frameAt(at) : null,
    });
  });
  editor.select([id]);
}
