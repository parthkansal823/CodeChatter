/** Shared group actions keep the same shortcuts, feedback and permission state on Design and Whiteboard. */
"use client";

import { Group, Ungroup } from "lucide-react";
import { toast } from "sonner";

import { ToolButton } from "./chrome";
import type { Editor } from "./editor";
import { useAllShapes, useAtom, useEditor } from "./hooks";
import { effectiveLocked, topLevelIds } from "./tree";

/** Grouping failure is visible, including selections from different frames or groups. */
export function groupWithFeedback(editor: Editor) {
  const error = editor.groupingError();
  if (error) { toast.error(error); return; }
  editor.groupSelection();
}

export function GroupControls() {
  const editor = useEditor();
  const ids = useAtom(editor.selection);
  const readOnly = useAtom(editor.readOnly);
  const shapes = useAllShapes(editor);
  const canUngroup = ids.some((id) => shapes.get(id)?.type === "group" && !effectiveLocked(shapes, id));
  return <div role="group" aria-label="Grouping" className="flex items-center gap-0.5">
    <ToolButton label="Group selection" shortcut="Ctrl+G" disabled={readOnly || topLevelIds(shapes, ids).length < 2} onClick={() => groupWithFeedback(editor)}><Group /></ToolButton>
    <ToolButton label="Ungroup selection" shortcut="Ctrl+Shift+G" disabled={readOnly || !canUngroup} onClick={() => editor.ungroupSelection()}><Ungroup /></ToolButton>
  </div>;
}
