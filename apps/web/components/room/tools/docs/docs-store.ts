"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type RoomDocsState = { current: string | null; expanded: string[]; favourites: string[] };

/**
 * Per-browser docs preferences for each room: the page you had open, which
 * tree rows are expanded, and your favourites. They're personal, so they stay
 * out of the shared page index.
 */
type DocsStore = {
  byRoom: Record<string, RoomDocsState>;
  setCurrent: (roomId: string, pageId: string | null) => void;
  setExpanded: (roomId: string, pageId: string, open: boolean) => void;
  toggleFavourite: (roomId: string, pageId: string) => void;
};

const EMPTY: RoomDocsState = { current: null, expanded: [], favourites: [] };

export const useDocsStore = create<DocsStore>()(
  persist(
    (set) => {
      const patch = (roomId: string, update: (room: RoomDocsState) => Partial<RoomDocsState>) =>
        set((state) => {
          const room = state.byRoom[roomId] ?? EMPTY;
          return { byRoom: { ...state.byRoom, [roomId]: { ...room, ...update(room) } } };
        });
      return {
        byRoom: {},
        setCurrent: (roomId, pageId) => patch(roomId, () => ({ current: pageId })),
        setExpanded: (roomId, pageId, open) =>
          patch(roomId, (room) => ({
            expanded: open ? [...new Set([...room.expanded, pageId])] : room.expanded.filter((id) => id !== pageId),
          })),
        toggleFavourite: (roomId, pageId) =>
          patch(roomId, (room) => ({
            favourites: room.favourites.includes(pageId) ? room.favourites.filter((id) => id !== pageId) : [...room.favourites, pageId],
          })),
      };
    },
    { name: "cc-docs" },
  ),
);

export function useRoomDocsState(roomId: string): RoomDocsState {
  return useDocsStore((state) => state.byRoom[roomId]) ?? EMPTY;
}
