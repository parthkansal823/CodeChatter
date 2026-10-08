"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { roomDocName } from "@codechatter/workspace-model";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { slotFor, type PresenceSlot } from "@/components/presence/presence";
import type { Me } from "@/lib/me";

import { listTree, readEnvironments, readRequest, apiMaps, type Environment, type RequestData, type TreeItem } from "./model";

function collabUrl() {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

export type ApiConnection = { doc: Y.Doc; provider: HocuspocusProvider; synced: boolean };

/** The room's API Studio document, live, for as long as the tool is open. */
export function useApiConnection(roomId: string, user: Pick<Me["user"], "id" | "name" | "image">): ApiConnection | null {
  const [state, setState] = useState<Omit<ApiConnection, "synced"> | null>(null);
  const [synced, setSynced] = useState(false);
  const { id, name, image } = user;

  useEffect(() => {
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: roomDocName(roomId, "api"), document: doc, token: "session" });
    // An external socket isn't attached automatically in Hocuspocus 4.
    provider.attach();
    provider.on("synced", () => setSynced(true));
    provider.setAwarenessField("user", { id, name, slot: slotFor(id), image: image ?? null });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setState({ doc, provider });
    return () => {
      setState(null);
      setSynced(false);
      provider.destroy();
      socket.destroy();
      doc.destroy();
    };
  }, [roomId, id, name, image]);

  return state && { ...state, synced };
}

/** Anything Yjs lets you observe deeply (Y.Map, Y.Array, Y.Text). */
type DeepObservable = { observeDeep: (handler: () => void) => void; unobserveDeep: (handler: () => void) => void };

/** Re-render when a Y type (or anything inside it) changes; returns a version number. */
function useYVersion(type: DeepObservable | null | undefined): number {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!type) return () => {};
      const handler = () => {
        version.current += 1;
        onChange();
      };
      type.observeDeep(handler);
      return () => type.unobserveDeep(handler);
    },
    [type],
  );
  return useSyncExternalStore(subscribe, () => version.current, () => 0);
}

/** The collection tree; keeps its identity while only request contents change. */
export function useTree(doc: Y.Doc): TreeItem[] {
  const tick = useYVersion(apiMaps(doc).nodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => JSON.stringify(listTree(doc)), [doc, tick]);
  return useMemo(() => JSON.parse(key) as TreeItem[], [key]);
}

export function useRequest(doc: Y.Doc, id: string | null): RequestData | null {
  const tick = useYVersion(apiMaps(doc).nodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (id ? readRequest(doc, id) : null), [doc, id, tick]);
}

export function useEnvironments(doc: Y.Doc): Environment[] {
  const tick = useYVersion(apiMaps(doc).environments);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => readEnvironments(doc), [doc, tick]);
}

export function useMockToken(doc: Y.Doc): string | null {
  const settings = apiMaps(doc).settings;
  const tick = useYVersion(settings);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (settings.get("mockToken") as string | undefined) ?? null, [settings, tick]);
}

export type StudioPeer = { clientId: number; user: { id: string; name: string; slot: PresenceSlot; image: string | null }; requestId: string | null };

/** Everyone else in API Studio and the request each of them has open. */
export function useStudioPeers(provider: HocuspocusProvider): StudioPeer[] {
  const awareness = provider.awareness!;
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current += 1;
        onChange();
      };
      awareness.on("change", handler);
      return () => awareness.off("change", handler);
    },
    [awareness],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  return useMemo(() => {
    const peers = new Map<string, StudioPeer>();
    awareness.getStates().forEach((state, clientId) => {
      const s = state as Partial<StudioPeer>;
      if (clientId === awareness.clientID || !s.user) return;
      if (!peers.has(s.user.id)) peers.set(s.user.id, { clientId, user: s.user, requestId: s.requestId ?? null });
    });
    return [...peers.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness, tick]);
}
