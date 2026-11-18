/** Keep tour playback and editor add requests local to this person, never in a shared document or awareness. */
"use client";

import { create } from "zustand";
import type { TourStopAnchor } from "@codechatter/workspace-model";

export type TourMark = { fileId: string; startLine: number; endLine: number };
export type AddTourStopRequest = TourMark & { roomId: string; anchor: TourStopAnchor };
type Playback = {
  tourId: string | null;
  stopId: string | null;
  mark: TourMark | null;
  navigationRevision: number;
};
type PlaybackStore = {
  byRoom: Record<string, Playback>;
  play: (roomId: string, tourId: string, stopId: string) => void;
  stop: (roomId: string) => void;
  setMark: (roomId: string, mark: TourMark | null) => void;
};

export const useToursPlayback = create<PlaybackStore>((set) => ({
  byRoom: {},
  play: (roomId, tourId, stopId) =>
    set((state) => ({
      byRoom: {
        ...state.byRoom,
        [roomId]: {
          tourId,
          stopId,
          mark: null,
          navigationRevision: (state.byRoom[roomId]?.navigationRevision ?? 0) + 1,
        },
      },
    })),
  stop: (roomId) =>
    set((state) => ({
      byRoom: {
        ...state.byRoom,
        [roomId]: {
          tourId: null,
          stopId: null,
          mark: null,
          navigationRevision: state.byRoom[roomId]?.navigationRevision ?? 0,
        },
      },
    })),
  setMark: (roomId, mark) =>
    set((state) => {
      const current = state.byRoom[roomId];
      if (
        !current ||
        (current.mark?.fileId === mark?.fileId &&
          current.mark?.startLine === mark?.startLine &&
          current.mark?.endLine === mark?.endLine)
      )
        return state;
      return { byRoom: { ...state.byRoom, [roomId]: { ...current, mark } } };
    }),
}));

export const useTourRequests = create<{
  pending: AddTourStopRequest | null;
  request: (request: AddTourStopRequest | null) => void;
}>((set) => ({
  pending: null,
  request: (pending) => set({ pending }),
}));

export function requestAddTourStop(request: AddTourStopRequest) {
  useTourRequests.getState().request(request);
}
