import { blobView } from "@codechatter/contracts";

/**
 * Response headers for a room's binary file, served from the app's own origin.
 *
 * The bytes are whatever someone uploaded, so the response must never run as a
 * page: only types the editor can show keep their media type (anything else is
 * application/octet-stream), the browser may not sniff, and a document opened
 * straight from the URL (an SVG with a script in it) is sandboxed with no
 * scripts. Images open inline; everything else downloads when visited directly
 * (the editor fetches PDFs and fonts itself). Blobs are named by their SHA-256,
 * so a response never changes and can be cached for good.
 */
export function blobResponseHeaders(input: { type: string; sha256: string; download?: string }): Record<string, string> {
  const view = blobView(input.type);
  const contentType = view === "other" ? "application/octet-stream" : input.type.toLowerCase();
  const disposition = input.download
    ? attachment(input.download)
    : view === "image"
      ? "inline"
      : "attachment";
  return {
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: `"${input.sha256}"`,
    "Accept-Ranges": "bytes",
  };
}

/** `attachment` with the file's name, in plain ASCII and in UTF-8 (RFC 6266). */
function attachment(name: string): string {
  const clean = name.replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** The one byte range a request asks for (`Range: bytes=a-b`), clamped to the size; null for the whole file or a range we don't serve. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start: number;
  let end: number;
  if (match[1] === "") {
    // The last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
