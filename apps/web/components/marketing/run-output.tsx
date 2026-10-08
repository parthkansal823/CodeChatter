"use client";

import { Check, Loader2, Play, TerminalSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type OutputLine =
  | { kind: "command"; text: string }
  | { kind: "step"; label: string; value: string }
  | { kind: "done"; text: string };

// What placeOrder() prints when run against the demo cart. Timed like a real
// run: validation is instant, the catalog call takes a moment, the charge last.
const SCRIPT: Array<{ at: number; line: OutputLine }> = [
  { at: 0, line: { kind: "command", text: "node src/orders.ts --demo" } },
  { at: 320, line: { kind: "step", label: "Validated order", value: "3 items, coupon WELCOME10" } },
  { at: 760, line: { kind: "step", label: "Priced 3 SKUs", value: "catalog answered in 42 ms" } },
  { at: 1040, line: { kind: "step", label: "Subtotal", value: "$97.10" } },
  { at: 1260, line: { kind: "step", label: "Discount", value: "−$9.71 (WELCOME10)" } },
  { at: 1620, line: { kind: "step", label: "Charged", value: "$87.39, key ord_7Hq2x" } },
  { at: 1880, line: { kind: "done", text: "Order placed in 0.84 s" } },
];
const TOTAL_MS = SCRIPT.at(-1)!.at;

export type RunState = "idle" | "running" | "done";

/** Drives the demo run: which output lines are visible and whether it's running. */
export function useDemoRun() {
  const [state, setState] = useState<RunState>("idle");
  const [visible, setVisible] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function run() {
    timers.current.forEach(clearTimeout);
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setState("running");
    if (instant) {
      setVisible(SCRIPT.length);
      setState("done");
      return;
    }
    setVisible(0);
    timers.current = SCRIPT.map(({ at }, i) => window.setTimeout(() => setVisible(i + 1), at));
    timers.current.push(window.setTimeout(() => setState("done"), TOTAL_MS + 60));
  }

  function close() {
    timers.current.forEach(clearTimeout);
    setState("idle");
    setVisible(0);
  }

  return { state, visible, run, close };
}

export function RunButton({ state, onRun }: { state: RunState; onRun: () => void }) {
  const running = state === "running";
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running}
      aria-label={running ? "Running orders.ts" : "Run orders.ts"}
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-brand px-2.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand/88 disabled:cursor-progress"
    >
      {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
      {running ? "Running" : "Run"}
    </button>
  );
}

export function RunPanel({ state, visible, onClose }: { state: RunState; visible: number; onClose: () => void }) {
  const open = state !== "idle";
  return (
    // Height animates only because the reader clicked Run (grid 0fr → 1fr).
    <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="min-h-0 overflow-hidden">
        <div className="border-t bg-panel">
          <div className="flex h-8 items-center gap-2 border-b px-3 text-2xs text-muted-foreground">
            <TerminalSquare className="size-3.5" />
            <span className="font-medium text-foreground">Output</span>
            <span>Private sandbox, Node 24, no network</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close output"
              className="ml-auto rounded-sm p-0.5 hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div role="log" aria-live="polite" className="min-h-[178px] px-4 py-3 font-mono text-[12.5px] leading-[22px]">
            {SCRIPT.slice(0, visible).map(({ line }, i) => (
              <OutputRow key={i} line={line} />
            ))}
            {state === "running" && <span className="inline-block h-[1.05em] w-[7px] translate-y-[0.14em] animate-caret bg-foreground/70" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputRow({ line }: { line: OutputLine }) {
  if (line.kind === "command") {
    return (
      <div className="text-muted-foreground">
        <span className="text-brand">❯</span> {line.text}
      </div>
    );
  }
  if (line.kind === "done") {
    return (
      <div className="mt-1 flex items-center gap-2 font-medium text-success">
        <Check className="size-3.5" strokeWidth={3} />
        {line.text}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4">
      <span>{line.label}</span>
      <span className="text-muted-foreground">{line.value}</span>
    </div>
  );
}
