/**
 * On the candidate's page while it runs: reports what it notices, asks for full screen and guards
 * the clipboard if the sitting asks for that. The candidate is told all this before they start.
 *
 * None of this can be made airtight from inside a browser, so the server also watches for the
 * page going quiet and for second sessions (InterviewTestsService.heartbeat), and an interviewer
 * reads the record as evidence, not a verdict.
 */
"use client";

import type { RoomInterview } from "@codechatter/contracts";
import { Maximize } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

import { noteIntegrity as note, putBackNoticed, takeNoticed } from "./integrity-queue";

const BEAT_MS = 15_000;
/** Under this it's a word or a line, which anyone might paste. */
const WORTH_NOTING = 40;

export function IntegrityGuard({ interview }: { interview: RoomInterview }) {
  const { room } = useRoom();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [fullscreen, setFullscreen] = useState(() => typeof document !== "undefined" && Boolean(document.fullscreenElement));
  const { lockClipboard, fullscreen: wantsFullscreen } = interview;
  const live = interview.status === "live";

  useEffect(() => {
    if (!live) return;
    const beat = () => {
      const events = takeNoticed();
      void api(`/api/rooms/${room.id}/interview/heartbeat`, { method: "POST", json: { sessionId, events } }).catch(() => putBackNoticed(events));
    };

    const onVisibility = () => {
      if (document.hidden) note("tab-hidden");
    };
    const onBlur = () => {
      // Focus going into a frame on this page (a preview, Diagrams) isn't leaving it.
      if (!document.hidden && !document.hasFocus()) note("window-blur");
    };
    const onFullscreen = () => {
      const now = Boolean(document.fullscreenElement);
      setFullscreen(now);
      if (!now && wantsFullscreen) note("fullscreen-left");
    };

    // What they copied here can go back in: moving their own code around isn't pasting from outside.
    let copiedHere = "";
    const onCopyDone = (event: ClipboardEvent) => {
      copiedHere = event.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || copiedHere;
    };
    const onCopy = (event: ClipboardEvent) => {
      if (!lockClipboard) return;
      const from = window.getSelection()?.anchorNode;
      const element = from instanceof Element ? from : from?.parentElement;
      if (element?.closest("[data-question]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        note("copy-blocked");
        toast.message("Copying the questions is off for this test.");
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text || text === copiedHere) return;
      if (lockClipboard) {
        event.preventDefault();
        event.stopImmediatePropagation();
        note("paste-blocked", text.length);
        toast.message("Pasting from outside is off for this test.");
      } else if (text.length >= WORTH_NOTING) {
        note("pasted", text.length);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCopy, true);
    document.addEventListener("copy", onCopyDone);
    document.addEventListener("cut", onCopyDone);
    document.addEventListener("paste", onPaste, true);
    // A second screen is only known to Chromium browsers.
    if ((window.screen as Screen & { isExtended?: boolean }).isExtended) note("second-screen");
    beat();
    const timer = setInterval(beat, BEAT_MS);
    return () => {
      clearInterval(timer);
      beat();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCopy, true);
      document.removeEventListener("copy", onCopyDone);
      document.removeEventListener("cut", onCopyDone);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [live, room.id, sessionId, lockClipboard, wantsFullscreen]);

  if (!live || !wantsFullscreen || fullscreen) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Full screen" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <h2 className="font-wide text-xl font-semibold">This test runs in full screen</h2>
      <p className="max-w-sm text-muted-foreground">Your time keeps running. Leaving full screen goes on the record your assessor sees.</p>
      <Button variant="brand" onClick={() => void document.documentElement.requestFullscreen().catch(() => toast.error("Your browser refused full screen. Try again, or press F11."))}>
        <Maximize /> Go full screen
      </Button>
    </div>
  );
}
