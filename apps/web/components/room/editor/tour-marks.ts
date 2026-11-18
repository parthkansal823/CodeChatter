/** Connect each Monaco pane to tour creation and the local player's marked lines. */
"use client";

import { captureTourStop } from "@codechatter/workspace-model";
import type * as Y from "yjs";
import { monaco } from "@/components/room/monaco-setup";
import { requestAddTourStop, useToursPlayback } from "@/components/room/tools/tours/local-store";

import { modelOwner } from "./file-models";

/** Uses the pane's stable file ID and selection; playback stays local to this browser. */
export function attachTourMarks(
  editor: monaco.editor.IStandaloneCodeEditor,
  roomId: string,
  filesDoc: Y.Doc,
) {
  const marks = editor.createDecorationsCollection();
  const draw = () => {
    const mark = useToursPlayback.getState().byRoom[roomId]?.mark;
    const model = editor.getModel();
    if (!model || !mark || modelOwner(model)?.fileId !== mark.fileId) return marks.clear();
    marks.set([
      {
        range: new monaco.Range(mark.startLine, 1, mark.endLine, model.getLineMaxColumn(mark.endLine)),
        options: {
          isWholeLine: true,
          className: "cc-tour-line bg-brand/15",
          linesDecorationsClassName: "border-l-2 border-brand",
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage: { value: "Current tour stop" },
        },
      },
    ]);
  };
  const action = editor.addAction({
    id: "cc.addTourStop",
    label: "Add this line to a tour",
    precondition: "!editorReadonly",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 4,
    run: () => {
      const owner = modelOwner(editor.getModel());
      const selection = editor.getSelection();
      if (!owner || !selection || editor.getOption(monaco.editor.EditorOption.readOnly)) return;
      // Ending at column 1 selects no characters of that final line.
      const endLine =
        selection.endLineNumber > selection.startLineNumber && selection.endColumn === 1
          ? selection.endLineNumber - 1
          : selection.endLineNumber;
      const anchor = captureTourStop(filesDoc, owner.fileId, selection.startLineNumber, endLine);
      if (anchor)
        requestAddTourStop({
          roomId,
          fileId: owner.fileId,
          startLine: selection.startLineNumber,
          endLine,
          anchor,
        });
    },
  });
  const model = editor.onDidChangeModel(draw);
  const unsubscribe = useToursPlayback.subscribe(draw);
  draw();
  return {
    dispose: () => {
      action.dispose();
      model.dispose();
      unsubscribe();
      marks.clear();
    },
  };
}
