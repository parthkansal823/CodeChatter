"use client";

import { textOf } from "@codechatter/workspace-model";
import { toast } from "sonner";
import * as Y from "yjs";

import type { Edit } from "./search";

/**
 * Make a replace's edits in one Yjs transaction, so everyone in the room sees
 * it land at once. Each match is its own small edit, so people typing
 * elsewhere in those files keep their cursors and keystrokes. The toast offers
 * Undo for ten seconds, which reverses exactly this change (like the AI's
 * edits), whatever anyone typed since.
 */
export function applyReplace(doc: Y.Doc, plan: Array<{ id: string; edits: Edit[] }>, label: string) {
  const texts = plan.flatMap((file) => textOf(doc, file.id) ?? []);
  if (texts.length === 0) return;
  // An origin of its own, so this Undo can't pick up another replace's edits.
  const origin = { replace: label };
  const undo = new Y.UndoManager(texts, { trackedOrigins: new Set([origin]), captureTimeout: 0 });
  doc.transact(() => {
    for (const file of plan) {
      const text = textOf(doc, file.id);
      if (!text) continue;
      // From the end, so the offsets of the edits before each one still hold.
      for (let i = file.edits.length - 1; i >= 0; i--) {
        const edit = file.edits[i]!;
        text.delete(edit.index, edit.length);
        if (edit.text) text.insert(edit.index, edit.text);
      }
    }
  }, origin);
  toast.success(label, {
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: () => {
        if (!undo.canUndo()) return void toast.error("Nothing left to undo.");
        undo.undo();
        toast("Replace undone");
      },
    },
    onDismiss: () => undo.destroy(),
    onAutoClose: () => undo.destroy(),
  });
}
