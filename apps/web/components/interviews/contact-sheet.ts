/**
 * Stills from a recording, tiled into one labelled image for the AI to look at. Each clip starts
 * on a full frame, so its first frame is a good still, and one image costs far less to send and
 * to read than a video. Made in the reviewer's browser, which can already play the clips.
 */
import type { RecordingClip } from "@codechatter/contracts";

import { cssVar } from "@/lib/css-color";

const MOST_STILLS = 16;
const COLUMNS = 4;
const LOAD_WAIT_MS = 8000;

/** Evenly across the sitting, so nothing's left out by being late. */
export function pickStills<T>(clips: readonly T[], most = MOST_STILLS): T[] {
  if (clips.length <= most) return [...clips];
  return Array.from({ length: most }, (_, index) => clips[Math.floor((index * clips.length) / most)]!);
}

function firstFrame(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const done = (result: HTMLVideoElement | null) => {
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => done(null), LOAD_WAIT_MS);
    video.addEventListener("loadeddata", () => done(video), { once: true });
    video.addEventListener("error", () => done(null), { once: true });
    video.src = url;
  });
}

/** The sheet as JPEG base64, and each still's time in label order (C1, C2...). Null if none would load. */
export async function contactSheet(interviewId: string, clips: readonly RecordingClip[], prefix: "C" | "S"): Promise<{ data: string; times: string[] } | null> {
  const picked = pickStills(clips);
  if (!picked.length) return null;
  const cell = prefix === "C" ? { width: 240, height: 180 } : { width: 320, height: 180 };
  const frames: Array<{ video: HTMLVideoElement; at: string }> = [];
  for (const clip of picked) {
    const video = await firstFrame(`/api/interviews/${interviewId}/recordings/${clip.id}`);
    if (video) frames.push({ video, at: clip.startedAt });
  }
  if (!frames.length) return null;

  const rows = Math.ceil(frames.length / COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = cell.width * Math.min(COLUMNS, frames.length);
  canvas.height = cell.height * rows;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = "bold 14px sans-serif";
  frames.forEach(({ video }, index) => {
    const x = (index % COLUMNS) * cell.width;
    const y = Math.floor(index / COLUMNS) * cell.height;
    context.drawImage(video, x, y, cell.width, cell.height);
    context.fillStyle = cssVar("--background");
    context.fillRect(x, y, 36, 20);
    context.fillStyle = cssVar("--foreground");
    context.fillText(`${prefix}${index + 1}`, x + 4, y + 15);
    video.removeAttribute("src");
  });
  return { data: canvas.toDataURL("image/jpeg", 0.65).split(",")[1]!, times: frames.map((frame) => frame.at) };
}
