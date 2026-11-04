"use client";

import { allCommentThreads, commentThreadsMap, flatten, listTree, maps, type CommentThread } from "@codechatter/workspace-model";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";

import { useRoom } from "@/components/room/room-context";

/**
 * Your view of the room's comment threads (not shared): which ones are open in the
 * editor, the comment you're starting, and a thread to bring into view.
 */
type State = {
  /** Open or folded by you, by thread id; otherwise open unless resolved. */
  open: Record<string, boolean>;
  /** A new thread being written: the file and the code it's on. */
  draft: { fileId: string; from: number; to: number } | null;
  /** A thread to scroll to (the Comments view asked), once. */
  focus: string | null;
  setOpen: (id: string, open: boolean) => void;
  startDraft: (draft: { fileId: string; from: number; to: number }) => void;
  cancelDraft: () => void;
  focusThread: (id: string | null) => void;
};

export const useCommentsUi = create<State>()((set) => ({
  open: {},
  draft: null,
  focus: null,
  setOpen: (id, open) => set((state) => ({ open: { ...state.open, [id]: open } })),
  startDraft: (draft) => set({ draft }),
  cancelDraft: () => set({ draft: null }),
  focusThread: (focus) => set((state) => (focus ? { focus, open: { ...state.open, [focus]: true } } : { focus })),
}));

export const isThreadOpen = (thread: CommentThread, open: Record<string, boolean>) => open[thread.id] ?? !thread.resolved;

/** The room's comment threads, oldest first, kept current. */
export function useCommentThreads(): CommentThread[] {
  const { comments } = useRoom();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const map = commentThreadsMap(comments);
      const handler = () => {
        version.current += 1;
        onChange();
      };
      map.observeDeep(handler);
      return () => map.unobserveDeep(handler);
    },
    [comments],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is the change signal
  return useMemo(() => allCommentThreads(comments), [comments, tick]);
}

/** Each file's path by id, kept current through renames and moves. */
export function useFilePaths(): Map<string, string> {
  const { doc } = useRoom();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const nodes = maps(doc).nodes;
      const handler = () => {
        version.current += 1;
        onChange();
      };
      nodes.observeDeep(handler);
      return () => nodes.unobserveDeep(handler);
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  return useMemo(
    () => new Map(flatten(listTree(doc)).filter((node) => node.kind === "file").map((node) => [node.id, node.path])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is the change signal
    [doc, tick],
  );
}
