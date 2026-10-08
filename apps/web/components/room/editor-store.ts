"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Open tabs per room, remembered per browser so a reload lands where you were. */
type TabsState = {
  byRoom: Record<string, { open: string[]; active: string | null }>;
  /** Most recently opened files per room (newest first), for Quick Open. */
  recentByRoom: Record<string, string[]>;
  open: (roomId: string, fileId: string) => void;
  close: (roomId: string, fileId: string) => void;
  prune: (roomId: string, liveFileIds: Set<string>) => void;
};

const MAX_RECENT = 50;
const NO_FILES: string[] = [];

export const useTabs = create<TabsState>()(
  persist(
    (set) => ({
      byRoom: {},
      recentByRoom: {},
      open: (roomId, fileId) =>
        set((state) => {
          const current = state.byRoom[roomId] ?? { open: [], active: null };
          const open = current.open.includes(fileId) ? current.open : [...current.open, fileId];
          const recent = [fileId, ...(state.recentByRoom[roomId] ?? []).filter((id) => id !== fileId)].slice(0, MAX_RECENT);
          return { byRoom: { ...state.byRoom, [roomId]: { open, active: fileId } }, recentByRoom: { ...state.recentByRoom, [roomId]: recent } };
        }),
      close: (roomId, fileId) =>
        set((state) => {
          const current = state.byRoom[roomId] ?? { open: [], active: null };
          const index = current.open.indexOf(fileId);
          const open = current.open.filter((id) => id !== fileId);
          // Closing the active tab activates its neighbour, like every editor.
          const active = current.active === fileId ? (open[index] ?? open[index - 1] ?? null) : current.active;
          return { byRoom: { ...state.byRoom, [roomId]: { open, active } } };
        }),
      prune: (roomId, live) =>
        set((state) => {
          const current = state.byRoom[roomId];
          if (!current) return state;
          const open = current.open.filter((id) => live.has(id));
          const active = current.active && live.has(current.active) ? current.active : (open[0] ?? null);
          if (open.length === current.open.length && active === current.active) return state;
          return { byRoom: { ...state.byRoom, [roomId]: { open, active } } };
        }),
    }),
    { name: "cc-tabs" },
  ),
);

export function useRoomTabs(roomId: string) {
  return useTabs((state) => state.byRoom[roomId]) ?? { open: [] as string[], active: null as string | null };
}

export function useRecentFiles(roomId: string): string[] {
  return useTabs((state) => state.recentByRoom[roomId]) ?? NO_FILES;
}
