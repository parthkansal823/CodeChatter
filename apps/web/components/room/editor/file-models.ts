"use client";

import { languageFor, textOf } from "@codechatter/workspace-model";
import { MonacoBinding } from "y-monaco";
import type * as Y from "yjs";

import { monaco, registerWorkspaceFile } from "@/components/room/monaco-setup";

type Editor = monaco.editor.IStandaloneCodeEditor;
type Model = monaco.editor.ITextModel;

/**
 * Every editor on the page. y-monaco keeps each one's selection steady while a
 * remote edit lands in the shared model (it reads this set at that moment).
 */
export const liveEditors = new Set<Editor>();

type Entry = { model: Model; ytext: Y.Text; refs: number; alive: boolean; destroy: () => void };
const entries = new Map<string, Entry>();
const owners = new WeakMap<Model, { ytext: Y.Text; fileId: string }>();

/** The Y.Text and file id behind a Monaco model, for models made here. */
export const modelOwner = (model: Model | null) => (model ? owners.get(model) : undefined);

export type FileRef = { id: string; path: string; name: string };
export type ModelHandle = { model: Model; ytext: Y.Text; release: () => void };

const uriFor = (path: string) => monaco.Uri.parse(`file:///workspace/${path.split("/").map(encodeURIComponent).join("/")}`);

/**
 * One Monaco model per file path, shared by every editor that shows the file
 * (the main editor, the split, a diff) and bound to the file's Y.Text once.
 * Models live at file:///workspace/<path> so the TypeScript worker can
 * resolve imports between open files. The last release disposes the model.
 */
export function acquireModel(doc: Y.Doc, file: FileRef, language?: string): ModelHandle | null {
  const ytext = textOf(doc, file.id);
  if (!ytext) return null;
  const uri = uriFor(file.path);
  const key = uri.toString();
  let entry = entries.get(key);
  // The path now belongs to another file (deleted, then created again): drop the old model.
  if (entry && entry.ytext !== ytext) {
    entry.destroy();
    entry = undefined;
  }
  if (!entry) {
    monaco.editor.getModel(uri)?.dispose(); // left over from a hot reload
    const mirror = registerWorkspaceFile(uri, ytext.toString());
    const model = monaco.editor.createModel("", language ?? languageFor(file.name), uri);
    // No awareness here: remote carets and the local selection are handled per editor
    // (remote-cursors.ts), because one model can be open in two editors at once.
    const binding = new MonacoBinding(ytext, model, liveEditors);
    const created: Entry = {
      model,
      ytext,
      refs: 0,
      alive: true,
      destroy: () => {
        if (!created.alive) return;
        created.alive = false;
        binding.destroy();
        model.dispose();
        mirror.dispose();
        if (entries.get(key) === created) entries.delete(key);
      },
    };
    owners.set(model, { ytext, fileId: file.id });
    entries.set(key, created);
    entry = created;
  }
  const held = entry;
  held.refs += 1;
  let released = false;
  return {
    model: held.model,
    ytext: held.ytext,
    release: () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      if (held.refs <= 0) held.destroy();
    },
  };
}

/** Scroll position, cursor and folds per pane and file, so switching tabs doesn't lose your place. */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
export const saveViewState = (pane: string, fileId: string, editor: Editor) => {
  const state = editor.saveViewState();
  if (state) viewStates.set(`${pane}:${fileId}`, state);
};
export const restoreViewState = (pane: string, fileId: string, editor: Editor) => {
  const state = viewStates.get(`${pane}:${fileId}`);
  if (state) editor.restoreViewState(state);
};
