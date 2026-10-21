"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { MonacoBinding } from "y-monaco";
import type * as Y from "yjs";

import { monacoOptions } from "@/components/room/editor/settings";
import { currentSettings, useSettingsValues } from "@/components/room/editor/settings-store";
import { editorThemeId } from "@/components/room/editor/themes";
import { ensureMonaco, monaco, registerWorkspaceFile } from "@/components/room/monaco-setup";

export type CellKeys = {
  /** Shift+Enter: run, then go to the next cell. */
  runAndNext: () => void;
  /** Ctrl+Enter: run and stay. */
  run: () => void;
  /** Alt+Enter: run, then add a cell below. */
  runAndInsert: () => void;
  /** Arrow up on the first line, or down on the last: the cell above or below. */
  leave: (direction: -1 | 1) => void;
};

type Props = {
  /** Unique on the page: the notebook's file id and the cell's id. */
  address: string;
  source: Y.Text;
  language: string;
  readOnly: boolean;
  /** Focus this cell's editor whenever this goes up (a new cell, or moving between cells); 0 never. */
  focusToken: number;
  keys: CellKeys;
  onFocus: () => void;
  label: string;
};

/** One cell's source in a small Monaco editor that grows with its text, bound to the cell's Y.Text. */
export function CellEditor({ address, source, language, readOnly, focusToken, keys, onFocus, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [height, setHeight] = useState(() => Math.max(1, source.toString().split("\n").length) * lineHeight() + 16);
  const [ready, setReady] = useState(false);
  const { resolvedTheme } = useTheme();
  const settings = useSettingsValues();
  const themeSetting = settings.editorTheme;
  // The latest handlers, read when a key is pressed (the editor is made once).
  const latest = useRef({ keys, onFocus });
  useEffect(() => {
    latest.current = { keys, onFocus };
  });

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void ensureMonaco().then(() => {
      if (disposed || !host.current) return;
      const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-neon").trim();
      // A registered file:// address, as the room's files have. VS Code's services take over an
      // anonymous in-memory model when its editor gets focus and dispose of it when they let go,
      // which blanked the cell (it showed when a notebook was the first editor on the page).
      const uri = monaco.Uri.parse(`file:///notebook-cells/${encodeURIComponent(address)}`);
      monaco.editor.getModel(uri)?.dispose(); // left over from a hot reload
      const mirror = registerWorkspaceFile(uri, source.toString());
      const model = monaco.editor.createModel("", language, uri);
      const editor = monaco.editor.create(host.current, {
        model,
        ...monacoOptions(currentSettings()),
        ...CELL_OPTIONS,
        fontFamily: `${fontFamily}, ui-monospace, monospace`,
        readOnly,
        readOnlyMessage: { value: "You can view this room but not edit it. Ask the owner for editor access." },
        ariaLabel: label,
        theme: editorThemeId(document.documentElement.classList.contains("dark")),
      });
      const binding = new MonacoBinding(source, model, new Set([editor]));
      // Cells are \n, like every file in the room (an empty model takes the OS's ending).
      if (model.getEOL() === "\r\n" && !source.toString().includes("\r\n")) model.setEOL(monaco.editor.EndOfLineSequence.LF);
      editorRef.current = editor;

      const resize = () => {
        const next = Math.min(editor.getContentHeight(), 2000);
        setHeight(next);
        editor.layout({ width: host.current?.clientWidth ?? 0, height: next });
      };
      const atEdge = (direction: -1 | 1) => {
        const position = editor.getPosition();
        if (!position) return false;
        return direction === -1 ? position.lineNumber === 1 : position.lineNumber === model.getLineCount();
      };
      const listeners = [
        editor.onDidContentSizeChange(resize),
        editor.onDidFocusEditorText(() => latest.current.onFocus()),
        editor.onKeyDown((event) => {
          // Ctrl+Enter belongs to the notebook here (the root is data-own-run-key).
          const enter = event.keyCode === monaco.KeyCode.Enter;
          if (enter && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            latest.current.keys.runAndNext();
          } else if (enter && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            latest.current.keys.run();
          } else if (enter && event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            latest.current.keys.runAndInsert();
          } else if ((event.keyCode === monaco.KeyCode.UpArrow || event.keyCode === monaco.KeyCode.DownArrow) && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
            const direction = event.keyCode === monaco.KeyCode.UpArrow ? -1 : 1;
            // Only with no suggestion list open, which arrows move through instead.
            const suggesting = host.current?.querySelector(".suggest-widget.visible");
            if (atEdge(direction) && !suggesting) {
              event.preventDefault();
              event.stopPropagation();
              latest.current.keys.leave(direction);
            }
          }
        }),
      ];
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      resize();
      setReady(true);
      cleanup = () => {
        observer.disconnect();
        for (const listener of listeners) listener.dispose();
        binding.destroy();
        editor.dispose();
        model.dispose();
        mirror.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup();
      editorRef.current = null;
    };
    // The editor is made once per cell; language and read-only follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (ready && model && model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
  }, [language, ready]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly, ready]);

  useEffect(() => {
    if (ready) monaco.editor.setTheme(editorThemeId(resolvedTheme === "dark", themeSetting));
  }, [ready, resolvedTheme, themeSetting]);

  useEffect(() => {
    editorRef.current?.updateOptions({ ...monacoOptions(settings), ...CELL_OPTIONS });
  }, [settings, ready]);

  useEffect(() => {
    if (ready && focusToken > 0) editorRef.current?.focus();
  }, [focusToken, ready]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={host} className="absolute inset-0" />
    </div>
  );
}

function lineHeight(): number {
  return Math.round(currentSettings().fontSize * 1.6);
}

/** What a cell turns off from the room's editor settings: it's a few lines inside a scrolling page. */
const CELL_OPTIONS: monaco.editor.IEditorOptions = {
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  folding: false,
  glyphMargin: false,
  lineNumbersMinChars: 3,
  lineDecorationsWidth: 8,
  renderLineHighlight: "none",
  padding: { top: 8, bottom: 8 },
  scrollbar: { vertical: "hidden", horizontal: "auto", alwaysConsumeMouseWheel: false, horizontalScrollbarSize: 8 },
  fixedOverflowWidgets: true,
  contextmenu: true,
};
