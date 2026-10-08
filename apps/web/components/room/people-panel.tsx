"use client";

import { flatten, type TreeNode } from "@codechatter/workspace-model";

import { PresenceAvatar, presenceVar } from "@/components/presence/presence";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";

/** Who is here and which file each person is in. Click to jump to their file. */
export function PeoplePanel({ tree, onOpen }: { tree: TreeNode[]; onOpen: (node: TreeNode) => void }) {
  const { me, mySlot } = useRoom();
  const peers = usePeers();
  const files = new Map(flatten(tree).map((n) => [n.id, n]));

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-muted-foreground">
        People here <span className="ml-1.5 tabular-nums">{peers.length + 1}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <li className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
          <PresenceAvatar name={me.user.name} image={me.user.image} slot={mySlot} size={26} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{me.user.name} (you)</span>
          </span>
        </li>
        {peers.map((peer) => {
          const file = peer.activeFileId ? files.get(peer.activeFileId) : undefined;
          return (
            <li key={peer.user.id}>
              <button
                type="button"
                disabled={!file}
                onClick={() => file && onOpen(file)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:hover:bg-transparent"
                title={file ? `Open ${file.path}` : undefined}
              >
                <PresenceAvatar name={peer.user.name} image={peer.user.image} slot={peer.user.slot} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{peer.user.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {file && <span aria-hidden className="h-3 w-thread rounded-full" style={{ backgroundColor: presenceVar(peer.user.slot) }} />}
                    {file ? file.path : "Looking around"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {peers.length === 0 && (
          <li className="px-2 pt-4 text-xs text-muted-foreground">
            Nobody else is here yet. Share the room code from the top bar and you’ll see them arrive.
          </li>
        )}
      </ul>
    </div>
  );
}
