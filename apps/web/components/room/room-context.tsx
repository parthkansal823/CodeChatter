"use client";

import { can, type RoomAction, type RoomRole, type RoomSummary } from "@codechatter/contracts";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { filesDocName, roomDocName } from "@codechatter/workspace-model";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
export function RoomProvider({ room: loaded, me, children }: { room: RoomSummary; me: Me; children: ReactNode }) {
  // Your role can change while you're here: the page came with one, and the server may say otherwise later.
  const [liveRole, setLiveRole] = useState<RoomRole | null>(null);
  const room = useMemo(() => (liveRole && liveRole !== loaded.role ? { ...loaded, role: liveRole } : loaded), [loaded, liveRole]);
  const [state, setState] = useState<{ doc: Y.Doc; provider: HocuspocusProvider; comments: Y.Doc } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [denied, setDenied] = useState(false);
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
    // Rights are read when a connection opens, and the server closes it when they change. So
    // connecting again is when to ask what you may do now. Refused: you were removed, the room went
    // private or was deleted, or the session ended. A failure on the server also looks like that,
    // so the API has the last word.
    const readAccess = () =>
      void fetch(`/api/rooms/${room.id}`, { credentials: "same-origin" }).then(
        async (response) => {
          if ([401, 403, 404].includes(response.status)) {
            setDenied(true);
            // Nothing's left to retry: the screen that replaces the room says what to do, and reloading starts afresh.
            socket.disconnect();
          }
          else if (response.ok) setLiveRole(((await response.json()) as RoomSummary).role);
        },
        () => {},
      );
    let connectedBefore = false;
    provider.on("authenticated", () => {
      if (connectedBefore) readAccess();
      connectedBefore = true;
    });
    provider.on("authenticationFailed", readAccess);
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
      setDenied(false);
      setLiveRole(null);
      setStatus("connecting");
      commentsProvider.destroy();
      provider.destroy();
      socket.destroy();
      comments.destroy();
      doc.destroy();
    };
  }, [room.id, me.user.id, me.user.name, me.user.image]);

  if (denied) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="font-medium">You no longer have access to this room</h1>
        <p className="text-sm text-muted-foreground">You may have been removed, or it may have been made private or deleted. Or you may need to sign in again.</p>
        <Link className="text-sm underline underline-offset-4" href="/dashboard">Back to your rooms</Link>
      </main>
    );
  }

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
