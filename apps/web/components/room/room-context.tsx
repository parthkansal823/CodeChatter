"use client";

import { can, type RoomAction, type RoomSummary } from "@codechatter/contracts";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { filesDocName, roomDocName } from "@codechatter/workspace-model";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as Y from "yjs";

import { slotFor, type PresenceSlot } from "@/components/presence/presence";
import type { Me } from "@/lib/me";

export type ConnectionStatus = "connecting" | "connected" | "offline";

/** What every other person in the room broadcasts through awareness. */
export type PresenceState = {
  user: { id: string; name: string; slot: PresenceSlot; image: string | null };
  activeFileId: string | null;
  /** When they started presenting (everyone follows them: editor/present.ts); null when they aren't. */
  presenting?: number | null;
  /** The person they follow. */
  following?: string | null;
  /** In the room's call (call/call-dock.tsx). */
  inCall?: boolean;
};

type RoomContextValue = {
  room: RoomSummary;
  me: Me;
  mySlot: PresenceSlot;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** The room's comment threads on code (code-comments/), on the same connection. */
  comments: Y.Doc;
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

export function collabUrl() {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/collab`;
}

/**
 * One Y.Doc + Hocuspocus connection per open room. The session cookie rides
 * on the same-origin WebSocket, so no token is passed; the server decides
 * read-only from the member's role.
 */
export function RoomProvider({ room, me, children }: { room: RoomSummary; me: Me; children: ReactNode }) {
  const [state, setState] = useState<{ doc: Y.Doc; provider: HocuspocusProvider; comments: Y.Doc } | null>(null);
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
    // Comment threads: their own document (anyone who can chat may write it), over the same socket.
    const comments = new Y.Doc();
    const commentsProvider = new HocuspocusProvider({ websocketProvider: socket, name: roomDocName(room.id, "comments"), document: comments, token: "session" });
    commentsProvider.attach();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- publishing an external resource this effect owns
    setState({ doc, provider, comments });
    return () => {
      setState(null);
      setSynced(false);
      setStatus("connecting");
      commentsProvider.destroy();
      provider.destroy();
      socket.destroy();
      comments.destroy();
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
        comments: state.comments,
        status,
        synced,
        can: (action) => can(room.role, action),
      }}
    >
      {children}
    </RoomContext>
  );
}
