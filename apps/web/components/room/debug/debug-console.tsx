"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { clearConsole, consoleEvaluate, useDebug } from "./debug-store";

/**
 * The Debug console (a bottom panel tab): what the program prints and what the debugger
 * says, for everyone following the session; people who can run code evaluate expressions
 * in the paused frame (with gdb, the console takes gdb commands, `print x` and the like).
 */
export function DebugConsole() {
  const { can } = useRoom();
  const output = useDebug((s) => s.output);
  const session = useDebug((s) => s.session);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [back, setBack] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [output.length]);
  const paused = session?.state === "stopped";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="log"
        aria-label="Debug console"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >
        {output.length === 0 && (
          <p className="font-sans text-muted-foreground">
            {session
              ? "Waiting for output…"
              : "Start debugging from Run and debug (F5); what the program prints shows here."}
          </p>
        )}
        {output.map((line) => (
          <span
            key={line.id}
            className={cn(
              line.category === "stderr" || line.category === "error"
                ? "text-destructive"
                : line.category === "console"
                  ? "text-muted-foreground"
                  : line.category === "input"
                    ? "text-brand"
                    : undefined,
            )}
          >
            {line.category === "input" ? `› ${line.text}` : line.text}
          </span>
        ))}
        <div ref={end} />
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t px-2 py-1"
        onSubmit={(event) => {
          event.preventDefault();
          const expression = draft.trim();
          if (!expression) return;
          void consoleEvaluate(expression);
          setHistory((h) => [expression, ...h.filter((e) => e !== expression)].slice(0, 50));
          setBack(-1);
          setDraft("");
        }}
      >
        <span aria-hidden className="font-mono text-xs text-muted-foreground">
          ›
        </span>
        <input
          aria-label="Evaluate in the debugger"
          value={draft}
          disabled={!paused || !can("code.run")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const next = Math.max(-1, Math.min(history.length - 1, back + (e.key === "ArrowUp" ? 1 : -1)));
            setBack(next);
            setDraft(next === -1 ? "" : (history[next] ?? ""));
          }}
          placeholder={paused ? "An expression in the paused frame" : "Evaluate while the program is paused"}
          className="h-6 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Clear the debug console"
          onClick={clearConsole}
        >
          <Trash2 />
        </Button>
      </form>
    </div>
  );
}
