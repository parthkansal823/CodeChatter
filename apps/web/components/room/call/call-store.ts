"use client";

import type { CallJoin } from "@codechatter/contracts";
import { Room, RoomEvent, Track, type Participant } from "livekit-client";
import { toast } from "sonner";
import { create } from "zustand";

import { api, ApiError } from "@/lib/api";

/**
 * The room's call (LiveKit) in this tab: joining with a token from the API, your
 * microphone, camera and screen, and everyone in it. LiveKit's own objects change in
 * place, so `version` goes up whenever anything about the call does and the dock reads
 * it again. One call at a time: joining another room's leaves this one.
 */
type State = {
  room: Room | null;
  roomId: string | null;
  status: "idle" | "joining" | "joined";
  version: number;
  join: (roomId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggle: (what: "microphone" | "camera" | "screen") => Promise<void>;
};

/** Remote audio plays from elements of its own, outside the dock, so closing the dock keeps the sound. */
const audio = new Map<string, HTMLMediaElement>();

export const useCall = create<State>()((set, get) => ({
  room: null,
  roomId: null,
  status: "idle",
  version: 0,

  join: async (roomId) => {
    if (get().status !== "idle") await get().leave();
    set({ status: "joining", roomId });
    try {
      const { url, token } = await api<CallJoin>(`/api/rooms/${roomId}/call`, { method: "POST" });
      const room = new Room({ adaptiveStream: true, dynacast: true });
      const bump = () => set((state) => ({ version: state.version + 1 }));
      room
        .on(RoomEvent.ParticipantConnected, bump)
        .on(RoomEvent.ParticipantDisconnected, bump)
        .on(RoomEvent.TrackPublished, bump)
        .on(RoomEvent.TrackUnpublished, bump)
        .on(RoomEvent.TrackMuted, bump)
        .on(RoomEvent.TrackUnmuted, bump)
        .on(RoomEvent.LocalTrackPublished, bump)
        .on(RoomEvent.LocalTrackUnpublished, bump)
        .on(RoomEvent.ActiveSpeakersChanged, bump)
        .on(RoomEvent.TrackSubscribed, (track, publication) => {
          if (track.kind === Track.Kind.Audio) {
            const element = track.attach();
            element.dataset.callAudio = publication.trackSid;
            document.body.appendChild(element);
            audio.set(publication.trackSid, element);
          }
          bump();
        })
        .on(RoomEvent.TrackUnsubscribed, (track, publication) => {
          track.detach();
          audio.get(publication.trackSid)?.remove();
          audio.delete(publication.trackSid);
          bump();
        })
        .on(RoomEvent.Disconnected, () => {
          for (const element of audio.values()) element.remove();
          audio.clear();
          set({ room: null, roomId: null, status: "idle", version: get().version + 1 });
        });
      // A local relay drill must not silently succeed over a direct media path.
      // Next replaces NODE_ENV at build time, so production ignores this query.
      const relayOnly = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("callRelay") === "1";
      await room.connect(url, token, relayOnly ? { rtcConfig: { iceTransportPolicy: "relay" } } : undefined);
      set({ room, status: "joined" });
      // Join with the microphone on; no microphone (or no permission) still joins, to listen.
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => toast.message("Joined without a microphone: the browser has none, or wasn't allowed to use it."));
      bump();
    } catch (error) {
      set({ room: null, roomId: null, status: "idle" });
      toast.error(error instanceof ApiError ? error.detail : "Couldn't join the call. Check the connection and try again.");
    }
  },

  leave: async () => {
    const { room } = get();
    set({ room: null, roomId: null, status: "idle" });
    await room?.disconnect();
  },

  toggle: async (what) => {
    const { room } = get();
    if (!room) return;
    const me = room.localParticipant;
    try {
      if (what === "microphone") await me.setMicrophoneEnabled(!me.isMicrophoneEnabled);
      else if (what === "camera") await me.setCameraEnabled(!me.isCameraEnabled);
      else await me.setScreenShareEnabled(!me.isScreenShareEnabled, { audio: false });
    } catch {
      toast.error(
        what === "screen"
          ? "Couldn't share the screen (the browser wasn't allowed to)."
          : `Couldn't turn the ${what} on: the browser has none, or wasn't allowed to use it.`,
      );
    }
    set((state) => ({ version: state.version + 1 }));
  },
}));

/** Everyone in the call, you first. */
export function callParticipants(room: Room | null): Participant[] {
  if (!room) return [];
  return [room.localParticipant, ...room.remoteParticipants.values()];
}
