"use client";

import { useEffect, useState } from "react";

import { monaco } from "@/components/room/monaco-setup";

import { modelOwner } from "./file-models";
import { getSymbols, type SymbolItem } from "./symbols";

type Editor = monaco.editor.IStandaloneCodeEditor;

/** How long typing settles before the outline is read again. */
const REFRESH_MS = 300;

export type Outline = {
  /** null while reading, or for a language without an outline. */
  symbols: SymbolItem[] | null;
  /** False for a language with no outline at all. */
  supported: boolean;
  /** The cursor, as an offset into the file. */
  offset: number | null;
  /** The file it's about: its name, when it's one of the room's files. */
  file: string | null;
};

const EMPTY: Outline = { symbols: null, supported: true, offset: null, file: null };

/** The symbols of whatever file `editor` shows, kept current as anyone types, and where its cursor is. */
export function useOutline(editor: Editor | null): Outline {
  const [state, setState] = useState<Outline>(EMPTY);

  useEffect(() => {
    if (!editor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no editor: nothing to read
      setState(EMPTY);
      return;
    }
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cursor = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      return model && position ? model.getOffsetAt(position) : null;
    };
    const read = () => {
      const model = editor.getModel();
      const mine = ++version;
      if (!model) return setState(EMPTY);
      const file = modelOwner(model) ? decodeURIComponent(model.uri.path.split("/").pop() ?? "") : null;
      void getSymbols(model)
        .then((symbols) => {
          if (mine === version) setState({ symbols, supported: symbols !== null, offset: cursor(), file });
        })
        // The model went away while the worker read it: the next read has it.
        .catch(() => {});
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, REFRESH_MS);
    };
    read();
    const listeners = [
      editor.onDidChangeModel(read),
      editor.onDidChangeModelLanguage(read),
      editor.onDidChangeModelContent(later),
      editor.onDidChangeCursorPosition(() => setState((prev) => ({ ...prev, offset: cursor() }))),
    ];
    return () => {
      version += 1;
      if (timer) clearTimeout(timer);
      for (const listener of listeners) listener.dispose();
    };
  }, [editor]);

  return state;
}

/** Put the cursor at a symbol's start in `editor`, scrolled to the middle, and focus it. */
export function revealSymbol(editor: Editor, symbol: SymbolItem): void {
  const model = editor.getModel();
  if (!model) return;
  const start = model.getPositionAt(symbol.start);
  editor.setSelection(monaco.Selection.fromPositions(start, start));
  editor.revealLineInCenterIfOutsideViewport(start.lineNumber);
  editor.focus();
}
