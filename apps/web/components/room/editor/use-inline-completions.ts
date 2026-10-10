"use client";

import type { AiStatus } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { setInlineCompletionsRoom } from "@/components/room/editor/inline-completions";
import { useRoom } from "@/components/room/room-context";
import { api } from "@/lib/api";

/** GET /api/ai/status, shared with the AI panel (same query key). */
export const useAiStatus = () => useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/api/ai/status"), staleTime: 60_000 });

/** Whether this person gets AI suggestions in this room: AI is set up and they may edit files. */
export function useAiSuggestionsAllowed(): boolean {
  const { can } = useRoom();
  return useAiStatus().data?.configured === true && can("files.edit");
}

/** Call once in the room workspace: tells the editor's suggestion provider which room it's in, and whether to ask. */
export function useInlineCompletions(): void {
  const { room } = useRoom();
  const allowed = useAiSuggestionsAllowed();
  useEffect(() => {
    setInlineCompletionsRoom({ roomId: room.id, allowed });
    return () => setInlineCompletionsRoom(null);
  }, [room.id, allowed]);
}
