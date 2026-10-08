"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

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
import { useEditorUi } from "./ui-store";

type Editor = monaco.editor.IStandaloneCodeEditor;

/**
 * What every Monaco editor in the room shares, whichever pane it sits in:
 * tell others which file and selection you are in (only from the pane you
 * last used), draw their carets and scrollbar marks, feed the status bar and
 * register the zen-mode chord. Returns a refresh for after theme changes.
 */
export function wireEditor(editor: Editor, role: PaneRole, provider: HocuspocusProvider) {
  const awareness = provider.awareness!;
  const doc = provider.document;
  liveEditors.add(editor);
  const unregister = registerPane(role, editor);
  const cursors = attachRemoteCursors(editor, doc, awareness);

  const announceFile = (source: Editor | null) => provider.setAwarenessField("activeFileId", modelOwner(source?.getModel() ?? null)?.fileId ?? null);
  const publishSelection = () => {
    if (!isActiveEditor(editor)) return;
    const model = editor.getModel();
    const owner = modelOwner(model);
    const selection = editor.getSelection();
    if (!model || !owner || !selection) return;
    const at = (line: number, column: number) => Y.createRelativePositionFromTypeIndex(owner.ytext, model.getOffsetAt({ lineNumber: line, column }));
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
    }),
    editor.onDidChangeCursorSelection(() => {
      publishSelection();
      refreshInfo();
    }),
    editor.onDidChangeModelOptions(refreshInfo),
    editor.onDidChangeModelLanguage(refreshInfo),
  ];

  editor.addAction({
    id: "cc.zen",
    label: "Toggle zen mode",
    keybindings: [monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyZ)],
    run: () => useEditorUi.getState().setZen(!useEditorUi.getState().zen),
  });

  return {
    refreshMarks: cursors.refresh,
    dispose: () => {
      const wasActive = getActiveEditor() === editor;
      listeners.forEach((l) => l.dispose());
      cursors.dispose();
      liveEditors.delete(editor);
      unregister();
      // Closing the pane you were in puts you back in the main editor, and so does your presence.
      if (wasActive) announceFile(getPrimaryEditor());
    },
  };
}
