"use client";

import { can, type RoomAction, type RoomSummary } from "@codechatter/contracts";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { filesDocName } from "@codechatter/workspace-model";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as Y from "yjs";

import { slotFor, type PresenceSlot } from "@/components/presence/presence";
import type { Me } from "@/lib/me";

export type ConnectionStatus = "connecting" | "connected" | "offline";

/** What every other person in the room broadcasts through awareness. */
export type PresenceState = {
  user: { id: string; name: string; slot: PresenceSlot; image: string | null };
  activeFileId: string | null;
};

type RoomContextValue = {
  room: RoomSummary;
  me: Me;
  mySlot: PresenceSlot;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  status: ConnectionStatus;
  synced: boolean;
  can: (action: RoomAction) => boolean;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside <RoomProvider>");
  return value;
}

function collabUrl() {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

/**
 * One Y.Doc + Hocuspocus connection per open room. The session cookie rides
 * on the same-origin WebSocket, so no token is passed; the server decides
 * read-only from the member's role.
 */
export function RoomProvider({ room, me, children }: { room: RoomSummary; me: Me; children: ReactNode }) {
  const [state, setState] = useState<{ doc: Y.Doc; provider: HocuspocusProvider } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  // You are always slot 1 (the brand orange) in your own view.
  const mySlot: PresenceSlot = 1;

  // The connection is created *inside* the effect, so each mount owns its own.
  // (React's dev double-mount previously destroyed a connection that the second
  // mount then reused, leaving the room stuck on "Connecting…".)
  useEffect(() => {
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: collabUrl() });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(room.id), document: doc, token: "session" });
    // An external socket isn't attached automatically in Hocuspocus 4.
    provider.attach();
    provider.on("status", ({ status: s }: { status: string }) =>
      setStatus(s === "connected" ? "connected" : s === "connecting" ? "connecting" : "offline"),
    );
    provider.on("synced", () => setSynced(true));
    provider.setAwarenessField("user", { id: me.user.id, name: me.user.name, slot: slotFor(me.user.id), image: me.user.image ?? null });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setState({ doc, provider });
    return () => {
      setState(null);
      setSynced(false);
      setStatus("connecting");
      provider.destroy();
      socket.destroy();
      doc.destroy();
    };
  }, [room.id, me.user.id, me.user.name, me.user.image]);

  if (!state) {
    return <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Opening the room…</div>;
  }

  return (
    <RoomContext
      value={{
        room,
        me,
        mySlot,
        doc: state.doc,
        provider: state.provider,
        status,
        synced,
        can: (action) => can(room.role, action),
      }}
    >
      {children}
    </RoomContext>
  );
}
