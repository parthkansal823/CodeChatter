"use client";

import { TextDiffView } from "@/components/room/editor/text-diff-view";

import { checkpointTitle, useCheckpointFiles, useCheckpoints } from "./checkpoints";

/** A file as it was at a checkpoint (read-only) beside the live file, which can be edited here. */
export function HistoryDiffView({ checkpointId, path, onClose }: { checkpointId: string; path: string; onClose: () => void }) {
  const files = useCheckpointFiles(checkpointId);
  const checkpoint = useCheckpoints()?.find((c) => c.id === checkpointId);
  const when = checkpoint ? new Date(checkpoint.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <TextDiffView
      path={path}
      before={files?.get(path)}
      loaded={Boolean(files)}
      scheme={`checkpoint-${checkpointId}`}
      title={
        <>
          {path} at “{checkpoint ? checkpointTitle(checkpoint) : "a checkpoint"}”{when && <> ({when})</>}
        </>
      }
      onClose={onClose}
    />
  );
}
