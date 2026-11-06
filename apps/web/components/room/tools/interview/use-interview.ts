/** The room's interview as this person may see it, and a countdown on the server's clock. */
"use client";

import type { RoomInterview } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { api } from "@/lib/api";

export const interviewKey = (roomId: string) => ["room-interview", roomId] as const;

export function useRoomInterview() {
  const { room } = useRoom();
  return useQuery({
    queryKey: interviewKey(room.id),
    queryFn: ({ signal }) => api<RoomInterview>(`/api/rooms/${room.id}/interview`, { signal }),
    enabled: room.kind === "interview",
    // Socket events bring changes at once; this covers a dropped socket.
    refetchInterval: (query) => (query.state.data?.status === "live" ? 15_000 : 30_000),
  });
}

/** Whether AI help is off for this person: a candidate, until their interviewer allows it (the API refuses it, too). */
export function useCandidateAiOff(): boolean {
  const { room } = useRoom();
  const { data } = useRoomInterview();
  return room.role === "candidate" && data?.aiAllowed !== true;
}

/**
 * Milliseconds left, or null when no clock is running. Counted from the server's `now`, so
 * a wrong clock on someone's computer doesn't show them the wrong time.
 */
export function useCountdown(endsAt: string | null | undefined, serverNow: string | undefined, fetchedAt: number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (!endsAt || !serverNow) return null;
  const skew = new Date(serverNow).getTime() - fetchedAt;
  // eslint-disable-next-line react-hooks/purity -- a countdown reads the clock on every tick.
  return new Date(endsAt).getTime() - (Date.now() + skew);
}
