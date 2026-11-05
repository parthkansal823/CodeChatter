import { z } from "zod";

/**
 * Binary room files (images, PDFs, fonts…): the file tree holds a BlobRef
 * (workspace-model), and the bytes live in the object store under the room,
 * so reading one only ever needs permission to see that room.
 */

export const BlobRef = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
  type: z.string().min(1).max(255),
});
export type BlobRef = z.infer<typeof BlobRef>;

/** Where all of a room's blobs are (deleted with the room). */
export function roomBlobPrefix(roomId: string): string {
  return `rooms/${roomId}/`;
}

/** The object key for a room's blob. Rooms never share keys: a fork copies its blobs. */
export function blobKey(roomId: string, sha256: string): string {
  return `${roomBlobPrefix(roomId)}${sha256}`;
}

/** Largest file someone can upload into a room. */
export const BLOB_MAX_BYTES = 20 * 1024 * 1024;
/** Largest binary a program in the sandbox can make that comes back into the room (it travels over the agent's stdio). */
export const SANDBOX_BLOB_MAX_BYTES = 5 * 1024 * 1024;

/** Copy blobs from a room you can see into one you can edit (a fork brings its images along). */
export const BlobCopyInput = z.object({
  from: z.string().regex(/^[A-Z0-9]{6}$/),
  sha256: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(1000),
});
export type BlobCopyInput = z.infer<typeof BlobCopyInput>;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  jar: "application/java-archive",
  wasm: "application/wasm",
  sqlite: "application/vnd.sqlite3",
  db: "application/vnd.sqlite3",
  parquet: "application/vnd.apache.parquet",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** A media type from a file name, for when the browser or the sandbox gives none. */
export function typeForName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot >= 0 && TYPES[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}

/** How the editor shows a binary file. */
export type BlobView = "image" | "pdf" | "font" | "audio" | "video" | "other";

export function blobView(type: string): BlobView {
  const t = type.toLowerCase().split(";")[0]!.trim();
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(t)) return "image";
  if (t === "application/pdf") return "pdf";
  if (/^font\/(woff2?|ttf|otf)$/.test(t)) return "font";
  if (/^audio\/(mpeg|wav|ogg|webm)$/.test(t)) return "audio";
  if (/^video\/(mp4|webm|ogg)$/.test(t)) return "video";
  return "other";
}
