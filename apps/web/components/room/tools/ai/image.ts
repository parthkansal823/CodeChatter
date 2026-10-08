import { AI_LIMITS } from "@codechatter/contracts";
import type { ClipboardEvent } from "react";

export type PastedImage = { mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string; url: string };

// Models see little more than this on the long side; larger only costs upload time.
const MAX_SIDE = 1568;

/**
 * Shrink a pasted or chosen image to fit the request limit: scale the long
 * side down, then try WebP (keeps screenshot text sharp), then JPEG at
 * falling quality. Returns null when even that doesn't fit.
 */
export async function prepareImage(file: Blob): Promise<PastedImage | null> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const scale of [1, 0.75, 0.5]) {
      const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height)) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const [type, quality] of [["image/webp", 0.9], ["image/jpeg", 0.85], ["image/jpeg", 0.7]] as const) {
        const url = canvas.toDataURL(type, quality);
        // Browsers that can't encode the type silently return PNG.
        const mediaType = url.slice(5, url.indexOf(";")) as PastedImage["mediaType"];
        const data = url.slice(url.indexOf(",") + 1);
        if (data.length <= AI_LIMITS.imageChars) return { mediaType, data, url };
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export function imageFromClipboard(event: ClipboardEvent): File | null {
  for (const item of event.clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}
