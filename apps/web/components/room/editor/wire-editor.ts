"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import { attachBreakpoints } from "@/components/room/debug/breakpoint-gutter";
import { monaco } from "@/components/room/monaco-setup";

import {
  getActiveEditor,
  getPrimaryEditor,
  isActiveEditor,
  readInfo,
  registerPane,
  setActiveEditor,
  useEditorInfo,
  type PaneRole,
} from "./active-editor";
import { liveEditors, modelOwner } from "./file-models";
import { attachRemoteCursors } from "./remote-cursors";
import { applyPendingReveal } from "./reveal";
import { bindEditorChords } from "./shortcuts";

type Editor = monaco.editor.IStandaloneCodeEditor;

/**
 * What every Monaco editor in the room shares, whichever pane it sits in:
 * tell others which file and selection you are in (only from the pane you
 * last used), draw their carets and scrollbar marks, feed the status bar and
 * register our chords (Ctrl+K Z…), and show the room's breakpoints. Returns a refresh for
 * after theme changes.
 */
export function wireEditor(editor: Editor, role: PaneRole, provider: HocuspocusProvider) {
  const awareness = provider.awareness!;
  const doc = provider.document;
  liveEditors.add(editor);
  const unregister = registerPane(role, editor);
  const cursors = attachRemoteCursors(editor, doc, awareness);
  const breakpoints = attachBreakpoints(editor, doc);

  const announceFile = (source: Editor | null) =>
    provider.setAwarenessField("activeFileId", modelOwner(source?.getModel() ?? null)?.fileId ?? null);
  const publishSelection = () => {
    if (!isActiveEditor(editor)) return;
    const model = editor.getModel();
    const owner = modelOwner(model);
    const selection = editor.getSelection();
    if (!model || !owner || !selection) return;
    const at = (line: number, column: number) =>
      Y.createRelativePositionFromTypeIndex(owner.ytext, model.getOffsetAt({ lineNumber: line, column }));
    awareness.setLocalStateField("selection", {
      anchor: at(selection.selectionStartLineNumber, selection.selectionStartColumn),
      head: at(selection.positionLineNumber, selection.positionColumn),
    });
  };
  const refreshInfo = () => {
    if (isActiveEditor(editor)) useEditorInfo.setState({ info: readInfo(editor) });
  };

  const listeners = [
    editor.onDidFocusEditorText(() => {
      setActiveEditor(editor);
      announceFile(editor);
      publishSelection();
    }),
    editor.onDidChangeModel(() => {
      if (isActiveEditor(editor)) announceFile(editor);
      publishSelection();
      refreshInfo();
      // A search result opening this file: select the match once the file's saved place is restored.
      if (role === "primary") queueMicrotask(() => applyPendingReveal(editor));
    }),
    editor.onDidChangeCursorSelection(() => {
      publishSelection();
      refreshInfo();
    }),
    editor.onDidChangeModelOptions(refreshInfo),
    editor.onDidChangeModelLanguage(refreshInfo),
  ];

  // Our chords (Ctrl+K Z, Ctrl+K V…), kept up with your shortcuts: Monaco owns chords in here.
  listeners.push(bindEditorChords(editor));

  return {
    refreshMarks: cursors.refresh,
    dispose: () => {
      const wasActive = getActiveEditor() === editor;
      listeners.forEach((l) => l.dispose());
      cursors.dispose();
      breakpoints.dispose();
      liveEditors.delete(editor);
      unregister();
      // Closing the pane you were in puts you back in the main editor, and so does your presence.
      if (wasActive) announceFile(getPrimaryEditor());
    },
  };
}
