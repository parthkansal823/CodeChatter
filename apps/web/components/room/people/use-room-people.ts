/** A room's people for whoever manages it, kept current by the socket, with a slow poll for a dropped one. */
"use client";

import type { RoomPeople } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useRoom } from "@/components/room/room-context";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";

export const peopleKey = (roomId: string) => ["room-people", roomId] as const;

export function useRoomPeople() {
  const { room, can } = useRoom();
  const client = useQueryClient();
  // An interview decides who's in its room.
  const manages = can("room.manage") && room.kind !== "interview";
  const query = useQuery({
    queryKey: peopleKey(room.id),
    queryFn: ({ signal }) => api<RoomPeople>(`/api/rooms/${room.id}/people`, { signal }),
    enabled: manages,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const socket = getSocket();
    const changed = () => {
      void client.invalidateQueries({ queryKey: peopleKey(room.id) });
      void client.invalidateQueries({ queryKey: ["room-members", room.id] });
    };
    socket.on("room:people-changed", changed);
    return () => void socket.off("room:people-changed", changed);
  }, [client, room.id]);

  return { manages, people: query.data };
}
