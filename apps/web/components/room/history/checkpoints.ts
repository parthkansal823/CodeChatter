"use client";

import type { CheckpointReply, CheckpointRequest, CheckpointSummary, RequestedCheckpointKind } from "@codechatter/contracts";
import { randomId } from "@codechatter/workspace-model";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { roomContents } from "@/components/room/source-control/room-files";
import { api, ApiError } from "@/lib/api";

/**
 * Checkpoints in the browser (the History view): ask collab for one over the files
 * document's connection, which answers after it has every edit this browser sent; the
 * room's list, kept fresh when collab says it changed; and a checkpoint's files, read from
 * its stored Yjs state.
 */

export const checkpointsKey = (roomId: string) => ["checkpoints", roomId] as const;
const filesKey = (roomId: string, id: string) => ["checkpoint-files", roomId, id] as const;

/** Ask collab for a checkpoint; resolves to the one that holds the files as they are now (an older one when nothing changed since). */
export function requestCheckpoint(
  provider: HocuspocusProvider,
  kind: RequestedCheckpointKind,
  label: string | null = null,
  timeoutMs = 10_000,
): Promise<CheckpointSummary> {
  const request = randomId();
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      provider.off("stateless", onMessage);
    };
    const onMessage = ({ payload }: { payload: string }) => {
      let reply: CheckpointReply;
      try {
        reply = JSON.parse(payload) as CheckpointReply;
      } catch {
        return;
      }
      if (reply.type !== "checkpoint" || reply.request !== request) return;
      done();
      if (reply.ok) resolve(reply.checkpoint);
      else reject(new Error(reply.error));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error("The room didn't answer in time. Check the connection, then try again."));
    }, timeoutMs);
    provider.on("stateless", onMessage);
    provider.sendStateless(JSON.stringify({ type: "checkpoint", request, kind, label } satisfies CheckpointRequest));
  });
}

/** The last time this browser asked for one before an AI edit, by room: one a minute is enough. */
const lastBeforeAi = new Map<string, number>();

/**
 * A checkpoint before the AI changes files, so History can put them back. Never in the
 * way: it waits a few seconds at most, and the edit goes ahead if there's no answer.
 */
export async function checkpointBeforeAi(provider: HocuspocusProvider, roomId: string, label: string): Promise<void> {
  const last = lastBeforeAi.get(roomId) ?? 0;
  if (Date.now() - last < 60_000) return;
  lastBeforeAi.set(roomId, Date.now());
  await requestCheckpoint(provider, "pre_ai", label.slice(0, 100), 4_000).catch(() => {});
}

/** The room's checkpoints, newest first; refetched when collab says the list changed. */
export function useCheckpoints(): CheckpointSummary[] | undefined {
  const { room, provider } = useRoom();
  const client = useQueryClient();
  useEffect(() => {
    const onMessage = ({ payload }: { payload: string }) => {
      if (payload.includes('"checkpoints-changed"')) void client.invalidateQueries({ queryKey: checkpointsKey(room.id) });
    };
    provider.on("stateless", onMessage);
    return () => void provider.off("stateless", onMessage);
  }, [provider, client, room.id]);
  return useQuery({
    queryKey: checkpointsKey(room.id),
    queryFn: () => api<{ checkpoints: CheckpointSummary[] }>(`/api/rooms/${room.id}/checkpoints`).then((r) => r.checkpoints),
    refetchInterval: 60_000,
  }).data;
}

/** A checkpoint's files by path. They never change, so they're read once. */
export function useCheckpointFiles(id: string | null): Map<string, string> | undefined {
  const { room } = useRoom();
  return useQuery({
    queryKey: filesKey(room.id, id ?? ""),
    queryFn: async () => {
      const response = await fetch(`/api/rooms/${room.id}/checkpoints/${id}/state`, { credentials: "same-origin" });
      if (!response.ok) throw new ApiError(response.status, "Couldn't load the checkpoint.");
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(await response.arrayBuffer()));
      const files = roomContents(doc);
      doc.destroy();
      return files;
    },
    enabled: Boolean(id),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  }).data;
}

const KIND_NAME: Record<CheckpointSummary["kind"], string> = {
  manual: "Saved",
  auto: "Automatic",
  pre_restore: "Before a restore",
  pre_ai: "Before an AI edit",
  pre_github: "Before a GitHub sync",
  interview: "Interview",
  import: "Before an import",
};

/** What to call a checkpoint: its name, else what made it. */
export const checkpointTitle = (checkpoint: CheckpointSummary): string => checkpoint.label ?? KIND_NAME[checkpoint.kind];
export const kindName = (kind: CheckpointSummary["kind"]): string => KIND_NAME[kind];
