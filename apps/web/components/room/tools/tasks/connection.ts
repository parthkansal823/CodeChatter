/** Own the task board's live document and report connection changes without sharing sockets between mounts. */
"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { collabUrl } from "@/components/room/room-context";

export type TasksConnection = { doc: Y.Doc; provider: HocuspocusProvider; synced: boolean; status: "connecting" | "connected" | "offline" | "denied" };

export function useTasksConnection(roomId: string): TasksConnection | null {
  const [connection, setConnection] = useState<Pick<TasksConnection, "doc" | "provider"> | null>(null);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<TasksConnection["status"]>("connecting");
  useEffect(() => {
    let alive = true;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: roomDocName(roomId, "tasks"), document: doc, token: "session" });
    provider.on("synced", () => { if (alive) setSynced(true); });
    provider.on("status", ({ status: next }: { status: string }) => { if (alive) setStatus((previous) => previous === "denied" ? previous : next === "connected" ? "connected" : next === "connecting" ? "connecting" : "offline"); });
    provider.on("authenticated", () => { if (alive) setStatus("connected"); });
    provider.on("authenticationFailed", () => { if (alive) setStatus("denied"); });
    // Listen before attach so an already-open socket cannot race the first sync.
    provider.attach();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publish the external document this effect owns
    setConnection({ doc, provider });
    return () => {
      alive = false;
      provider.destroy();
      socket.destroy();
      doc.destroy();
      setConnection(null);
      setSynced(false);
      setStatus("connecting");
    };
  }, [roomId]);
  return connection && { ...connection, synced, status };
}

/** A primitive revision keeps the external-store snapshot stable between Yjs transactions. */
export function useTasksVersion(doc: Y.Doc): number {
  const version = useRef(0);
  // Stable subscription identity avoids detaching between board renders.
  const subscribe = useCallback((notify: () => void) => {
    const changed = () => { version.current++; notify(); };
    doc.on("afterTransaction", changed);
    return () => doc.off("afterTransaction", changed);
  }, [doc]);
  return useSyncExternalStore(subscribe, () => version.current, () => 0);
}
