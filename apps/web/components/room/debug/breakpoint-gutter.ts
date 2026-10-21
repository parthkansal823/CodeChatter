"use client";

import { breakpointLines, breakpointMap, pathOf, toggleBreakpoint } from "@codechatter/workspace-model";
import type * as Y from "yjs";

import { modelOwner } from "@/components/room/editor/file-models";
import { monaco } from "@/components/room/monaco-setup";

import "./debug.css";
import { useDebug } from "./debug-store";

type Editor = monaco.editor.IStandaloneCodeEditor;

/**
 * Breakpoints in an editor's gutter, as in VS Code: click left of a line number (or F9)
 * to set or clear one, for everyone in the room (they're in the files document); a faint
 * dot shows where a click would put one; while the debugger is paused, the line it's on
 * is marked.
 */
export function attachBreakpoints(editor: Editor, doc: Y.Doc): { dispose: () => void } {
  editor.updateOptions({ glyphMargin: true });
  const marks = editor.createDecorationsCollection();
  const hint = editor.createDecorationsCollection();
  let frame = 0;

  const fileOf = () => modelOwner(editor.getModel());
  const editable = () => !editor.getOption(monaco.editor.EditorOption.readOnly);

  const draw = () => {
    frame = 0;
    const owner = fileOf();
    if (!owner) return marks.clear();
    const decorations: monaco.editor.IModelDeltaDecoration[] = breakpointLines(doc, owner.fileId).map(
      (line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: "cc-breakpoint",
          glyphMarginHoverMessage: { value: "Breakpoint (click to remove)" },
          stickiness: 1,
        },
      }),
    );
    const { frames, frameId } = useDebug.getState();
    const current = frames.find((f) => f.id === frameId);
    const path = pathOf(doc, owner.fileId);
    if (current && current.path === path) {
      decorations.push({
        range: new monaco.Range(current.line, 1, current.line, 1),
        options: {
          isWholeLine: true,
          className: "cc-debug-line",
          glyphMarginClassName: "cc-debug-arrow",
          glyphMarginHoverMessage: { value: "Paused here" },
        },
      });
    }
    marks.set(decorations);
  };
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const toggleAt = (line: number) => {
    const owner = fileOf();
    if (owner && editable()) toggleBreakpoint(doc, owner.fileId, line);
  };
  const glyph = monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN;
  const listeners = [
    editor.onDidChangeModel(redraw),
    editor.onDidChangeModelContent(redraw),
    editor.onMouseDown((event) => {
      if (event.target.type === glyph && event.target.position) toggleAt(event.target.position.lineNumber);
    }),
    editor.onMouseMove((event) => {
      const line = event.target.type === glyph && editable() ? event.target.position?.lineNumber : undefined;
      hint.set(
        line
          ? [
              {
                range: new monaco.Range(line, 1, line, 1),
                options: { glyphMarginClassName: "cc-breakpoint-hint" },
              },
            ]
          : [],
      );
    }),
    editor.onMouseLeave(() => hint.clear()),
    editor.addAction({
      id: "cc.toggleBreakpoint",
      label: "Toggle breakpoint",
      keybindings: [monaco.KeyCode.F9],
      run: () => {
        const line = editor.getPosition()?.lineNumber;
        if (line) toggleAt(line);
      },
    }),
  ];
  const map = breakpointMap(doc);
  map.observeDeep(redraw);
  const stopWatching = useDebug.subscribe((state, before) => {
    if (state.frameId !== before.frameId || state.frames !== before.frames) redraw();
  });
  draw();
  return {
    dispose: () => {
      if (frame) cancelAnimationFrame(frame);
      listeners.forEach((l) => l.dispose());
      map.unobserveDeep(redraw);
      stopWatching();
      marks.clear();
      hint.clear();
    },
  };
}
