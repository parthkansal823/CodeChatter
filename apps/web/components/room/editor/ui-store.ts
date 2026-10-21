"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { create } from "zustand";

export type FilePreviewMode = "off" | "side" | "full";

/** Ctrl+K V and Ctrl+Shift+V: the same key again turns the preview off. */
export function toggleFilePreview(mode: Exclude<FilePreviewMode, "off">) {
  const ui = useEditorUi.getState();
  ui.setFilePreview(ui.filePreview === mode ? "off" : mode);
}

export type PalettePage = "commands" | "language" | "people" | "line" | "symbols" | "snippets";

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
  /** The file shown in the second editor on the right, if it is open (the grid's "right" slot). */
  splitFileId: string | null;
  /** The grid's other editors: below the main one, and below the right one. */
  splitBelowId: string | null;
  splitBelowRightId: string | null;
  diff: { leftId: string; rightId: string } | null;
  /** A path compared with the room's GitHub base (source-control/repo-diff-view.tsx), in place of the editor. */
  repoDiff: string | null;
  /** A pull request of the room's repository, reviewed in place of the editor (source-control/pull-request-view.tsx). */
  pullRequest: number | null;
  /** A Markdown, CSV or SVG file's preview (preview-kind.ts): off, beside the code (Ctrl+K V), or on its own (Ctrl+Shift+V). */
  filePreview: FilePreviewMode;
  /** User id of the person whose file and cursor this editor follows. */
  following: string | null;
  /** Language modes picked by hand, by file id. They last until you leave the room. */
  languageOverrides: Record<string, string>;
  open: (overlay: Overlay) => void;
  close: () => void;
  setZen: (on: boolean) => void;
  setSplit: (fileId: string | null) => void;
  setSplitSlot: (slot: SplitSlot, fileId: string | null) => void;
  setDiff: (diff: State["diff"]) => void;
  setRepoDiff: (path: string | null) => void;
  setPullRequest: (number: number | null) => void;
  setFilePreview: (mode: FilePreviewMode) => void;
  follow: (userId: string | null) => void;
  setLanguage: (fileId: string, language: string) => void;
  reset: () => void;
};

const INITIAL = {
  overlay: null,
  zen: false,
  splitFileId: null,
  splitBelowId: null,
  splitBelowRightId: null,
  diff: null,
  repoDiff: null,
  pullRequest: null,
  filePreview: "off" as FilePreviewMode,
  following: null,
  languageOverrides: {},
} satisfies Partial<State>;

export const useEditorUi = create<State>()((set) => ({
  ...INITIAL,
  open: (overlay) => set({ overlay }),
  close: () => set({ overlay: null }),
  setZen: (zen) => set({ zen }),
  setSplit: (splitFileId) => set({ splitFileId }),
  setSplitSlot: (slot, fileId) =>
    set(
      slot === "right"
        ? { splitFileId: fileId }
        : slot === "below"
          ? { splitBelowId: fileId }
          : { splitBelowRightId: fileId },
    ),
  setDiff: (diff) => set({ diff }),
  setRepoDiff: (repoDiff) => set({ repoDiff, pullRequest: null }),
  setPullRequest: (pullRequest) => set({ pullRequest, repoDiff: null }),
  setFilePreview: (filePreview) => set({ filePreview }),
  follow: (following) => set({ following }),
  setLanguage: (fileId, language) =>
    set((s) => ({ languageOverrides: { ...s.languageOverrides, [fileId]: language } })),
  reset: () => set(INITIAL),
}));

export const openSettings = () => useEditorUi.getState().open({ kind: "settings" });
export const openQuickOpen = () => useEditorUi.getState().open({ kind: "quickOpen" });
export const openPalette = (page: PalettePage = "commands") =>
  useEditorUi.getState().open({ kind: "palette", page });

/** Open the file on the right of the editor, or close the split if it's open. */
export function toggleSplit(activeFileId: string | null) {
  const ui = useEditorUi.getState();
  ui.setSplit(ui.splitFileId ? null : activeFileId);
}

/**
 * The editor grid (up to four, as VS Code splits them): the main editor, one on its right,
 * one below it, and one below the right one. Each shows any file.
 */
export type SplitSlot = "right" | "below" | "belowRight";

/** Split down: below the main editor first, then below the right one; a full grid replaces the one below. */
export function splitDown(activeFileId: string | null) {
  if (!activeFileId) return;
  const ui = useEditorUi.getState();
  if (!ui.splitBelowId) ui.setSplitSlot("below", activeFileId);
  else if (ui.splitFileId && !ui.splitBelowRightId) ui.setSplitSlot("belowRight", activeFileId);
  else ui.setSplitSlot("below", activeFileId);
}

/** Back to one editor. */
export function closeSplits() {
  const ui = useEditorUi.getState();
  for (const slot of ["right", "below", "belowRight"] as const) ui.setSplitSlot(slot, null);
}

export const toggleZen = () => {
  const ui = useEditorUi.getState();
  ui.setZen(!ui.zen);
};
