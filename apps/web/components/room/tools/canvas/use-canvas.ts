"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";

import { itemsOf, readItems, type ListItem } from "./list";
import type { LiveDoc } from "./live-doc";
import { startMeasuring } from "./measure";
import { CanvasSession } from "./session";
import type { CanvasKind } from "./shape";

const snapshots = new WeakMap<Y.Doc, ListItem[]>();
const EMPTY: ListItem[] = [];

function itemsSnapshot(doc: Y.Doc): ListItem[] {
  let items = snapshots.get(doc);
  if (!items) snapshots.set(doc, (items = readItems(doc)));
  return items;
}

/** The live list of designs or whiteboards (trashed ones included; callers filter). */
export function useListItems(live: LiveDoc | null): ListItem[] {
  const doc = live?.doc ?? null;
  const subscribe = (onChange: () => void) => {
    if (!doc) return () => {};
    const items = itemsOf(doc);
    const handler = () => {
      snapshots.delete(doc);
      onChange();
    };
    items.observeDeep(handler);
    return () => items.unobserveDeep(handler);
  };
  const get = () => (doc ? itemsSnapshot(doc) : EMPTY);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * The editor session for an open canvas document, created once it has
 * synced (so the first view can fit its contents) and destroyed with it.
 */
export function useCanvasSession(
  live: LiveDoc | null,
  kind: CanvasKind,
  me: { id: string; name: string; image: string | null },
  editable: boolean,
): CanvasSession | null {
  const [session, setSession] = useState<CanvasSession | null>(null);
  const doc = live?.synced ? live.doc : null;
  const provider = live?.provider ?? null;
  useEffect(() => {
    if (!doc || !provider) return;
    startMeasuring();
    const next = new CanvasSession(doc, provider, kind, me);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setSession(next);
    return () => {
      setSession(null);
      next.destroy();
    };
    // `me` is identified by its id; a new object with the same person shouldn't reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, provider, kind, me.id]);
  useEffect(() => {
    session?.editor.readOnly.set(!editable);
    if (!editable) session?.editor.tool.set("select");
  }, [session, editable]);
  return session;
}
