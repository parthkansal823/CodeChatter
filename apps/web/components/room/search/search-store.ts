"use client";

import { create } from "zustand";

import { getActiveEditor } from "@/components/room/editor/active-editor";

import { escapeRegExp, type SearchOptions } from "./search";

type Field = "search" | "replace";

/**
 * The Search view's fields, kept while you switch to the file list and back.
 * Not persisted; another room starts empty.
 */
type State = SearchOptions & {
  roomId: string | null;
  replace: string;
  showReplace: boolean;
  showFilters: boolean;
  /** A box to put the cursor in when the view opens; the view clears it once done. */
  focus: Field | null;
  set: (patch: Partial<Omit<State, "set">>) => void;
};

const EMPTY = {
  query: "",
  matchCase: false,
  wholeWord: false,
  regex: false,
  include: "",
  exclude: "",
  replace: "",
  showReplace: false,
  showFilters: false,
  focus: null,
} satisfies Partial<State>;

export const useSearch = create<State>()((set) => ({
  ...EMPTY,
  roomId: null,
  set: (patch) => set(patch),
}));

/**
 * Open the view with the cursor in the search box. Ctrl+Shift+F (`seed`) starts
 * from the editor's selection, one line of it, as VS Code does. With `replace`,
 * the replace box opens too, and takes the cursor when there's a search already.
 */
export function startSearch(roomId: string, { seed = false, replace = false } = {}) {
  if (useSearch.getState().roomId !== roomId) useSearch.setState({ ...EMPTY, roomId });
  const state = useSearch.getState();
  const inView = document.activeElement?.closest("[data-search-view]");
  const selected = seed && !inView ? selectedText() : null;
  const query = selected === null ? state.query : state.regex ? escapeRegExp(selected) : selected;
  state.set({
    query,
    showReplace: replace || state.showReplace,
    focus: replace && query ? "replace" : "search",
  });
}

function selectedText(): string | null {
  const editor = getActiveEditor();
  const model = editor?.getModel();
  const selection = editor?.getSelection();
  if (!model || !selection || selection.isEmpty() || selection.startLineNumber !== selection.endLineNumber)
    return null;
  return model.getValueInRange(selection);
}
