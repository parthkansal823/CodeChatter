"use client";

import { create } from "zustand";

import type { monaco } from "@/components/room/monaco-setup";

type Editor = monaco.editor.IStandaloneCodeEditor;

/** What the status bar shows about the editor you are working in. */
export type EditorInfo = {
  line: number;
  column: number;
  /** Characters in all selections (0 when nothing is selected). */
  selected: number;
  cursors: number;
  tabSize: number;
  insertSpaces: boolean;
  eol: "LF" | "CRLF";
  language: string;
};

/** The status bar's facts, and the editor they're about (the Outline view follows it). */
export const useEditorInfo = create<{ info: EditorInfo | null; editor: Editor | null }>()(() => ({ info: null, editor: null }));

export function readInfo(editor: Editor): EditorInfo | null {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return null;
  const selections = editor.getSelections() ?? [];
  const options = model.getOptions();
  return {
    line: position.lineNumber,
    column: position.column,
    selected: selections.reduce((sum, s) => sum + model.getValueLengthInRange(s), 0),
    cursors: Math.max(1, selections.length),
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
    language: model.getLanguageId(),
  };
}

// The pane you last focused is "the editor" for shortcuts, the status bar and what
// other people see you doing. The main editor is the default.
/** The main editor, the grid's others (split: right, split-below, split-below-right), and a comparison. */
export type PaneRole = "primary" | "split" | "split-below" | "split-below-right" | "diff";
const panes: Record<PaneRole, Editor | null> = { primary: null, split: null, "split-below": null, "split-below-right": null, diff: null };
let active: Editor | null = null;

export const getActiveEditor = (): Editor | null => active ?? panes.primary;
export const getPrimaryEditor = (): Editor | null => panes.primary;
export const isActiveEditor = (editor: Editor) => getActiveEditor() === editor;

export function setActiveEditor(editor: Editor | null) {
  active = editor;
  useEditorInfo.setState({ info: editor ? readInfo(editor) : null, editor: editor ?? panes.primary });
}

/** Register a pane's editor; the returned function unregisters it and hands "active" back to the main editor. */
export function registerPane(role: PaneRole, editor: Editor): () => void {
  panes[role] = editor;
  if (role === "primary" && !active) setActiveEditor(editor);
  return () => {
    if (panes[role] === editor) panes[role] = null;
    if (active === editor) setActiveEditor(panes.primary);
    else if (useEditorInfo.getState().editor === editor) useEditorInfo.setState({ editor: getActiveEditor() });
  };
}
