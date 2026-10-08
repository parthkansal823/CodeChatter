import { randomId } from "@codechatter/workspace-model";
import type { JSONContent } from "@tiptap/react";
import * as Y from "yjs";

import type { Author } from "./comments";
import { historyDocName, withDoc } from "./headless";

/**
 * Saved versions of a page, in a document beside it (`…:page:{id}-history`):
 *
 *   snapshots: Y.Array<Snapshot>   oldest first, capped
 *
 * A snapshot is the page's content as ProseMirror JSON plus its title. That is
 * the page's Yjs state rendered into a form that stays readable after the live
 * document's deleted text has been garbage collected, and restoring one is
 * just setting the editor's content, which the live document records as a new
 * change.
 */
export type Snapshot = { id: string; at: number; by: Author; title: string; content: JSONContent; words: number; label: string | null };

export const SNAPSHOT_EVERY_MS = 5 * 60_000;
export const MAX_SNAPSHOTS = 60;

const snapshotsArray = (doc: Y.Doc) => doc.getArray<Snapshot>("snapshots");

/** Newest first. */
export const snapshotsOf = (doc: Y.Doc): Snapshot[] => snapshotsArray(doc).toArray().reverse();

export function countWords(node: JSONContent): number {
  let words = 0;
  const walk = (n: JSONContent) => {
    if (n.type === "text" && n.text) words += n.text.split(/\s+/).filter(Boolean).length;
    n.content?.forEach(walk);
  };
  walk(node);
  return words;
}

/** Edits are pending and the last save is old enough. */
export const shouldSnapshot = (input: { now: number; lastAt: number; dirty: boolean; every?: number }) =>
  input.dirty && input.now - input.lastAt >= (input.every ?? SNAPSHOT_EVERY_MS);

export type SaveOptions = {
  /** Skip if the newest version is younger than this. */
  minGapMs?: number;
  /** Only save when there are no versions yet (the first one, before edits). */
  onlyIfEmpty?: boolean;
  label?: string;
};

/** Append a version. Resolves to whether one was saved (not when the page is unchanged or the gap hasn't passed). */
export async function saveSnapshot(roomId: string, pageId: string, input: { by: Author; title: string; content: JSONContent }, options: SaveOptions = {}): Promise<boolean> {
  return withDoc(
    historyDocName(roomId, pageId),
    (doc) => {
      const list = snapshotsArray(doc);
      const last = list.length ? list.get(list.length - 1) : null;
      if (options.onlyIfEmpty && last) return false;
      if (last && options.minGapMs && Date.now() - last.at < options.minGapMs) return false;
      if (last && !options.label && last.title === input.title && JSON.stringify(last.content) === JSON.stringify(input.content)) return false;
      doc.transact(() => {
        list.push([{ id: randomId(), at: Date.now(), by: input.by, title: input.title, content: input.content, words: countWords(input.content), label: options.label ?? null }]);
        if (list.length > MAX_SNAPSHOTS) list.delete(0, list.length - MAX_SNAPSHOTS);
      });
      return true;
    },
    { write: true },
  );
}
