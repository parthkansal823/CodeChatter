import {
  createFileAtPath,
  findByPath,
  flatten,
  isNotebookName,
  listTree,
  maps,
  notebooks,
  setText,
  textOf,
  trash,
} from "@codechatter/workspace-model";
import type * as Y from "yjs";

import type { Change, FileMap, MergePlan } from "./merge";

/** Set in the files document's meta after each sync with GitHub, so everyone's view fetches the new base. */
export const SYNC_KEY = "repoSync";
export type SyncMark = { branch: string; commit: string; at: number };

const ORIGIN = "source-control";

/** The room's files now, by path. */
export function roomTexts(doc: Y.Doc): Map<string, string> {
  return new Map(
    flatten(listTree(doc))
      .filter((node) => node.kind === "file")
      .map((node) => [node.path, textOf(doc, node.id)?.toString() ?? ""]),
  );
}

/** Write a file's text, making it (and its folders) when it isn't there. */
function writeFile(doc: Y.Doc, path: string, text: string, userId: string): void {
  const node = findByPath(doc, path);
  const ytext = node?.kind === "file" ? textOf(doc, node.id) : undefined;
  if (!node || !ytext) {
    createFileAtPath(doc, path, text, userId);
    return;
  }
  setText(ytext, text);
  // A notebook is rebuilt from its new text the next time it's shown.
  if (isNotebookName(path)) notebooks(doc).delete(node.id);
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

/** Make the room's files exactly these (a fork copies a room's code in this way), as one edit. */
export function replaceFiles(doc: Y.Doc, files: FileMap, userId: string, origin: string): void {
  doc.transact(() => {
    for (const path of roomTexts(doc).keys()) if (!files.has(path)) removeFile(doc, path);
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
