/** Replay: the room's files at any moment of the interview, on a slider, with test runs and chat alongside. */
"use client";

import type { InterviewReplay, ReplayEvent } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, MessageSquare, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { filesAt, momentFor, parseReplayFrames, type ReplayFrame } from "./replay";

const STEP_MS = 400;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function eventLabel(event: ReplayEvent): string {
  if (event.kind === "chat") return `${event.by ?? "Someone"}: ${event.text}`;
  return event.compileError ? `Tests by ${event.by ?? "someone"}: didn't compile` : `Tests by ${event.by ?? "someone"}: ${event.passed} of ${event.total} passed`;
}

function Player({ replay, frames, preferred }: { replay: InterviewReplay; frames: ReplayFrame[]; preferred: string }) {
  const last = replay.moments.length - 1;
  const [index, setIndex] = useState(last);
  const [playing, setPlaying] = useState(false);
  const [chosen, setChosen] = useState(preferred);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((current) => {
      if (current >= last) {
        setPlaying(false);
        return current;
      }
      return current + 1;
    }), STEP_MS);
    return () => clearInterval(timer);
  }, [playing, last]);

  const moment = replay.moments[index]!;
  const files = useMemo(() => filesAt(frames, new Date(moment).getTime()), [frames, moment]);
  const file = files.find((item) => item.path === chosen) ?? files[0];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              if (!playing && index >= last) setIndex(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
          <input
            type="range"
            aria-label="Moment in the interview"
            aria-valuetext={clock(moment)}
            className="min-w-40 flex-1 accent-brand"
            min={0}
            max={last}
            value={index}
            onChange={(event) => {
              setPlaying(false);
              setIndex(event.target.valueAsNumber);
            }}
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{clock(moment)}</span>
          {files.length > 0 && (
            <Select value={file?.path ?? ""} onValueChange={setChosen}>
              <SelectTrigger size="sm" className="max-w-56 font-mono" aria-label="File"><SelectValue /></SelectTrigger>
              <SelectContent>{files.map((item) => <SelectItem key={item.path} value={item.path} className="font-mono">{item.path}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <pre tabIndex={0} aria-label={file ? `${file.path} at ${clock(moment)}` : "No files yet"} className="h-[28rem] overflow-auto rounded-md border bg-panel p-3 font-mono text-xs">
          {file ? (file.text ?? "(a binary file)") : "No files yet."}
        </pre>
      </div>
      <div className="min-w-0">
        <h3 className="mb-1 font-medium">What happened</h3>
        {replay.events.length === 0 && <p className="text-muted-foreground">No test runs or chat.</p>}
        <ul className="grid max-h-[28rem] gap-0.5 overflow-y-auto">
          {replay.events.map((event, position) => {
            const target = momentFor(replay.moments, event.at);
            return (
              <li key={`${event.at}-${position}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setIndex(target);
                  }}
                  className={cn("flex w-full items-start gap-1.5 rounded-sm px-1.5 py-1 text-left hover:bg-accent", target === index && "bg-accent")}
                >
                  {event.kind === "chat" ? <MessageSquare className="mt-0.5 size-3.5 shrink-0" /> : <FlaskConical className="mt-0.5 size-3.5 shrink-0" />}
                  <span className="min-w-0 break-words">
                    <span className="mr-1 font-mono text-2xs text-muted-foreground">{clock(event.at)}</span>
                    {eventLabel(event)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function ReplayView({ interviewId, file }: { interviewId: string; file: string }) {
  const replay = useQuery({ queryKey: ["interview-replay", interviewId], queryFn: ({ signal }) => api<InterviewReplay>(`/api/interviews/${interviewId}/replay`, { signal }) });
  const frames = useQuery({
    queryKey: ["interview-replay-frames", interviewId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/interviews/${interviewId}/replay/updates`, { signal, credentials: "same-origin" });
      if (!response.ok) throw new Error(`The edit log couldn't load (${response.status}).`);
      return parseReplayFrames(new Uint8Array(await response.arrayBuffer()));
    },
  });
  if (replay.isPending || frames.isPending) return <Skeleton className="h-64" />;
  if (replay.isError || frames.isError) return <p className="text-muted-foreground">The replay couldn&apos;t load. Try again in a moment.</p>;
  if (replay.data.moments.length === 0) return <p className="text-muted-foreground">Nothing to replay yet: nobody has edited the files during the interview.</p>;
  return <Player replay={replay.data} frames={frames.data} preferred={file} />;
}
