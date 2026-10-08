"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

import type { Atom } from "./atom";
import type { Editor } from "./editor";
import type { CanvasSession } from "./session";
import type { Shape } from "./shape";

export const SessionContext = createContext<CanvasSession | null>(null);

export function useSession(): CanvasSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a canvas");
  return session;
}

export const useEditor = (): Editor => useSession().editor;

export function useAtom<T>(atom: Atom<T>): T {
  return useSyncExternalStore(atom.subscribe, atom.get, atom.get);
}

/** One shape; re-renders only when that shape changes. */
export function useShape(editor: Editor, id: string | null): Shape | undefined {
  const subscribe = useCallback((listener: () => void) => (id ? editor.store.subscribeShape(id, listener) : () => {}), [editor, id]);
  const get = () => (id ? editor.store.get(id) : undefined);
  return useSyncExternalStore(subscribe, get, get);
}

/** A frame's children (null: the canvas), in stacking order; re-renders on structure changes only. */
export function useChildIds(editor: Editor, parentId: string | null): string[] {
  const get = () => editor.store.childIds(parentId);
  return useSyncExternalStore(editor.store.subscribeStructure, get, get);
}

/** Every shape; re-renders on any change. For small components that need the whole picture. */
export function useAllShapes(editor: Editor): ReadonlyMap<string, Shape> {
  return useSyncExternalStore(editor.store.subscribeAny, editor.store.all, editor.store.all);
}

/** The shapes for some ids (the selection); re-renders when one of them changes. */
export function usePick(editor: Editor, ids: readonly string[]): Shape[] {
  const get = () => editor.store.pick(ids);
  return useSyncExternalStore(editor.store.subscribeAny, get, get);
}

/** Whether a shape is in your selection; re-renders only when that answer changes. */
export function useIsSelected(editor: Editor, id: string): boolean {
  const get = () => editor.selection.get().includes(id);
  return useSyncExternalStore(editor.selection.subscribe, get, get);
}

/** A derived value of an atom (a boolean, a string); re-renders only when the derived value changes. */
export function useAtomSelector<T, S>(atom: Atom<T>, select: (value: T) => S): S {
  const get = () => select(atom.get());
  return useSyncExternalStore(atom.subscribe, get, get);
}
