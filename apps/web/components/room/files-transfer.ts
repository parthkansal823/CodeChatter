"use client";

import { validateName } from "@codechatter/workspace-model";
import type * as Y from "yjs";

// Relative, not "@/": the unit tests run these modules with tsx, which doesn't read the web app's paths.
import { unzip, zip, type UnzipEntry } from "../../lib/zip";
import { roomTexts } from "./source-control/room-files";

/**
 * Files in and out of a room (the Files view): files and zips you upload or drop become
 * the room's files; Download as zip hands you its code. The room keeps text files (the
 * sandbox syncs text), so binaries are skipped and named, as are files over 1 MB and the
 * folders no one means to import (.git, node_modules).
 */

/** The largest text file a room takes, as a commit does. */
export const MAX_FILE_BYTES = 1_000_000;
const UNWANTED = /(^|\/)(\.git|node_modules|__pycache__|\.venv|\.next|dist|build|target)(\/|$)/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export type ImportPlan = {
  /** Path in the room → text. */
  files: Map<string, string>;
  added: string[];
  replaced: string[];
  skipped: Array<{ path: string; reason: string }>;
};

/**
 * What an upload becomes: each entry as text at its path under `into`, or skipped with why.
 * A zip whose files all sit in one folder ("project-main/…", as GitHub's do) loses that
 * folder, so its files land where you'd expect.
 */
export function planImport(entries: UnzipEntry[], options: { into: string; existing: ReadonlySet<string>; fromZip: boolean }): ImportPlan {
  const plan: ImportPlan = { files: new Map(), added: [], replaced: [], skipped: [] };
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
    if (entry.data.length > MAX_FILE_BYTES) {
      plan.skipped.push({ path, reason: "it's over 1 MB" });
      continue;
    }
    let text: string;
    try {
      if (entry.data.includes(0)) throw new Error("binary");
      text = decoder.decode(entry.data);
    } catch {
      plan.skipped.push({ path, reason: "it isn't text (images and other binary files can't be added to a room yet)" });
      continue;
    }
    const target = options.into ? `${options.into}/${path}` : path;
    if (plan.files.has(target)) continue;
    plan.files.set(target, text);
    (options.existing.has(target) ? plan.replaced : plan.added).push(target);
  }
  return plan;
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

/** The room's code as a zip, saved to your computer. */
export function downloadZip(doc: Y.Doc, fileName: string): number {
  const files = roomTexts(doc);
  const data = zip([...files].map(([path, text]) => ({ path, data: text })));
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return files.size;
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
