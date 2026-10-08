"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { create } from "zustand";

export type PalettePage = "commands" | "language" | "people" | "line" | "symbols";

/** The one dialog that can be open over the editor at a time. */
export type Overlay =
  | { kind: "settings" }
  | { kind: "quickOpen" }
  | { kind: "palette"; page: PalettePage }
  | { kind: "pickFile"; title: string; exclude: string | null; onPick: (file: TreeNode) => void };

/**
 * Editor chrome that isn't a document: dialogs, layout modes and follow mode.
 * Not persisted; the workspace resets it when you enter another room.
 */
type State = {
  overlay: Overlay | null;
  zen: boolean;
  /** The file shown in the second editor on the right, if it is open. */
  splitFileId: string | null;
  diff: { leftId: string; rightId: string } | null;
  markdownPreview: boolean;
  /** User id of the person whose file and cursor this editor follows. */
  following: string | null;
  /** Language modes picked by hand, by file id. They last until you leave the room. */
  languageOverrides: Record<string, string>;
  open: (overlay: Overlay) => void;
  close: () => void;
  setZen: (on: boolean) => void;
  setSplit: (fileId: string | null) => void;
  setDiff: (diff: State["diff"]) => void;
  setMarkdownPreview: (on: boolean) => void;
  follow: (userId: string | null) => void;
  setLanguage: (fileId: string, language: string) => void;
  reset: () => void;
};

const INITIAL = {
  overlay: null,
  zen: false,
  splitFileId: null,
  diff: null,
  markdownPreview: false,
  following: null,
  languageOverrides: {},
} satisfies Partial<State>;

export const useEditorUi = create<State>()((set) => ({
  ...INITIAL,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  setZen: (zen) => set({ zen }),
  setSplit: (splitFileId) => set({ splitFileId }),
  setDiff: (diff) => set({ diff }),
  setMarkdownPreview: (markdownPreview) => set({ markdownPreview }),
  follow: (following) => set({ following }),
  setLanguage: (fileId, language) => set((s) => ({ languageOverrides: { ...s.languageOverrides, [fileId]: language } })),
  reset: () => set(INITIAL),
}));

export const openSettings = () => useEditorUi.getState().open({ kind: "settings" });
export const openQuickOpen = () => useEditorUi.getState().open({ kind: "quickOpen" });
export const openPalette = (page: PalettePage = "commands") => useEditorUi.getState().open({ kind: "palette", page });

/** Open the file on the right of the editor, or close the split if it's open. */
export function toggleSplit(activeFileId: string | null) {
  const ui = useEditorUi.getState();
  ui.setSplit(ui.splitFileId ? null : activeFileId);
}

export const toggleZen = () => {
  const ui = useEditorUi.getState();
  ui.setZen(!ui.zen);
};
