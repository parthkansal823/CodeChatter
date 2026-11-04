"use client";

import { Track, type Participant } from "livekit-client";
import { ChevronDown, ChevronUp, Mic, MicOff, MonitorUp, Phone, PhoneOff, PictureInPicture2, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { callParticipants, useCall } from "./call-store";

/**
 * The room's call, docked in the corner while you're in it: a tile per person (their
 * camera, or their initial; a ring while they speak), anyone's shared screen large, and
 * your microphone, camera, screen and Leave. A video can go picture-in-picture, to keep
 * watching from another tab. Leaving the room leaves the call.
 */
export function CallDock() {
  const { provider, room: codeRoom } = useRoom();
  const room = useCall((state) => state.room);
  const status = useCall((state) => state.status);
  const version = useCall((state) => state.version);
  const callRoomId = useCall((state) => state.roomId);
  const [open, setOpen] = useState(true);

  // Everyone in the room can see who's in the call (the title bar's button counts them).
  useEffect(() => {
    provider.setAwarenessField("inCall", status === "joined" && callRoomId === codeRoom.id);
  }, [provider, status, callRoomId, codeRoom.id]);
  // Leaving the room leaves its call.
  useEffect(() => () => void useCall.getState().leave(), [codeRoom.id]);

  // LiveKit's participants change in place: `version` says when to read them again.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
  const people = useMemo(() => callParticipants(room), [room, version]);
  if (status !== "joined" || !room || callRoomId !== codeRoom.id) return null;
  const me = room.localParticipant;
  const screens = people.filter((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track);

  return (
    <section
      aria-label="Call"
      className="fixed right-3 bottom-8 z-40 grid w-[min(28rem,calc(100vw-1.5rem))] gap-2 rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-2">
        <Phone className="size-3.5 text-brand" />
        <span className="font-medium">{people.length === 1 ? "Just you in the call" : `${people.length} in the call`}</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={open ? "Fold the call" : "Unfold the call"} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>
      {open && (
        <>
          {screens.map((p) => (
            <Tile key={`${p.identity}-screen`} participant={p} source={Track.Source.ScreenShare} version={version} large />
          ))}
          <ul aria-label="People in the call" className="grid grid-cols-3 gap-1.5">
            {people.map((p) => (
              <li key={p.identity}>
                <Tile participant={p} source={Track.Source.Camera} version={version} isMe={p === me} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div role="toolbar" aria-label="Call controls" className="flex items-center gap-1">
        <Control on={me.isMicrophoneEnabled} label={["Mute your microphone", "Unmute your microphone"]} icons={[Mic, MicOff]} onClick={() => void useCall.getState().toggle("microphone")} />
        <Control on={me.isCameraEnabled} label={["Turn your camera off", "Turn your camera on"]} icons={[Video, VideoOff]} onClick={() => void useCall.getState().toggle("camera")} />
        <Control on={me.isScreenShareEnabled} label={["Stop sharing your screen", "Share your screen"]} icons={[MonitorUp, MonitorUp]} onClick={() => void useCall.getState().toggle("screen")} />
        <Button variant="destructive" size="sm" className="ml-auto h-7 text-xs" onClick={() => void useCall.getState().leave()}>
          <PhoneOff className="size-3.5" /> Leave
        </Button>
      </div>
    </section>
  );
}

function Control({ on, label, icons, onClick }: { on: boolean; label: [string, string]; icons: [typeof Mic, typeof Mic]; onClick: () => void }) {
  const Icon = on ? icons[0] : icons[1];
  return (
    <Button variant={on ? "secondary" : "ghost"} size="icon-sm" aria-pressed={on} aria-label={on ? label[0] : label[1]} title={on ? label[0] : label[1]} onClick={onClick}>
      <Icon />
    </Button>
  );
}

/** One person's camera (or initial), or their shared screen when `large`. */
function Tile({ participant, source, version, isMe = false, large = false }: { participant: Participant; source: Track.Source; version: number; isMe?: boolean; large?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const publication = participant.getTrackPublication(source);
  const track = publication?.track && !publication.isMuted ? publication.track : null;
  const name = isMe ? `${participant.name || "You"} (you)` : participant.name || "Someone";

  useEffect(() => {
    const element = video.current;
    if (!track || !element) return;
    track.attach(element);
    return () => void track.detach(element);
    // version: the same track object can come back after a mute
  }, [track, version]);

  const pip = async () => {
    try {
      if (document.pictureInPictureElement === video.current) await document.exitPictureInPicture();
      else await video.current?.requestPictureInPicture();
    } catch {
      // The browser said no (no picture-in-picture here): nothing to do.
    }
  };

  return (
    <div
      role="group"
      aria-label={large ? `${name}'s screen` : name}
      data-speaking={participant.isSpeaking || undefined}
      className={cn(
        "group relative flex items-center justify-center overflow-hidden rounded-md bg-muted",
        large ? "aspect-video" : "aspect-[4/3]",
        participant.isSpeaking && "ring-2 ring-brand",
      )}
    >
      {track ? (
        <video ref={video} autoPlay playsInline muted={isMe} className={cn("size-full", large ? "object-contain" : "object-cover")} />
      ) : (
        <span aria-hidden className="text-lg font-medium text-muted-foreground">
          {(participant.name || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute bottom-1 left-1 flex max-w-[calc(100%-0.5rem)] items-center gap-1 truncate rounded-sm bg-background/80 px-1 text-[11px]">
        {!large && !participant.isMicrophoneEnabled && <MicOff aria-label="Microphone off" className="size-3 shrink-0" />}
        <span className="truncate">{large ? `${name}'s screen` : name}</span>
      </span>
      {track && typeof document !== "undefined" && document.pictureInPictureEnabled && (
        <Button
          variant="secondary"
          size="icon-xs"
          aria-label="Picture in picture"
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => void pip()}
        >
          <PictureInPicture2 />
        </Button>
      )}
    </div>
  );
}

/** The title bar's call button: join (saying who's in it already), or show that you're in it. */
export function CallButton() {
  const { room, can } = useRoom();
  const peers = usePeers();
  const status = useCall((state) => state.status);
  const callRoomId = useCall((state) => state.roomId);
  const inThisCall = status !== "idle" && callRoomId === room.id;
  const others = peers.filter((peer) => peer.inCall).length;
  if (!can("room.chat")) return null;
  return (
    <Button
      variant={inThisCall ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={inThisCall}
      disabled={status === "joining"}
      title={inThisCall ? "You're in the call" : "Video, voice and screen sharing with the room"}
      onClick={() => (inThisCall ? undefined : void useCall.getState().join(room.id))}
    >
      <Phone />
      {status === "joining" && callRoomId === room.id ? "Joining…" : inThisCall ? "In call" : others ? `Join call (${others})` : "Call"}
    </Button>
  );
}
