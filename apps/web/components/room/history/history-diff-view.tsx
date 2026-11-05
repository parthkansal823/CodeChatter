"use client";

import type { BlobRef } from "@codechatter/contracts";
import { blobView } from "@codechatter/contracts";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { TextDiffView } from "@/components/room/editor/text-diff-view";
import { useRoomFiles } from "@/components/room/editor/room-files";
import { useRoom } from "@/components/room/room-context";
import { markedBlob } from "@/components/room/source-control/room-files";
import { Button } from "@/components/ui/button";
import { blobUrl, formatBytes } from "@/lib/blobs";

import { checkpointTitle, useCheckpointFiles, useCheckpoints } from "./checkpoints";

/**
 * A file as it was at a checkpoint (read-only) beside the live file, which can be edited
 * here. A binary file on either side is compared by what it is (images side by side)
 * instead of as text.
 */
export function HistoryDiffView({ checkpointId, path, onClose }: { checkpointId: string; path: string; onClose: () => void }) {
  const files = useCheckpointFiles(checkpointId);
  const live = useRoomFiles().find((node) => node.path === path);
  const checkpoint = useCheckpoints()?.find((c) => c.id === checkpointId);
  const when = checkpoint ? new Date(checkpoint.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const title = (
    <>
      {path} at “{checkpoint ? checkpointTitle(checkpoint) : "a checkpoint"}”{when && <> ({when})</>}
    </>
  );
  const before = files?.get(path);
  const beforeBlob = markedBlob(before);
  if (beforeBlob || live?.blob) {
    return (
      <BlobDiff
        title={title}
        before={beforeBlob ?? (before === undefined ? null : "text")}
        now={live?.blob ?? (live ? "text" : null)}
        onClose={onClose}
      />
    );
  }
  return <TextDiffView path={path} before={before} loaded={Boolean(files)} scheme={`checkpoint-${checkpointId}`} title={title} onClose={onClose} />;
}

type Side = BlobRef | "text" | null;

function BlobDiff({ title, before, now, onClose }: { title: ReactNode; before: Side; now: Side; onClose: () => void }) {
  return (
    <section aria-label="Comparison" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate text-muted-foreground">{title}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close the comparison" className="ml-auto" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x overflow-auto">
        <BlobSide label="At the checkpoint" side={before} />
        <BlobSide label="Now" side={now} />
      </div>
    </section>
  );
}

function BlobSide({ label, side }: { label: string; side: Side }) {
  const { room } = useRoom();
  return (
    <div className="flex min-h-0 flex-col gap-2 p-3">
      <span className="text-xs font-medium">{label}</span>
      {side === null ? (
        <p className="text-xs text-muted-foreground">The file wasn&apos;t there.</p>
      ) : side === "text" ? (
        <p className="text-xs text-muted-foreground">A text file. Restore to swap it with the other side.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {side.type} · {formatBytes(side.size)}
          </p>
          {blobView(side.type) === "image" && (
            <div className="grid flex-1 place-items-center rounded-sm bg-muted/40 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a room file from the API */}
              <img src={blobUrl(room.id, side.sha256)} alt={`${label}`} className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
