"use client";

import { useEffect, useState } from "react";

import { Caret, type PresenceSlot } from "@/components/presence/presence";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

type Line = {
  text: string;
  who: string;
  slot: PresenceSlot;
  startMs: number;
  msPerChar: number;
  /** What the caret does once the line is typed. */
  after: "moves-on" | "fades" | "stays";
};

// Two people write the headline at once: Parth types the first line, Ananya
// the second while he's still going, then Parth drops down to finish it.
const LINES: Line[] = [
  { text: "Write code together,", who: "Parth", slot: 1, startMs: 250, msPerChar: 56, after: "moves-on" },
  { text: "in the same file,", who: "Ananya", slot: 2, startMs: 550, msPerChar: 64, after: "fades" },
  { text: "at the same time.", who: "Parth", slot: 1, startMs: 1700, msPerChar: 56, after: "stays" },
];
const FULL = LINES.map((l) => l.text).join(" ");
const END_MS = Math.max(...LINES.map((l) => l.startMs + l.text.length * l.msPerChar)) + 400;

/**
 * The only unprompted motion on the site. Text is laid out at full length from
 * the first paint (untyped characters are transparent), so nothing reflows.
 * Without JS or with reduced motion, it renders already typed.
 */
export function LiveHeadline() {
  const [elapsed, setElapsed] = useState(0);
  const animate = !usePrefersReducedMotion();

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setElapsed(now - start);
      if (now - start < END_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate]);

  return (
    <h1 aria-label={FULL} className="font-wide text-display font-semibold tracking-[-0.035em] text-balance">
      {LINES.map((line, index) => {
        const typed = animate
          ? Math.max(0, Math.min(line.text.length, Math.floor((elapsed - line.startMs) / line.msPerChar)))
          : line.text.length;
        const started = !animate || elapsed >= line.startMs;
        const done = typed === line.text.length;
        // Once someone finishes a line they move on (caret gone), drift away
        // (fade), or keep their place (the last line).
        const showCaret = started && (!done || line.after !== "moves-on") && (animate || line.after === "stays");
        return (
          <span key={index} aria-hidden="true" className="block">
            <span>{line.text.slice(0, typed)}</span>
            {showCaret && (
              <Caret
                slot={line.slot}
                name={!done || line.after === "stays" ? line.who : undefined}
                blink={done && line.after === "stays"}
                flagSide={line.after === "stays" ? "left" : "right"}
                className={done && line.after === "fades" ? "opacity-0 transition-opacity duration-700" : undefined}
              />
            )}
            <span className="lh-rest text-transparent">{line.text.slice(typed)}</span>
          </span>
        );
      })}
      <noscript>
        <style>{".lh-rest{color:inherit!important}"}</style>
      </noscript>
    </h1>
  );
}
