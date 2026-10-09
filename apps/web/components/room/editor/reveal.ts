"use client";

import { monaco } from "@/components/room/monaco-setup";

import { getPrimaryEditor } from "./active-editor";
import { modelOwner } from "./file-models";
import { useEditorUi } from "./ui-store";

type Editor = monaco.editor.IStandaloneCodeEditor;

/** A range to select, 1-based as the editor counts. */
export type RevealRange = { startLine: number; startColumn: number; endLine: number; endColumn: number };

let pending: { fileId: string; range: RevealRange; until: number } | null = null;

/**
 * Select a range in a file in the main editor and scroll to it, as Go to line
 * does: for a search result, say. Open the file first (the workspace's
 * openFile); if the main editor isn't showing it yet, the selection lands as
 * soon as it does, after the file's saved place is restored.
 */
export function revealInFile(file: { id: string; name: string }, range: RevealRange) {
  // A comparison or a Markdown file's full preview would hide the editor it lands in.
  const ui = useEditorUi.getState();
  if (ui.diff) ui.setDiff(null);
  if (ui.markdownPreview === "full" && /\.(md|markdown)$/i.test(file.name)) ui.setMarkdownPreview("off");
  pending = { fileId: file.id, range, until: Date.now() + 5000 };
  const editor = getPrimaryEditor();
  if (editor) applyPendingReveal(editor);
}

/** wire-editor calls this when the main editor shows another file. */
export function applyPendingReveal(editor: Editor) {
  if (!pending) return;
  if (Date.now() > pending.until) {
    pending = null;
    return;
  }
  if (modelOwner(editor.getModel())?.fileId !== pending.fileId) return;
  const { startLine, startColumn, endLine, endColumn } = pending.range;
  pending = null;
  const selection = new monaco.Selection(startLine, startColumn, endLine, endColumn);
  editor.setSelection(selection);
  editor.revealRangeInCenterIfOutsideViewport(selection);
  editor.focus();
}
