/**
 * Turning the camera and screen on, for an assessment that records. On the start page it's a check
 * before the clock starts. In the room it holds the test back whenever one goes off (after a
 * reload, or if they stop sharing), and the time keeps running.
 */
"use client";

import { RECORDING_STREAM_LABEL, type RecordingStream, type RoomInterview } from "@codechatter/contracts";
import { Camera, Check, Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { canShareScreen, heldStream, startRecording, stopRecording, turnOn, useRecording, WholeScreenNeeded } from "./recorder";

const ICON = { webcam: Camera, screen: Monitor };
const ASK = { webcam: "Turn on my camera", screen: "Share my whole screen" };

function Preview({ stream }: { stream: RecordingStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = heldStream(stream);
  }, [stream]);
  return <video ref={video} autoPlay muted playsInline aria-label={`Your ${stream === "webcam" ? "camera" : "screen"}`} className="h-24 w-full rounded-sm bg-panel object-cover" />;
}

/** A button for each thing to turn on, and a preview of each once it is. */
export function TurnOnRecording({ wanted }: { wanted: readonly RecordingStream[] }) {
  const live = useRecording((state) => state.live);
  const [problem, setProblem] = useState<string | null>(null);
  async function ask(stream: RecordingStream) {
    setProblem(null);
    try {
      await turnOn(stream);
    } catch (error) {
      if (error instanceof WholeScreenNeeded) setProblem(error.message);
      else if ((error as Error).name === "NotAllowedError") setProblem(`Your browser didn't get permission. Allow your ${stream === "webcam" ? "camera" : "screen"} and try again.`);
      else if ((error as Error).name === "NotFoundError") setProblem("No camera was found. Plug one in and try again.");
      else setProblem("That didn't work. Try again, or try another browser.");
    }
  }
  return (
    <div className="grid gap-2 text-left">
      <div className="grid gap-2 sm:grid-cols-2">
        {wanted.map((stream) => {
          const Icon = ICON[stream];
          return live[stream] ? (
            <div key={stream} className="grid gap-1">
              <Preview stream={stream} />
              <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5 text-brand" /> {RECORDING_STREAM_LABEL[stream]} is on</span>
            </div>
          ) : (
            <Button key={stream} type="button" variant="outline" disabled={stream === "screen" && !canShareScreen()} onClick={() => void ask(stream)}>
              <Icon /> {ASK[stream]}
            </Button>
          );
        })}
      </div>
      {wanted.includes("screen") && !canShareScreen() && <p role="alert" className="text-destructive">This browser can&apos;t share a screen. Open your link on a computer, in Chrome, Edge or Firefox.</p>}
      {problem && <p role="alert" className="text-destructive">{problem}</p>}
    </div>
  );
}

/** In the room: recording while it runs, stopped when it ends, and nothing else can be used while something's off. */
export function RecordingGate({ interview }: { interview: RoomInterview }) {
  const { room } = useRoom();
  const live = useRecording((state) => state.live);
  const wanted: RecordingStream[] = [...(interview.recordWebcam ? (["webcam"] as const) : []), ...(interview.recordScreen ? (["screen"] as const) : [])];
  const running = interview.status === "live";
  const wantsWebcam = interview.recordWebcam && live.webcam;
  const wantsScreen = interview.recordScreen && live.screen;

  useEffect(() => {
    if (!running) return;
    if (wantsWebcam) startRecording(room.id, "webcam");
    if (wantsScreen) startRecording(room.id, "screen");
  }, [running, room.id, wantsWebcam, wantsScreen]);

  useEffect(() => {
    if (!running) void stopRecording();
  }, [running]);

  if (!running || wanted.every((stream) => live[stream])) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Recording" className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-wide text-xl font-semibold">This assessment needs recording on</h2>
      <p className="max-w-sm text-muted-foreground">Your time keeps running. Turning it off goes on the record your assessor sees.</p>
      <div className="w-full max-w-md"><TurnOnRecording wanted={wanted} /></div>
    </div>
  );
}
