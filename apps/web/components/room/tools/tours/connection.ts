/** Share one ref-counted tours document between the editor bridge and the tool, including React's development remounts. */
"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useCallback, useRef, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { collabUrl } from "@/components/room/room-context";

export type ToursConnection = {
  doc: Y.Doc;
  synced: boolean;
  status: "connecting" | "connected" | "offline" | "denied";
  version: number;
};
type Entry = {
  snapshot: ToursConnection;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  listeners: Set<() => void>;
  disposal: ReturnType<typeof setTimeout> | null;
};
const rooms = new Map<string, Entry>();

function connect(roomId: string): Entry {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: roomDocName(roomId, "tours"),
    document: doc,
    token: "session",
  });
  const entry: Entry = {
    snapshot: { doc, synced: false, status: "connecting", version: 0 },
    provider,
    socket,
    listeners: new Set(),
    disposal: null,
  };
  rooms.set(roomId, entry);
  const update = (patch: Partial<ToursConnection>) => {
    entry.snapshot = { ...entry.snapshot, ...patch };
    for (const listener of entry.listeners) listener();
  };
  doc.on("afterTransaction", () => update({ version: entry.snapshot.version + 1 }));
  provider.on("synced", () => update({ synced: true }));
  provider.on("status", ({ status }: { status: string }) => {
    if (entry.snapshot.status !== "denied")
      update({
        status: status === "connected" ? "connected" : status === "connecting" ? "connecting" : "offline",
      });
  });
  provider.on("authenticated", () => update({ status: "connected" }));
  provider.on("authenticationFailed", () => update({ status: "denied" }));
  provider.attach();
  return entry;
}

export function useToursConnection(roomId: string): ToursConnection | null {
  "use no memo";
  const subscribe = useCallback(
    (notify: () => void) => {
      const entry = rooms.get(roomId) ?? connect(roomId);
      if (entry.disposal) clearTimeout(entry.disposal);
      entry.disposal = null;
      entry.listeners.add(notify);
      return () => {
        entry.listeners.delete(notify);
        if (entry.listeners.size) return;
        // Defer disposal one task so StrictMode's immediate re-subscription can reuse it.
        entry.disposal = setTimeout(() => {
          if (entry.listeners.size) return;
          rooms.delete(roomId);
          entry.provider.destroy();
          entry.socket.destroy();
          entry.snapshot.doc.destroy();
        }, 0);
      };
    },
    [roomId],
  );
  return useSyncExternalStore(
    subscribe,
    () => rooms.get(roomId)?.snapshot ?? null,
    () => null,
  );
}

/** Mutable Yjs state needs an explicit revision outside compiler-managed caching. */
export function useDocumentVersion(doc: Y.Doc): number {
  "use no memo";
  const revision = useRef(0);
  const subscribe = useCallback(
    (notify: () => void) => {
      const changed = () => {
        revision.current++;
        notify();
      };
      doc.on("afterTransaction", changed);
      return () => doc.off("afterTransaction", changed);
    },
    [doc],
  );
  return useSyncExternalStore(
    subscribe,
    () => revision.current,
    () => 0,
  );
}
