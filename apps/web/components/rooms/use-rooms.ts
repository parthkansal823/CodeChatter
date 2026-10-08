"use client";

import type { CreateRoomInput, CreatedRoom, JoinResult, RoomSummary } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export const roomsKey = ["rooms"] as const;

export function useRooms() {
  return useQuery({ queryKey: roomsKey, queryFn: () => api<RoomSummary[]>("/api/rooms") });
}

export function useCreateRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateRoomInput> & { name: string }) =>
      api<CreatedRoom>("/api/rooms", { method: "POST", json: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: roomsKey }),
  });
}

export function useJoinRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; inviteToken?: string }) =>
      api<JoinResult>("/api/rooms/join", { method: "POST", json: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: roomsKey }),
  });
}

export function useDeleteRoom() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/rooms/${id}`, { method: "DELETE" }),
    // Remove it from the list at once; refetch settles the truth.
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: roomsKey });
      const previous = client.getQueryData<RoomSummary[]>(roomsKey);
      client.setQueryData<RoomSummary[]>(roomsKey, (rooms) => rooms?.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_error, _id, context) => client.setQueryData(roomsKey, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: roomsKey }),
  });
}
