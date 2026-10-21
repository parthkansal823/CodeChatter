"use client";

import type { RoomRepo } from "@codechatter/contracts";
import { maps } from "@codechatter/workspace-model";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { api, ApiError } from "@/lib/api";

import { roomTexts, SYNC_KEY } from "./room-files";

export const repoKey = (roomId: string) => ["room-repo", roomId] as const;
export const baseKey = (roomId: string, commit: string) => ["repo-files", roomId, commit] as const;

/**
 * The GitHub repository the room was made from (null for a room that wasn't, undefined
 * while loading). Fetched again when anyone in the room syncs with GitHub.
 */
export function useRoomRepo(): RoomRepo | null | undefined {
  const { room, doc } = useRoom();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: repoKey(room.id),
    queryFn: () =>
      api<RoomRepo>(`/api/rooms/${room.id}/repo`).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
    staleTime: 60_000,
  });
  useEffect(() => {
    const meta = maps(doc).meta;
    const onChange = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has(SYNC_KEY)) void client.invalidateQueries({ queryKey: repoKey(room.id) });
    };
    meta.observe(onChange);
    return () => meta.unobserve(onChange);
  }, [doc, client, room.id]);
  return query.data;
}

/** The repository's files at the commit the room last synced with, by path. */
export function useBaseFiles(commit: string | undefined): Map<string, string> | undefined {
  const { room } = useRoom();
  return useQuery({
    queryKey: baseKey(room.id, commit ?? ""),
    queryFn: async () => {
      const response = await fetch(`/api/rooms/${room.id}/repo/files`, { credentials: "same-origin" });
      if (!response.ok) throw new ApiError(response.status, "Couldn't load the repository's files.");
      const files = (await response.json()) as Array<{ path: string; content: string }>;
      return new Map(files.map((file) => [file.path, file.content]));
    },
    enabled: Boolean(commit),
    staleTime: Infinity,
  }).data;
}

/** The room's files by path, read again a moment after each edit (not on every keystroke). */
export function useRoomTexts(): Map<string, string> {
  const { doc } = useRoom();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onUpdate = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          version.current += 1;
          onChange();
        }, 300);
      };
      doc.on("update", onUpdate);
      return () => {
        doc.off("update", onUpdate);
        if (timer) clearTimeout(timer);
      };
    },
    [doc],
  );
  const tick = useSyncExternalStore(
    subscribe,
    () => version.current,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => roomTexts(doc), [doc, tick]);
}
