"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

export type LiveDoc = { name: string; doc: Y.Doc; provider: HocuspocusProvider; synced: boolean };

function collabUrl() {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

/**
 * A live Yjs document by name (see roomDocName), connected while mounted.
 * Same pattern as the room's files document (room-context.tsx): the
 * connection is created inside the effect so each mount owns its own, and
 * the session cookie authorises it; viewers get a read-only connection.
 */
export function useLiveDoc(name: string | null): LiveDoc | null {
  const [state, setState] = useState<{ name: string; doc: Y.Doc; provider: HocuspocusProvider } | null>(null);
  const [syncedName, setSyncedName] = useState<string | null>(null);

  useEffect(() => {
    if (!name) return;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token: "session" });
    provider.attach();
    provider.on("synced", () => setSyncedName(name));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setState({ name, doc, provider });
    return () => {
      setState(null);
      setSyncedName(null);
      provider.destroy();
      socket.destroy();
      doc.destroy();
    };
  }, [name]);

  if (!state || state.name !== name) return null;
  return { ...state, synced: syncedName === name };
}
