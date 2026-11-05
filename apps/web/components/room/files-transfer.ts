"use client";

import { BLOB_MAX_BYTES, typeForName, type BlobRef } from "@codechatter/contracts";
import { validateName } from "@codechatter/workspace-model";
import type * as Y from "yjs";

// Relative, not "@/": the unit tests run these modules with tsx, which doesn't read the web app's paths.
import { BlobUploadError, fetchBlob, uploadBlob } from "../../lib/blobs";
import { unzip, zip, type UnzipEntry } from "../../lib/zip";
import { roomBlobs, roomTexts } from "./source-control/room-files";

/**
 * Files in and out of a room (the Files view): files and zips you upload or drop become
 * the room's files; Download as zip hands you all of them.
 *
 * Text files up to 1 MB become editable text. Anything else up to 20 MB (images, PDFs,
 * fonts, data files, text over 1 MB) becomes a binary file: its bytes go to the room's
 * object store first, then the file tree gets it. Folders no one means to import (.git,
 * node_modules) are skipped and named, as is everything when the server keeps no
 * binary files.
 */

/** The largest text file a room takes, as a commit does. */
export const MAX_FILE_BYTES = 1_000_000;
const UNWANTED = /(^|\/)(\.git|node_modules|__pycache__|\.venv|\.next|dist|build|target)(\/|$)/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const NO_STORE = "this server doesn't keep binary files (no object store is set up)";

export type ImportPlan = {
  /** Path in the room → text. */
  files: Map<string, string>;
  /** Path in the room → bytes, for binary files (uploaded before they're added). */
  binaries: Map<string, Uint8Array>;
  added: string[];
  replaced: string[];
  skipped: Array<{ path: string; reason: string }>;
};

/**
 * What an upload becomes: each entry as text or as a binary file at its path under `into`,
 * or skipped with why. A zip whose files all sit in one folder ("project-main/…", as
 * GitHub's do) loses that folder, so its files land where you'd expect.
 */
export function planImport(
  entries: UnzipEntry[],
  options: { into: string; existing: ReadonlySet<string>; fromZip: boolean; binaries?: boolean },
): ImportPlan {
  const binaries = options.binaries ?? true;
  const plan: ImportPlan = { files: new Map(), binaries: new Map(), added: [], replaced: [], skipped: [] };
  const firsts = new Set(entries.map((entry) => entry.path.split("/")[0]));
  const strip = options.fromZip && entries.length > 0 && firsts.size === 1 && entries.every((entry) => entry.path.includes("/"));
  for (const entry of entries) {
    const path = strip ? entry.path.slice(entry.path.indexOf("/") + 1) : entry.path;
    if (UNWANTED.test(path)) {
      plan.skipped.push({ path, reason: "it's in a folder that isn't imported (.git, node_modules, build output)" });
      continue;
    }
    const bad = path.split("/").map(validateName).find(Boolean);
    if (bad) {
      plan.skipped.push({ path, reason: bad.replace(/\.$/, "").toLowerCase() });
      continue;
    }
    const target = options.into ? `${options.into}/${path}` : path;
    if (plan.files.has(target) || plan.binaries.has(target)) continue;
    // A known binary type (a PNG, a PDF, a font, a zip…) stays binary even when its bytes happen to read as text; SVG is text.
    const type = typeForName(path);
    const binaryByName = type !== "application/octet-stream" && type !== "image/svg+xml";
    const text = !binaryByName && entry.data.length <= MAX_FILE_BYTES ? asText(entry.data) : null;
    if (text !== null) {
      plan.files.set(target, text);
    } else if (entry.data.length > BLOB_MAX_BYTES) {
      plan.skipped.push({ path, reason: "it's over 20 MB" });
      continue;
    } else if (!binaries) {
      plan.skipped.push({ path, reason: entry.data.length > MAX_FILE_BYTES ? `it's over 1 MB, and ${NO_STORE}` : `it isn't text, and ${NO_STORE}` });
      continue;
    } else {
      plan.binaries.set(target, entry.data);
    }
    (options.existing.has(target) ? plan.replaced : plan.added).push(target);
  }
  return plan;
}

