"use client";

import { toast } from "sonner";

import { monaco } from "@/components/room/monaco-setup";

import { getActiveEditor } from "./active-editor";
import { languageLabel } from "./languages";

/**
 * Format the file in the editor you last used with Monaco's formatter for its
 * language. Languages without one get a plain message instead of nothing.
 * Resolves true when a formatter ran.
 */
export async function formatDocument(options: { quiet?: boolean } = {}): Promise<boolean> {
  const editor = getActiveEditor();
  const model = editor?.getModel();
  if (!editor || !model) return false;
  if (editor.getOption(monaco.editor.EditorOption.readOnly)) {
    if (!options.quiet) toast.message("This file is read only, so it can't be formatted.");
    return false;
  }
  const action = editor.getAction("editor.action.formatDocument");
  if (!action?.isSupported()) {
    if (!options.quiet) toast.message(`No formatter for ${languageLabel(model.getLanguageId())} yet`);
    return false;
  }
  await action.run();
  return true;
}
