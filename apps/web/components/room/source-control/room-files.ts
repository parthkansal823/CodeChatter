import {
  createBinaryFileAtPath,
  createFileAtPath,
  findByPath,
  flatten,
  isBlobRef,
  isNotebookName,
  listTree,
  maps,
  notebooks,
  setBlob,
  setFileText,
  textOf,
  trash,
  type BlobRef,
} from "@codechatter/workspace-model";
import type * as Y from "yjs";

import type { Change, FileMap, MergePlan } from "./merge";

/** Set in the files document's meta after each sync with GitHub, so everyone's view fetches the new base. */
export const SYNC_KEY = "repoSync";
export type SyncMark = { branch: string; commit: string; at: number };

const ORIGIN = "source-control";

/**
 * A binary file, in maps of path → text (History, fork): a marker no text file can be,
 * since a room's text never holds a NUL. Changed bytes make a different marker, so the
 * same comparisons and restores work for both kinds.
 */
const BLOB_MARK = "\u0000codechatter-blob:";

export function blobMarker(blob: BlobRef): string {
  return `${BLOB_MARK}${JSON.stringify({ sha256: blob.sha256, size: blob.size, type: blob.type })}`;
}

/** The blob a marker stands for, or null for real text. */
export function markedBlob(text: string | undefined): BlobRef | null {
  if (!text?.startsWith(BLOB_MARK)) return null;
  try {
    const value: unknown = JSON.parse(text.slice(BLOB_MARK.length));
    return isBlobRef(value) ? value : null;
  } catch {
    return null;
  }
}

/** The room's text files now, by path (binary files left out: this is what goes to GitHub). */
export function roomTexts(doc: Y.Doc): Map<string, string> {
  return new Map(
    flatten(listTree(doc))
      .filter((node) => node.kind === "file" && !node.blob)
      .map((node) => [node.path, textOf(doc, node.id)?.toString() ?? ""]),
  );
}

/** Every file now, by path: text files' text, and a marker for each binary file. */
export function roomContents(doc: Y.Doc): Map<string, string> {
  return new Map(
    flatten(listTree(doc))
      .filter((node) => node.kind === "file")
      .map((node) => [node.path, node.blob ? blobMarker(node.blob) : (textOf(doc, node.id)?.toString() ?? "")]),
  );
}

/** The room's binary files, by path. */
export function roomBlobs(doc: Y.Doc): Map<string, BlobRef> {
  const out = new Map<string, BlobRef>();
  for (const node of flatten(listTree(doc))) if (node.kind === "file" && node.blob) out.set(node.path, node.blob);
  return out;
}

/** Write a file's text (or, for a marker, its blob), making it and its folders when it isn't there. */
function writeFile(doc: Y.Doc, path: string, text: string, userId: string): void {
  const blob = markedBlob(text);
  const node = findByPath(doc, path);
  if (node?.kind !== "file") {
    if (blob) createBinaryFileAtPath(doc, path, blob, userId);
    else createFileAtPath(doc, path, text, userId);
    return;
  }
  if (blob) setBlob(doc, node.id, blob);
  else setFileText(doc, node.id, text);
  // A notebook is rebuilt from its new text the next time it's shown.
  if (isNotebookName(path)) notebooks(doc).delete(node.id);
}

/** Write binary files (already uploaded) at these paths, making any that aren't there, as one edit. */
export function writeBlobs(doc: Y.Doc, blobs: ReadonlyMap<string, BlobRef>, userId: string, origin: string): void {
  doc.transact(() => {
    for (const [path, blob] of blobs) writeFile(doc, path, blobMarker(blob), userId);
  }, origin);
}

function removeFile(doc: Y.Doc, path: string): void {
  const node = findByPath(doc, path);
  if (node?.kind === "file") trash(doc, node.id);
}

/** Write these files (making any that aren't there), as one edit: an upload or a zip import. */
export function writeFiles(doc: Y.Doc, files: FileMap, userId: string, origin: string): void {
  doc.transact(() => {
    for (const [path, text] of files) writeFile(doc, path, text, userId);
  }, origin);
}

/** Make the room's files exactly these (a fork copies a room's files in this way, markers included), as one edit. */
export function replaceFiles(doc: Y.Doc, files: FileMap, userId: string, origin: string): void {
  doc.transact(() => {
    for (const path of roomContents(doc).keys()) if (!files.has(path)) removeFile(doc, path);
    for (const [path, text] of files) writeFile(doc, path, text, userId);
  }, origin);
}

/** A pull's merge, as one edit everyone sees, marked as the room's new sync. */
export function applyPlan(doc: Y.Doc, plan: MergePlan, userId: string, sync: Omit<SyncMark, "at">): void {
  doc.transact(() => {
    for (const [path, text] of plan.write) writeFile(doc, path, text, userId);
    for (const path of plan.remove) removeFile(doc, path);
    maps(doc).meta.set(SYNC_KEY, { ...sync, at: Date.now() } satisfies SyncMark);
  }, ORIGIN);
}

export function markSynced(doc: Y.Doc, sync: Omit<SyncMark, "at">): void {
  maps(doc).meta.set(SYNC_KEY, { ...sync, at: Date.now() } satisfies SyncMark);
}

/** Put a changed file back as it is in the base: unedited, unmade or undeleted. */
export function discardChange(doc: Y.Doc, change: Change, base: FileMap, userId: string): void {
  putBack(doc, [change], base, userId, ORIGIN);
}

/**
 * Put changed files back as they are in `base`, as one edit everyone sees (History's
 * restore uses it with a checkpoint's files as the base).
 */
export function putBack(doc: Y.Doc, changes: readonly Change[], base: FileMap, userId: string, origin: string): void {
  doc.transact(() => {
    for (const change of changes) {
      const before = base.get(change.path);
      if (before === undefined) removeFile(doc, change.path);
      else writeFile(doc, change.path, before, userId);
    }
  }, origin);
}

/** Lines git would leave in a file it couldn't merge. */
export const hasConflictMarkers = (text: string) => /^<{7} .*\n[\s\S]*^={7}\n[\s\S]*^>{7} /m.test(text);
