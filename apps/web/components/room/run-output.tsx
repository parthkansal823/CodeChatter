"use client";

import type { AiStatus, RunExit, RunInfo } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import type { Terminal } from "@xterm/xterm";
import { Sparkles, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { useRun } from "@/components/room/run-context";
import { explainRunError, fixRunError } from "@/components/room/tools/ai/ai-requests";
import { XtermView } from "@/components/room/xterm-view";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

/** A run worth asking the AI about: it crashed, exited with an error code, or ran out of time. */
const failed = (exit: RunExit) => exit.reason === "error" || exit.reason === "timeout" || (exit.reason === "exit" && exit.code !== 0);

function header(run: RunInfo, myId: string): string {
  const who = run.startedBy.id === myId ? "you" : run.startedBy.name;
  return `${dim(`▶ ${run.command}  — run by ${who}`)}\r\n`;
}

function footer(exit: RunExit): string {
  const seconds = exit.durationMs < 1000 ? `${exit.durationMs} ms` : `${(exit.durationMs / 1000).toFixed(1)} s`;
  const line = (() => {
    switch (exit.reason) {
      case "stopped":
        return `\x1b[33m■ Stopped\x1b[0m ${dim(`after ${seconds}`)}`;
      case "timeout":
        return `\x1b[33m■ Stopped: the run hit the time limit\x1b[0m`;
      case "output-limit":
        return `\x1b[33m■ Stopped: too much output\x1b[0m`;
      case "reset":
        return `\x1b[33m↻ ${exit.message ?? "The sandbox was restarted."}\x1b[0m`;
      case "error":
        return `\x1b[31m✗ ${exit.message ?? "The run failed."}\x1b[0m`;
      default:
        return exit.code === 0
          ? `\x1b[32m✓ Finished\x1b[0m ${dim(`in ${seconds}`)}`
          : `\x1b[31m✗ Exited with code ${exit.code ?? "?"}\x1b[0m ${dim(`after ${seconds}`)}`;
    }
  })();
  return `\r\n${line}\r\n`;
}

/**
 * The shared Output tab. Everyone in the room sees the same run; only the
 * person who started it can type into it (input() prompts, menus).
 */
export function RunOutput() {
  const { me, can } = useRoom();
  const run = useRun();
  const [empty, setEmpty] = useState(!run.run);
  const [failure, setFailure] = useState(false);
  const ai = useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/api/ai/status"), staleTime: 60_000 });
  const live = useRef(run);
  useEffect(() => {
    live.current = run;
  });

  const onReady = (term: Terminal) =>
    run.subscribe((event) => {
      if (event.kind === "reset") {
        setEmpty(false);
        setFailure(false);
        term.reset();
        term.write(header(event.run, me.user.id));
      } else if (event.kind === "data") {
        term.write(event.data);
      } else {
        setFailure(failed(event.exit));
        term.write(footer(event.exit));
      }
    });

  return (
    <div className="relative h-full">
      <XtermView
        label="Run output"
        onReady={onReady}
        onData={(data) => {
          const current = live.current;
          if (current.running && current.mine) current.input(data);
        }}
      />
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <p>
            Press <span className="font-medium text-foreground">Run</span> or{" "}
            <kbd className="rounded-sm border px-1 font-mono text-2xs">Ctrl</kbd> <kbd className="rounded-sm border px-1 font-mono text-2xs">Enter</kbd> to run
            the open file. Everyone in the room sees the output.
          </p>
        </div>
      )}
      {failure && ai.data?.configured && can("room.chat") && (
        <div role="group" aria-label="Ask the AI about this error" className="absolute top-2 right-3 flex gap-1">
          <Button size="xs" variant="outline" className="bg-background" onClick={explainRunError}>
            <Sparkles /> Explain error
          </Button>
          <Button size="xs" variant="outline" className="bg-background" onClick={fixRunError}>
            <Wrench /> Fix
          </Button>
        </div>
      )}
    </div>
  );
}
