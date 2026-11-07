"use client";

import type { RoomActivityItem } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, GitBranch, GitCommitHorizontal, GitPullRequest, Pencil, Settings2, Upload, UserPlus } from "lucide-react";

import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

const ICON: Record<RoomActivityItem["kind"], typeof Pencil> = {
  edits: Pencil,
  commit: GitCommitHorizontal,
  publish: Upload,
  "pull-request": GitPullRequest,
  checkpoint: Bookmark,
  joined: UserPlus,
  github: GitBranch,
  settings: Settings2,
};

/**
 * The room's activity over the last week (a side tool), newest first: who edited what
 * (by the hour), commits and pull requests, saved checkpoints, who joined, and the
 * repository's activity. Read again every minute while it's open.
 */
export default function ActivityTool(_: RoomToolProps) {
  const { room } = useRoom();
  const feed = useQuery({
    queryKey: ["room-activity", room.id],
    queryFn: () => api<{ items: RoomActivityItem[] }>(`/api/rooms/${room.id}/activity`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  return (
    <section aria-label="Activity" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-muted-foreground">The last 7 days</div>
      {/* Nothing in here takes focus, so it does: that's how a keyboard scrolls it. */}
      <div tabIndex={0} role="group" aria-label="The last 7 days" className="min-h-0 flex-1 overflow-y-auto pb-2">
        {!feed.data ? (
          <p className="px-3 text-xs text-muted-foreground">{feed.isError ? "Couldn't load the activity." : "Reading the room's activity…"}</p>
        ) : feed.data.length === 0 ? (
          <p className="px-3 text-xs text-muted-foreground">Nothing yet this week.</p>
        ) : (
          <ol aria-label="Activity" className="grid">
            {feed.data.map((item, index) => {
              const Icon = ICON[item.kind];
              return (
                <li key={`${item.at}-${index}`} className="flex gap-2 px-3 py-1.5 text-xs">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 break-words">
                    {item.who && <span className="font-medium">{item.who} </span>}
                    {item.text}
                  </span>
                  <time dateTime={item.at} title={new Date(item.at).toLocaleString()} className="shrink-0 text-muted-foreground">
                    {formatRelativeTime(item.at)}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