function asText(data: Uint8Array): string | null {
  if (data.includes(0)) return null;
  try {
    return decoder.decode(data);
  } catch {
    return null;
  }
}

/**
 * Upload a plan's binary files (four at a time). Ones that fail move to `skipped` with the
 * reason, and if the server keeps no binary files, all of them do.
 */
export async function uploadBinaries(roomId: string, plan: ImportPlan, onProgress?: (done: number, total: number) => void): Promise<Map<string, BlobRef>> {
  const uploaded = new Map<string, BlobRef>();
  const queue = [...plan.binaries];
  const failed: ImportPlan["skipped"] = [];
  let noStore = false;
  let done = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, bytes] = next;
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (noStore) {
        failed.push({ path, reason: NO_STORE });
        continue;
      }
      try {
        uploaded.set(path, await uploadBlob(roomId, bytes, name, typeForName(name)));
      } catch (error) {
        if (error instanceof BlobUploadError && error.status === 503) noStore = true;
        failed.push({ path, reason: noStore ? NO_STORE : `the upload failed (${error instanceof Error ? error.message : "unknown error"})` });
      }
      onProgress?.(++done, plan.binaries.size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  for (const { path } of failed) {
    plan.binaries.delete(path);
    plan.added = plan.added.filter((p) => p !== path);
    plan.replaced = plan.replaced.filter((p) => p !== path);
  }
  plan.skipped.push(...failed);
  return uploaded;
}

/** The files you picked or dropped, unpacked when they're zips; a folder you picked keeps its paths. */
export async function readUpload(files: File[]): Promise<{ entries: UnzipEntry[]; skipped: ImportPlan["skipped"]; fromZip: boolean }> {
  const entries: UnzipEntry[] = [];
  const skipped: ImportPlan["skipped"] = [];
  let fromZip = false;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      const unzipped = await unzip(bytes);
      entries.push(...unzipped.entries);
      skipped.push(...unzipped.skipped);
      fromZip = files.length === 1;
    } else {
      entries.push({ path: file.webkitRelativePath || file.name, data: bytes });
    }
  }
  return { entries, skipped, fromZip };
}

/** All the room's files as a zip, saved to your computer: text as it is, binary files fetched. Returns how many. */
export async function downloadZip(doc: Y.Doc, roomId: string, fileName: string): Promise<{ files: number; missing: string[] }> {
  const entries: Array<{ path: string; data: string | Uint8Array }> = [...roomTexts(doc)].map(([path, text]) => ({ path, data: text }));
  const missing: string[] = [];
  const blobs = [...roomBlobs(doc)];
  const worker = async () => {
    for (let next = blobs.shift(); next; next = blobs.shift()) {
      const [path, blob] = next;
      try {
        entries.push({ path, data: new Uint8Array(await fetchBlob(roomId, blob.sha256)) });
      } catch {
        missing.push(path);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, blobs.length) }, worker));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const data = zip(entries);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { files: entries.length, missing };
}

/** One sentence about what an import did, for a message. */
export function importSummary(plan: ImportPlan): string {
  const parts: string[] = [];
  const count = plan.added.length + plan.replaced.length;
  parts.push(count === 1 ? "Imported 1 file" : `Imported ${count} files`);
  if (plan.replaced.length) parts.push(`(${plan.replaced.length} replaced)`);
  let text = parts.join(" ") + ".";
  if (plan.skipped.length) {
    const first = plan.skipped[0]!;
    text += ` Skipped ${plan.skipped.length}: ${first.path}, because ${first.reason}${plan.skipped.length > 1 ? ", and others" : ""}.`;
  }
  return text;
}
