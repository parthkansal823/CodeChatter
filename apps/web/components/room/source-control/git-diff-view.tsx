"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { TextDiffView } from "@/components/room/editor/text-diff-view";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { gitRequest, useGitStatus } from "./sandbox-git";

/**
 * A file as it is in the sandbox repository's last commit (read-only) beside the room's
 * live file, which can be edited here. A file that's new since that commit has nothing on
 * the left; a binary one is named, not compared.
 */
export function GitDiffView({ path, onClose }: { path: string; onClose: () => void }) {
  const { room, doc } = useRoom();
  const status = useGitStatus(false).data;
  const head = status?.repo ? status.head : null;
  const shown = useQuery({
    queryKey: ["sandbox-git", room.id, "show", path, head],
    queryFn: () => gitRequest(room.id, doc, { op: "show", path, at: "head" }),
    staleTime: 30_000,
    retry: false,
  });
  const title = (
    <>
      {path} at {head ? <span className="font-mono">{head}</span> : "the last commit"} (git in the sandbox)
    </>
  );
  if (shown.data?.binary)
    return (
      <section aria-label="Comparison" className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
          <span className="truncate text-muted-foreground">{title}</span>
          <Button variant="ghost" size="icon-xs" aria-label="Close the comparison" className="ml-auto" onClick={onClose}>
            <X />
          </Button>
        </div>
        <p className="p-4 text-xs text-muted-foreground">A binary file: git keeps its bytes, but there&apos;s no text to compare.</p>
      </section>
    );
  return (
    <TextDiffView
      path={path}
      before={shown.data?.text ?? undefined}
      loaded={!shown.isPending}
      scheme={`git-${room.id}-${head ?? "none"}`}
      title={title}
      onClose={onClose}
    />
  );
}
