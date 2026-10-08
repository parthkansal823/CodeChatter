"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { roomDocName } from "@codechatter/workspace-model";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { slotFor, type PresenceSlot } from "@/components/presence/presence";
import type { Me } from "@/lib/me";

import { allPages, pagesMap, type PageRecord } from "./pages-model";

function collabUrl() {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

export type Connection = { doc: Y.Doc; provider: HocuspocusProvider; synced: boolean };

type UserInfo = Pick<Me["user"], "id" | "name" | "image">;

/** What a person broadcasts on a docs document: the same shape as the room's presence. */
export const presenceUser = (user: UserInfo) => ({ id: user.id, name: user.name, slot: slotFor(user.id), image: user.image ?? null });

/**
 * The room's page index on its own socket. Each connection owns its socket
 * (created inside the effect, like the room's files document): in dev, React
 * mounts effects twice, and two documents sharing one socket race a close
 * message against the second mount's authentication.
 */
export function useDocsConnection(roomId: string, user: UserInfo): Connection | null {
  const [state, setState] = useState<Omit<Connection, "synced"> | null>(null);
  const [synced, setSynced] = useState(false);
  const { id, name, image } = user;

  useEffect(() => {
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: roomDocName(roomId, "pages"), document: doc, token: "session" });
    provider.attach();
    provider.on("synced", () => setSynced(true));
    provider.setAwarenessField("user", presenceUser({ id, name, image }));
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

/** Any one document of the room (a page, its history, a database) for as long as `name` is set. */
export function useDocConnection(name: string | null): Connection | null {
  const [state, setState] = useState<Omit<Connection, "synced"> | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!name) return;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: "session" });
    provider.attach();
    provider.on("synced", () => setSynced(true));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setState({ doc, provider });
    return () => {
      setState(null);
      setSynced(false);
      provider.destroy();
      socket.destroy();
      doc.destroy();
    };
  }, [name]);

  return name && state ? { ...state, synced } : null;
}

/** One page's document, for as long as the page is open. */
export const usePageConnection = (roomId: string, pageId: string) => useDocConnection(roomDocName(roomId, "page", pageId));

/** Every page in the index (trashed ones too); re-renders on any index change. */
export function usePages(doc: Y.Doc): PageRecord[] {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const pages = pagesMap(doc);
      const handler = () => {
        version.current += 1;
        onChange();
      };
      pages.observeDeep(handler);
      return () => pages.unobserveDeep(handler);
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => allPages(doc), [doc, tick]);
}

export type AwarenessPeer = {
  clientId: number;
  user: { id: string; name: string; slot: PresenceSlot; image: string | null };
  pageId: string | null;
};

export const asSlot = (value: unknown): PresenceSlot => (typeof value === "number" && value >= 1 && value <= 8 ? (Math.trunc(value) as PresenceSlot) : 2);

/** Everyone else on a document's awareness, one entry per person. */
export function useAwarenessPeers(provider: HocuspocusProvider): AwarenessPeer[] {
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
    const peers = new Map<string, AwarenessPeer>();
    awareness.getStates().forEach((state, clientId) => {
      const s = state as { user?: { id?: unknown; name?: unknown; slot?: unknown; image?: unknown }; pageId?: unknown };
      if (clientId === awareness.clientID || typeof s.user?.id !== "string") return;
      if (peers.has(s.user.id)) return;
      peers.set(s.user.id, {
        clientId,
        user: {
          id: s.user.id,
          name: typeof s.user.name === "string" ? s.user.name : "Someone",
          slot: asSlot(s.user.slot),
          image: typeof s.user.image === "string" ? s.user.image : null,
        },
        pageId: typeof s.pageId === "string" ? s.pageId : null,
      });
    });
    return [...peers.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness, tick]);
}

