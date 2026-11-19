/** Own the task board's live document and report connection changes without sharing sockets between mounts. */
"use client";

import { can, type RoomSummary } from "@codechatter/contracts";
import { roomDocName } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { collabUrl } from "@/components/room/room-context";

export type TaskUndoLease = { canWrite: () => Promise<boolean>; release: () => void };
export type TasksConnection = { doc: Y.Doc; provider: HocuspocusProvider; synced: boolean; status: "connecting" | "connected" | "offline" | "denied"; retain: () => TaskUndoLease };

export function useTasksConnection(roomId: string): TasksConnection | null {
  const [connection, setConnection] = useState<Pick<TasksConnection, "doc" | "provider" | "retain"> | null>(null);
  const [synced, setSynced] = useState(false);
  const [status, setStatus] = useState<TasksConnection["status"]>("connecting");
  useEffect(() => {
    let alive = true;
    let destroyed = false;
    let leases = 0;
    let authenticated = false;
    let liveStatus: TasksConnection["status"] = "connecting";
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: roomDocName(roomId, "tasks"), document: doc, token: "session" });
    const publishStatus = (next: TasksConnection["status"]) => {
      liveStatus = next;
      if (alive) setStatus(next);
    };
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(closeTimer);
      provider.off("unsyncedChanges", maybeDestroy);
      provider.destroy();
      socket.destroy();
      doc.destroy();
    };
    const maybeDestroy = () => {
      if (alive || leases || destroyed) return;
      if (!provider.hasUnsyncedChanges) destroy();
      // Undo's last write needs its acknowledgement before this headless connection closes.
      else closeTimer ??= setTimeout(destroy, 5_000);
    };
    const retain = (): TaskUndoLease => {
      let released = destroyed;
      if (!released) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
        leases++;
      }
      const ready = () => !released && !destroyed && authenticated && liveStatus === "connected";
      return {
        canWrite: async () => {
          if (!ready()) return false;
          try {
            // The board may be closed, so its captured can() function cannot establish current access.
            const response = await fetch(`/api/rooms/${roomId}`, { credentials: "same-origin", signal: AbortSignal.timeout(5_000) });
            if (!response.ok) return false;
            const room = await response.json() as RoomSummary;
            return ready() && can(room.role, "files.edit");
          } catch { return false; }
        },
        release: () => {
          if (released) return;
          released = true;
          leases--;
          maybeDestroy();
        },
      };
    };
    provider.on("synced", () => { if (alive) setSynced(true); });
    provider.on("status", ({ status: next }: { status: string }) => {
      if (next !== "connected") authenticated = false;
      if (liveStatus !== "denied") publishStatus(next === "connected" ? "connected" : next === "connecting" ? "connecting" : "offline");
    });
    provider.on("authenticated", () => { authenticated = true; publishStatus("connected"); });
    provider.on("authenticationFailed", () => { authenticated = false; publishStatus("denied"); });
    provider.on("unsyncedChanges", maybeDestroy);
    // Listen before attach so an already-open socket cannot race the first sync.
    provider.attach();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publish the external document this effect owns
    setConnection({ doc, provider, retain });
    return () => {
      alive = false;
      maybeDestroy();
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
