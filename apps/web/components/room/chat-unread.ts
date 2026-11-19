"use client";

/**
 * How many chat messages you haven't read, per room: one query for all your rooms (the dashboard, the title bar), and one room's for a public room's
 * visitor. Kept apart from the chat panel so the dashboard doesn't load the panel to show a count.
 */
import type { ChatUnreadList, ChatUnreadState } from "@codechatter/contracts";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";

const refreshTimers = new WeakMap<QueryClient, Map<string, ReturnType<typeof setTimeout>>>();

/** Cancel an older snapshot before fetching another; an early response must never restore a cleared count. */
export async function refreshChatUnread(client: QueryClient, userId: string) {
  const queryKey = ["chat-unread", userId] as const;
  await client.cancelQueries({ queryKey });
  await client.invalidateQueries({ queryKey });
}

function queueUnreadRefresh(client: QueryClient, userId: string) {
  let timers = refreshTimers.get(client);
  if (!timers) {
    timers = new Map();
    refreshTimers.set(client, timers);
  }
  if (timers.has(userId)) return;
  const pending = timers;
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId);
      void refreshChatUnread(client, userId);
    }, 40),
  );
}

/** One shared dashboard query, independent of the panel's lifetime; public visitors opt into one room fallback. */
export function useChatUnread(userId: string, roomId?: string) {
  const client = useQueryClient();
  const all = useQuery({
    queryKey: ["chat-unread", userId],
    queryFn: ({ signal }) => api<ChatUnreadList>("/api/rooms/chat/unread", { signal }),
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const memberState = all.data?.rooms.find((room) => room.roomId === roomId);
  const other = useQuery({
    queryKey: ["chat-unread", userId, roomId],
    queryFn: ({ signal }) => api<ChatUnreadState>(`/api/rooms/${roomId}/messages/unread`, { signal }),
    enabled: Boolean(roomId && all.isSuccess && !memberState),
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  useEffect(() => {
    const socket = getSocket();
    const refresh = () => queueUnreadRefresh(client, userId);
    socket.on("chat:unread", refresh);
    socket.on("connect", refresh);
    return () => {
      socket.off("chat:unread", refresh);
      socket.off("connect", refresh);
    };
  }, [client, userId]);
  return {
    rooms: all.data?.rooms ?? [],
    state: memberState ?? (other.isError ? undefined : other.data),
    loading: all.isPending || Boolean(roomId && !memberState && other.isPending),
    error: all.isError || Boolean(roomId && !memberState && other.isError),
  };
}
