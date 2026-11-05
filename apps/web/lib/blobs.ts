import { BlobRef, typeForName } from "@codechatter/contracts";

/**
 * A room's binary files from the browser: upload bytes to the API (which keeps them in
 * the object store under the room), and the URL to read them back. The file tree holds
 * only each file's blob (SHA-256, size, type); see apps/api/src/blobs.
 */

/** Where a room's blob is served (same origin, with the session cookie). */
export function blobUrl(roomId: string, sha256: string, download?: string): string {
  return `/api/rooms/${roomId}/blobs/${sha256}${download ? `?download=${encodeURIComponent(download)}` : ""}`;
}

export class BlobUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BlobUploadError";
  }
}

/** Upload one file's bytes into a room. 503 means this server keeps no binary files. */
export async function uploadBlob(roomId: string, data: Blob | Uint8Array, name: string, type?: string): Promise<BlobRef> {
  const mediaType = type && type !== "application/octet-stream" ? type : typeForName(name);
  const query = new URLSearchParams({ name, type: mediaType });
  const response = await fetch(`/api/rooms/${roomId}/blobs?${query}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/octet-stream" },
    body: data as BodyInit,
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new BlobUploadError(response.status, problem?.detail ?? `The upload failed (${response.status}).`);
  }
  return BlobRef.parse(await response.json());
}

/** A blob's bytes (or the first ones, with `range`). */
export async function fetchBlob(roomId: string, sha256: string, options: { range?: string; signal?: AbortSignal } = {}): Promise<ArrayBuffer> {
  const response = await fetch(blobUrl(roomId, sha256), {
    credentials: "same-origin",
    signal: options.signal,
    headers: options.range ? { range: options.range } : undefined,
  });
  if (!response.ok) throw new Error(response.status === 404 ? "This file's bytes are missing." : `Couldn't load the file (${response.status}).`);
  return response.arrayBuffer();
}

/** 1536 → "1.5 KB". */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
