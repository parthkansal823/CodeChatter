import type { TarEntry } from "./tar.js";

/** What a room takes from a repository: text files, each and all together kept to sizes the editor handles. */
export const IMPORT_LIMITS = { files: 3000, fileBytes: 1_000_000, totalBytes: 25_000_000 };

export type ImportedFile = { path: string; content: string };

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** A name the room's file tree keeps as it is (workspace-model's validateName, without trimming). */
// eslint-disable-next-line no-control-regex
const goodName = (name: string) => name.length > 0 && name.length <= 255 && name === name.trim() && name !== "." && name !== ".." && !/[\\\u0000-\u001f]/.test(name);

/** UTF-8 text without NUL bytes; anything else is binary. */
function decode(data: Buffer): string | null {
  if (data.subarray(0, 8000).includes(0)) return null;
  try {
    return utf8.decode(data);
  } catch {
    return null;
  }
}

/**
 * The text files of a GitHub tarball, paths relative to the repository (GitHub wraps it in
 * one `owner-name-sha/` folder). Binary files, files over the size limit, links and names the
 * file tree can't hold are skipped; past the room's limits the rest is skipped and `truncated` set.
 */
export function pickTextFiles(entries: TarEntry[], limits = IMPORT_LIMITS): { files: ImportedFile[]; skipped: number; truncated: boolean } {
  const files: ImportedFile[] = [];
  let skipped = 0;
  let total = 0;
  let truncated = false;
  for (const entry of entries) {
    if (entry.type === "directory" || entry.type === "other") continue;
    const path = entry.path.split("/").slice(1).join("/");
    if (!path) continue;
    if (truncated || entry.type === "link" || entry.data.length > limits.fileBytes || !path.split("/").every(goodName)) {
      skipped++;
      continue;
    }
    const content = decode(entry.data);
    if (content === null) {
      skipped++;
      continue;
    }
    if (files.length >= limits.files || total + entry.data.length > limits.totalBytes) {
      truncated = true;
      skipped++;
      continue;
    }
    total += entry.data.length;
    files.push({ path, content });
  }
  return { files, skipped, truncated };
}
