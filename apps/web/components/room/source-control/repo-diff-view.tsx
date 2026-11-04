"use client";

import { TextDiffView } from "@/components/room/editor/text-diff-view";

import { useBaseFiles, useRoomRepo } from "./use-repo";

/**
 * A file as it is on GitHub (at the commit the room last synced with, read-only) beside
 * the room's live file, which can be edited here. An added file has nothing on the left,
 * a deleted one nothing on the right.
 */
export function RepoDiffView({ path, onClose }: { path: string; onClose: () => void }) {
  const repo = useRoomRepo();
  const base = useBaseFiles(repo?.commit);
  return (
    <TextDiffView
      path={path}
      before={base?.get(path)}
      loaded={Boolean(base)}
      scheme="github-base"
      title={
        <>
          {path} on GitHub
          {repo && (
            <>
              {" "}
              ({repo.branch}, {repo.commit.slice(0, 7)})
            </>
          )}
        </>
      }
      onClose={onClose}
    />
  );
}
