"use client";

import type { RoomSummary } from "@codechatter/contracts";
import dynamic from "next/dynamic";

import type { Me } from "@/lib/me";

// Monaco, Yjs and the VS Code services touch `window` at import time, so the
// workspace never renders on the server (ADR 0004).
const RoomWorkspace = dynamic(() => import("@/components/room/room-workspace"), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">Opening the room…</div>
  ),
});

export function RoomLoader({ room, me }: { room: RoomSummary; me: Me }) {
  return <RoomWorkspace room={room} me={me} />;
}
