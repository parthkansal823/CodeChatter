"use client";

import type { GitRequestInput, GitResponse, GitStatus } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import * as Y from "yjs";

import { useRoom } from "@/components/room/room-context";
import { api } from "@/lib/api";

/**
 * Git in the room's sandbox, from the browser (API: sandbox/git.controller.ts). The
 * status is read again a moment after the room's files change, so edits, and git used
 * from the terminal, show up without a refresh button.
 */

export const gitKey = (roomId: string, what: "status" | "branches" | "log") => ["sandbox-git", roomId, what] as const;

function stateVector(doc: Y.Doc): string {
  let binary = "";
  for (const byte of Y.encodeStateVector(doc)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** One request; ops that read the files carry this browser's state vector, so git sees its latest edits. */
export function gitRequest<Op extends GitResponse["op"]>(roomId: string, doc: Y.Doc, request: GitRequestInput & { op: Op }): Promise<Extract<GitResponse, { op: Op }>> {
  const withEdits = request.op === "status" || request.op === "stage" || request.op === "commit" ? { ...request, stateVector: stateVector(doc) } : request;
  return api<Extract<GitResponse, { op: Op }>>(`/api/rooms/${roomId}/git`, { method: "POST", json: withEdits });
}

/** The repository's status, kept fresh while it's shown. */
export function useGitStatus(enabled: boolean) {
  const { room, doc } = useRoom();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: gitKey(room.id, "status"),
    queryFn: async () => (await gitRequest(room.id, doc, { op: "status" })).status,
    enabled,
    staleTime: 2000,
    // Files may have changed while the view was closed (no listener then): ask again whenever it opens.
    refetchOnMount: "always",
    // git used from a terminal can change only .git, which never reaches the room's files.
    refetchInterval: enabled ? 20_000 : false,
    retry: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // At most once every 1.5 s, starting from the first change: a busy room still gets fresh status.
    const onUpdate = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void client.invalidateQueries({ queryKey: gitKey(room.id, "status") });
      }, 1500);
    };
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [enabled, doc, client, room.id]);
  return query;
}

/** Put a status an operation returned in place, and let branches and history reload. */
export function useGitApply() {
  const { room } = useRoom();
  const client = useQueryClient();
  return (status: GitStatus, { history = false } = {}) => {
    client.setQueryData(gitKey(room.id, "status"), status);
    void client.invalidateQueries({ queryKey: gitKey(room.id, "branches") });
    if (history) void client.invalidateQueries({ queryKey: gitKey(room.id, "log") });
  };
}
