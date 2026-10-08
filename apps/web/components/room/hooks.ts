"use client";

import { listTree, maps, type TreeNode } from "@codechatter/workspace-model";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { PresenceState } from "@/components/room/room-context";
import { useRoom } from "@/components/room/room-context";

/** The live file tree; re-renders when any node changes, never on text edits. */
export function useFileTree(): TreeNode[] {
  const { doc } = useRoom();
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const nodes = maps(doc).nodes;
      const handler = () => {
        version.current += 1;
        onChange();
      };
      nodes.observeDeep(handler);
      return () => nodes.unobserveDeep(handler);
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => listTree(doc), [doc, tick]);
}

export type Peer = PresenceState & { clientId: number };

/** Everyone else in the room (awareness), one entry per person. */
export function usePeers(): Peer[] {
  const { provider, me } = useRoom();
  const awareness = provider.awareness!;
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        version.current += 1;
        onChange();
      };
      awareness.on("change", handler);
      return () => awareness.off("change", handler);
    },
    [awareness],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  return useMemo(() => {
    const peers = new Map<string, Peer>();
    awareness.getStates().forEach((state, clientId) => {
      const s = state as Partial<PresenceState>;
      // Not me, in this tab or any other; one person with two tabs shows once.
      if (clientId === awareness.clientID || !s.user || s.user.id === me.user.id) return;
      if (!peers.has(s.user.id)) peers.set(s.user.id, { user: s.user, activeFileId: s.activeFileId ?? null, clientId });
    });
    return [...peers.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness, me.user.id, tick]);
}
