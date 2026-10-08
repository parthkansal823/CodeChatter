"use client";

import { textOf } from "@codechatter/workspace-model";
import { useCallback, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";

/** `start` and `end` are character offsets in the file. */
export type EditorSelection = { text: string; startLine: number; endLine: number; start: number; end: number };

type RelativeSelection = { anchor: unknown; head: unknown };

/**
 * Your selection in the open file, read from awareness: y-monaco publishes
 * it as Yjs relative positions (for others' cursors), so this needs no
 * handle on the editor itself. Null when nothing is selected in that file.
 */
export function readSelection(doc: Y.Doc, local: Record<string, unknown> | null, fileId: string | null): EditorSelection | null {
  const selection = local?.selection as RelativeSelection | undefined;
  if (!fileId || !selection?.anchor || !selection.head) return null;
  const ytext = textOf(doc, fileId);
  if (!ytext) return null;
  const anchor = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(selection.anchor), doc);
  const head = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(selection.head), doc);
  // A selection left behind in another file doesn't count.
  if (!anchor || !head || anchor.type !== ytext || head.type !== ytext || anchor.index === head.index) return null;
  const start = Math.min(anchor.index, head.index);
  const end = Math.max(anchor.index, head.index);
  const full = ytext.toString();
  const text = full.slice(start, end);
  if (!text.trim()) return null;
  const startLine = full.slice(0, start).split("\n").length;
  return { text, startLine, endLine: startLine + text.replace(/\n$/, "").split("\n").length - 1, start, end };
}

/** The selection's line range as a stable key, so the chip re-renders only when it changes. */
export function useSelectionRange(fileId: string | null): { startLine: number; endLine: number } | null {
  const { doc, provider } = useRoom();
  const awareness = provider.awareness!;
  const subscribe = useCallback(
    (onChange: () => void) => {
      awareness.on("change", onChange);
      doc.on("update", onChange);
      return () => {
        awareness.off("change", onChange);
        doc.off("update", onChange);
      };
    },
    [awareness, doc],
  );
  const range = useSyncExternalStore(
    subscribe,
    () => {
      const selection = readSelection(doc, awareness.getLocalState(), fileId);
      return selection ? `${selection.startLine}:${selection.endLine}` : "";
    },
    () => "",
  );
  if (!range) return null;
  const [startLine, endLine] = range.split(":").map(Number) as [number, number];
  return { startLine, endLine };
}
