/**
 * Recording a candidate's camera and screen, for an assessment that says so and that they agreed
 * to. Streams are held here rather than in a component, so the ones turned on at the start page
 * carry on into the room. Each stream records half-minute clips, one after another, that each
 * play by themselves, so one lost upload doesn't spoil the rest. No sound is recorded.
 */
"use client";

import { RECORDING_CLIP_MS, type RecordingStream } from "@codechatter/contracts";
import { create } from "zustand";

import { noteIntegrity } from "./integrity-queue";

/** Enough to see what's happening, and small enough for a home connection and for storage. */
const BITS_PER_SECOND: Record<RecordingStream, number> = { webcam: 150_000, screen: 400_000 };
const UPLOAD_TRIES = 3;
const STOP_WAIT_MS = 3000;

export const useRecording = create<{ live: Record<RecordingStream, boolean> }>(() => ({ live: { webcam: false, screen: false } }));

const streams = new Map<RecordingStream, MediaStream>();
const recorders = new Map<RecordingStream, ClipRecorder>();
const setLive = (stream: RecordingStream, on: boolean) => useRecording.setState((state) => ({ live: { ...state.live, [stream]: on } }));

/** Phones can't share a screen. */
export const canShareScreen = (): boolean => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
export const heldStream = (stream: RecordingStream): MediaStream | null => streams.get(stream) ?? null;

export class WholeScreenNeeded extends Error {}

/** Ask for the camera or the screen: this has to come from something they clicked. */
export async function turnOn(stream: RecordingStream): Promise<void> {
  const media =
    stream === "webcam"
      ? await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 10 } } })
      : await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { displaySurface: "monitor", frameRate: { ideal: 5 }, width: { ideal: 1280 } } } as DisplayMediaStreamOptions);
  const track = media.getVideoTracks()[0]!;
  // A tab or a window would hide everything else. Only some browsers say which it is.
  const surface = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  if (stream === "screen" && surface && surface !== "monitor") {
    for (const each of media.getTracks()) each.stop();
    throw new WholeScreenNeeded("Share your whole screen, not a window or a tab.");
  }
  track.addEventListener("ended", () => stopped(stream));
  streams.set(stream, media);
  setLive(stream, true);
}

/** They stopped sharing, or a camera went away. The page asks for it again, and it goes on the record. */
function stopped(stream: RecordingStream): void {
  void recorders.get(stream)?.stop();
  recorders.delete(stream);
  streams.delete(stream);
  setLive(stream, false);
  noteIntegrity(stream === "webcam" ? "camera-stopped" : "screen-stopped");
}

function videoType(): string {
  for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) if (MediaRecorder.isTypeSupported(type)) return type;
  return "";
}

class ClipRecorder {
  private current: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping = false;
  private readonly uploads = new Set<Promise<void>>();
  private lastEnded: (() => void) | null = null;

  constructor(
    private readonly roomId: string,
    private readonly stream: RecordingStream,
    private readonly media: MediaStream,
  ) {}

  start(): void {
    if (this.stopping || !this.media.active) return;
    const type = videoType();
    const startedAt = new Date();
    const parts: Blob[] = [];
    const recorder = new MediaRecorder(this.media, { videoBitsPerSecond: BITS_PER_SECOND[this.stream], ...(type && { mimeType: type }) });
    recorder.ondataavailable = (event) => {
      if (event.data.size) parts.push(event.data);
    };
    recorder.onstop = () => {
      if (parts.length) this.send(new Blob(parts, { type: recorder.mimeType || type }), startedAt, Date.now() - startedAt.getTime());
      this.lastEnded?.();
      this.start();
    };
    recorder.start();
    this.current = recorder;
    this.timer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, RECORDING_CLIP_MS);
  }

  private send(clip: Blob, startedAt: Date, durationMs: number): void {
    const query = new URLSearchParams({ stream: this.stream, startedAt: startedAt.toISOString(), durationMs: String(Math.round(durationMs)) });
    const upload = (async () => {
      for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
        const response = await fetch(`/api/rooms/${this.roomId}/interview/recordings?${query}`, { method: "POST", body: clip, headers: { "content-type": clip.type || "video/webm" }, credentials: "same-origin" }).catch(() => null);
        // A refusal won't change by asking again. The server notices when clips stop arriving.
        if (response && (response.ok || response.status < 500)) return;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    })();
    this.uploads.add(upload);
    void upload.finally(() => this.uploads.delete(upload));
  }

  /** End the clip in progress and wait for what's being sent. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.current?.state === "recording") {
      await new Promise<void>((resolve) => {
        this.lastEnded = resolve;
        this.current!.stop();
      });
    }
    await Promise.allSettled([...this.uploads]);
  }
}

/** Record what's turned on. Safe to call again: what's already recording carries on. */
export function startRecording(roomId: string, stream: RecordingStream): void {
  const media = streams.get(stream);
  if (!media || recorders.has(stream)) return;
  const recorder = new ClipRecorder(roomId, stream, media);
  recorders.set(stream, recorder);
  recorder.start();
}

/** It's over: finish up, and let go of the camera and the screen, so the browser stops saying they're in use. */
export async function stopRecording(): Promise<void> {
  const finishing = [...recorders.values()].map((recorder) => recorder.stop());
  recorders.clear();
  await Promise.race([Promise.allSettled(finishing), new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))]);
  for (const [stream, media] of streams) {
    for (const track of media.getTracks()) track.stop();
    setLive(stream, false);
  }
  streams.clear();
}
