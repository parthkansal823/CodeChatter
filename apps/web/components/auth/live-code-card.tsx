"use client";

import { useEffect, useState } from "react";

import { Caret, PresenceAvatar, presenceVar, type PresenceSlot } from "@/components/presence/presence";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

type Person = "Parth" | "Ananya";
const SLOT: Record<Person, PresenceSlot> = { Parth: 1, Ananya: 2 };

// Parth and Ananya finish one function together, each on their own lines.
const LINES: Array<{ text: string; who: Person | null }> = [
  { text: "export async function approve(pr: PullRequest) {", who: null },
  { text: "  if (pr.draft) return { merged: false };", who: "Ananya" },
  { text: "  await runTests(pr.branch);", who: "Parth" },
  { text: "  const notes = summarize(pr.diff);", who: "Ananya" },
  { text: "  return merge(pr, { notes });", who: "Parth" },
  { text: "}", who: null },
];
const FIRST_KEY: Record<Person, number> = { Parth: 450, Ananya: 1100 };
const HOLD_MS = 2800; // finished code stays up this long
const FADE_MS = 520; // then the typed text fades before the next round

/** Small seeded PRNG: the rhythm feels human but is identical every loop. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Plan = { lineIndex: number; indent: number; keyTimes: number[] };

/**
 * When every character of every line lands, per person. Typing speeds up
 * inside words, slows after spaces and punctuation, and now and then the
 * person pauses to think — the rhythm of someone actually typing.
 */
function planTyping() {
  const plans: Plan[] = [];
  const doneAt: Record<Person, number> = { Parth: 0, Ananya: 0 };
  for (const who of ["Parth", "Ananya"] as const) {
    const random = rng(who === "Parth" ? 7 : 19);
    let t = FIRST_KEY[who];
    LINES.forEach((line, lineIndex) => {
      if (line.who !== who) return;
      const indent = line.text.length - line.text.trimStart().length;
      const body = line.text.slice(indent);
      const keyTimes: number[] = [];
      for (let i = 0; i < body.length; i++) {
        const prev = body[i - 1] ?? "";
        let delay = 38 + random() * 46;
        if (prev === " ") delay += 55 + random() * 60;
        if ("(.{,".includes(prev)) delay += 30 + random() * 40;
        if (i > 4 && random() < 0.06) delay += 260 + random() * 320; // a thinking pause
        t += delay;
        keyTimes.push(t);
      }
      plans.push({ lineIndex, indent, keyTimes });
      t += 420 + random() * 260; // moving to the next line
    });
    doneAt[who] = t;
  }
  const typingEnd = Math.max(doneAt.Parth, doneAt.Ananya);
  return { plans, typingEnd, loop: typingEnd + HOLD_MS + FADE_MS + 300 };
}
const { plans, typingEnd, loop } = planTyping();

/** Where each person's caret is at time t: the line they're on and whether they're mid-word. */
function carets(t: number) {
  const out = new Map<number, { who: Person; typing: boolean }>();
  for (const who of ["Parth", "Ananya"] as const) {
    const mine = plans.filter((p) => LINES[p.lineIndex]!.who === who);
    // The latest line they've started; before their first key, their first line.
    const current = [...mine].reverse().find((p) => t >= p.keyTimes[0]! - 350) ?? mine[0]!;
    const last = current.keyTimes.at(-1)!;
    out.set(current.lineIndex, { who, typing: t >= current.keyTimes[0]! - 350 && t <= last + 180 });
  }
  return out;
}

export function LiveCodeCard() {
  const reduced = usePrefersReducedMotion();
  const [t, setT] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const begin = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setT((now - begin) % loop);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  const time = reduced ? typingEnd : t;
  const fading = !reduced && time > typingEnd + HOLD_MS;
  const caretAt = carets(time);

  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border bg-background shadow-[0_24px_48px_-28px_color-mix(in_oklch,var(--foreground)_30%,transparent)]">
      <div className="flex h-9 items-center gap-2 border-b bg-chrome px-3 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">review.ts</span>
        <div className="ml-auto flex items-center gap-1.5">
          {(["Parth", "Ananya"] as const).map((who) => {
            const typing = [...caretAt.values()].some((c) => c.who === who && c.typing);
            return (
              <span key={who} className="relative">
                <PresenceAvatar name={who} slot={SLOT[who]} size={20} />
                {/* A small live dot while that person is typing. */}
                <span
                  className={cn(
                    "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-chrome transition-opacity duration-300",
                    typing ? "opacity-100" : "opacity-0",
                  )}
                  style={{ backgroundColor: presenceVar(SLOT[who]) }}
                />
              </span>
            );
          })}
        </div>
      </div>
      <pre className="overflow-hidden px-0 pt-5 pb-4 font-mono text-[12.5px] leading-[26px]">
        {LINES.map((line, i) => {
          const plan = plans.find((p) => p.lineIndex === i);
          const indent = plan?.indent ?? 0;
          const body = line.text.slice(indent);
          const typed = plan ? plan.keyTimes.filter((k) => k <= time).length : body.length;
          const caret = caretAt.get(i);
          return (
            <div
              key={i}
              className="relative flex transition-colors duration-300"
              style={{
                // Each person's current line gets a faint wash of their colour.
                backgroundColor: caret ? `color-mix(in oklch, ${presenceVar(SLOT[caret.who])} 7%, transparent)` : "transparent",
              }}
            >
              <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground/50 select-none">{i + 1}</span>
              <span
                className={cn("whitespace-pre transition-opacity ease-out", plan && fading && "opacity-0")}
                style={{ transitionDuration: `${FADE_MS}ms` }}
              >
                {line.text.slice(0, indent)}
                {body.slice(0, typed)}
                {caret && !(fading && plan) && (
                  <Caret
                    slot={SLOT[caret.who]}
                    name={caret.typing ? caret.who : undefined}
                    blink={!caret.typing}
                    flagSide="inline"
                    className="ml-px"
                  />
                )}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
