/** The bar across an interview room: what's happening and the time left. It also keeps the room up to date with the interview. */
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { useEffect } from "react";

import { formatCountdown } from "@/components/interviews/format";
import { useRoom } from "@/components/room/room-context";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

import { interviewKey, useCountdown, useRoomInterview } from "./use-interview";

const LAST_MINUTES = 5 * 60_000;

export function InterviewBanner({ onOpen }: { onOpen: () => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const { data: interview, dataUpdatedAt } = useRoomInterview();

  useEffect(() => {
    const socket = getSocket();
    const join = () => void socket.emitWithAck("room:join", room.id).catch(() => {});
    const changed = () => void queryClient.invalidateQueries({ queryKey: interviewKey(room.id) });
    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("interview:changed", changed);
    return () => {
      socket.off("connect", join);
      socket.off("interview:changed", changed);
    };
  }, [room.id, queryClient]);

  // When it ends, a candidate's page was loaded with rights they no longer have. Loading
  // it again shows the room as a viewer, without any edits the server didn't take.
  const finished = interview?.status === "finished";
  const candidate = room.role === "candidate";
  useEffect(() => {
    if (finished && candidate) window.location.reload();
  }, [finished, candidate]);

  const left = useCountdown(interview?.status === "live" ? interview.endsAt : null, interview?.now, dataUpdatedAt);

  // At zero, ask straight away: the server closes it within a few seconds.
  const expired = left !== null && left <= 0;
  useEffect(() => {
    if (!expired) return;
    const timer = setInterval(() => void queryClient.invalidateQueries({ queryKey: interviewKey(room.id) }), 3000);
    return () => clearInterval(timer);
  }, [expired, room.id, queryClient]);

  if (!interview) return null;
  const message =
    interview.status === "scheduled" ? "Not started. The candidate can't see this room yet."
    : interview.status === "finished" ? (interview.role === "candidate" ? "This interview has finished. You can still read it, but not change it." : "This interview has finished. The room is read-only for the candidate.")
    : interview.status === "cancelled" ? "This interview was cancelled."
    : `Interview with ${interview.role === "candidate" ? (interview.interviewerName ?? "your interviewer") : interview.candidateName}`;

  return (
    <button type="button" onClick={onOpen} className="flex h-7 w-full shrink-0 items-center gap-2 border-b bg-panel px-3 text-left text-xs hover:bg-accent" aria-label={`${message}. Open the interview panel.`}>
      <Timer className="size-3.5 shrink-0 text-brand" />
      <span className="min-w-0 truncate">{message}</span>
      {left !== null && (
        <span role="timer" aria-live="off" className={cn("ml-auto shrink-0 font-mono font-medium tabular-nums", left <= LAST_MINUTES && "text-brand")}>
          {left <= 0 ? "Time's up" : `${formatCountdown(left)} left`}
        </span>
      )}
    </button>
  );
}
