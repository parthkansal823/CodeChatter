/**
 * Every run of the room's flows in one list, newest first, as n8n's executions: how each ended, which flow, what started it, when and how long, and what
 * it kept to be found by (Save run data), and its notes (good or bad, tags, a note). Filters narrow it: how it ended, which flow, what started it, its notes,
 * and words found in what a run kept, its tags and note, or its flow's name. Choosing one opens its flow with that run shown.
 */
"use client";

import type { AutomationInput, AutomationRunSummary } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Run = AutomationRunSummary;

const ENDED: Record<string, string> = { SUCCEEDED: "Finished", FAILED: "Failed", STOPPED: "Stopped", TIMEOUT: "Took too long", RUNNING: "Running", PAUSED: "Waiting" };
const STARTED: Record<string, string> = { manual: "By hand", webhook: "A call", schedule: "Its schedule", event: "The room", poll: "New items", flow: "Another flow", error: "A failed flow" };
const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }) : "–");
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const select = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs";

/** Whether a run's notes match the filter: good, bad, any notes at all, or a tag (as "tag:" and its name). */
export function notesMatch(run: Run, wanted: string): boolean {
  if (!wanted) return true;
  const notes = run.annotation;
  if (wanted === "good" || wanted === "bad") return notes?.vote === wanted;
  if (wanted === "any") return Boolean(notes?.vote || notes?.tags?.length || notes?.note);
  return wanted.startsWith("tag:") && (notes?.tags ?? []).some((tag) => tag.toLowerCase() === wanted.slice(4).toLowerCase());
}

/** Whether a run matches what's typed: every word, in its flow's name, what it kept (names and values), its tags or its note. */
export function runMatches(run: Run, words: string): boolean {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wanted.length) return true;
  const text = [run.name, ...Object.entries(run.data ?? {}).flatMap(([key, value]) => [key, value, `${key}:${value}`]), ...(run.annotation?.tags ?? []), run.annotation?.note ?? ""].join(" ").toLowerCase();
  return wanted.every((word) => text.includes(word));
}

export function AllRuns({ ask, onOpen }: { ask: <T>(input: AutomationInput) => Promise<T>; onOpen: (run: Run) => void }) {
  const { room } = useRoom();
  const runs = useQuery({ queryKey: ["automations", room.id, "runs", "all"], queryFn: () => ask<{ runs: Run[] }>({ op: "runs" }), staleTime: 0, refetchInterval: 5000, retry: false });
  const [ended, setEnded] = useState("");
  const [flow, setFlow] = useState("");
  const [started, setStarted] = useState("");
  const [notes, setNotes] = useState("");
  const [words, setWords] = useState("");
  const all = runs.data?.runs ?? [];
  const flows = [...new Set(all.map((run) => run.name))].sort((a, b) => a.localeCompare(b));
  const tags = [...new Map(all.flatMap((run) => run.annotation?.tags ?? []).map((tag) => [tag.toLowerCase(), tag])).values()].sort((a, b) => a.localeCompare(b));
  const shown = all.filter((run) => (!ended || run.status === ended) && (!flow || run.name === flow) && (!started || run.trigger === started) && notesMatch(run, notes) && runMatches(run, words));

  return (
    <section aria-label="Every run" className="grid min-h-0 content-start gap-3 overflow-auto p-4 text-xs">
      <div className="grid gap-1">
        <h3 className="text-[13px] font-medium">Every run</h3>
        <p className="text-muted-foreground">The room keeps its last 50 runs, of every flow. What a run kept with Save run data can be searched for here.</p>
      </div>
      <div role="group" aria-label="Narrow the runs" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          How it ended
          <select className={select} value={ended} onChange={(event) => setEnded(event.target.value)}>
            <option value="">Any way</option>
            {Object.entries(ENDED).map(([value, words]) => (
              <option key={value} value={value}>
                {words}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Flow
          <select className={cn(select, "max-w-56")} value={flow} onChange={(event) => setFlow(event.target.value)}>
            <option value="">Every flow</option>
            {flows.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Started by
          <select className={select} value={started} onChange={(event) => setStarted(event.target.value)}>
            <option value="">Anything</option>
            {Object.entries(STARTED).map(([value, words]) => (
              <option key={value} value={value}>
                {words}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Notes
          <select className={cn(select, "max-w-48")} value={notes} onChange={(event) => setNotes(event.target.value)}>
            <option value="">Any or none</option>
            <option value="any">With notes</option>
            <option value="good">Good runs</option>
            <option value="bad">Bad runs</option>
            {tags.map((tag) => (
              <option key={tag} value={`tag:${tag}`}>
                Tagged {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-48 flex-1 gap-1">
          Find
          <Input className="h-7 text-xs md:text-xs" placeholder="order:A-17, or a flow's name" value={words} onChange={(event) => setWords(event.target.value)} />
        </label>
      </div>
      {runs.isPending ? (
        <p className="text-muted-foreground">Reading the runs…</p>
      ) : runs.isError ? (
        <p role="alert" className="text-destructive">
          {failure(runs.error)}
        </p>
      ) : !all.length ? (
        <p className="text-muted-foreground">No runs yet.</p>
      ) : !shown.length ? (
        <p className="text-muted-foreground">No run matches that.</p>
      ) : (
        <>
          <p role="status" className="text-muted-foreground">
            {shown.length === all.length ? `${all.length} ${all.length === 1 ? "run" : "runs"}` : `${shown.length} of ${all.length} runs`}
          </p>
          <ul aria-label="Runs" className="grid gap-0.5">
            {shown.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className={cn("grid w-full gap-0.5 rounded-sm px-2 py-1 text-left hover:bg-accent", run.status !== "SUCCEEDED" && run.status !== "PAUSED" && run.status !== "RUNNING" && "text-destructive")}
                  onClick={() => onOpen(run)}
                >
                  <span className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium">{ENDED[run.status] ?? run.status}</span>
                    <span className="text-foreground">{run.name}</span>
                    <span className="text-muted-foreground">
                      {STARTED[run.trigger] ?? run.trigger} · {when(run.startedAt)}
                      {run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : ""}
                      {run.by ? ` · ${run.by}` : ""}
                    </span>
                    {run.annotation?.vote === "good" && <ThumbsUp aria-label="A good run" className="size-3.5 text-muted-foreground" />}
                    {run.annotation?.vote === "bad" && <ThumbsDown aria-label="A bad run" className="size-3.5 text-muted-foreground" />}
                  </span>
                  {(run.annotation?.tags?.length || run.annotation?.note) && (
                    <span className="flex flex-wrap items-center gap-1">
                      {(run.annotation.tags ?? []).map((tag) => (
                        <span key={tag} className="rounded-sm bg-secondary px-1 text-[11px] text-foreground">
                          {tag}
                        </span>
                      ))}
                      {run.annotation.note && <span className="max-w-96 truncate text-muted-foreground" title={run.annotation.note}>{run.annotation.note}</span>}
                    </span>
                  )}
                  {run.data && Object.keys(run.data).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(run.data).map(([key, value]) => (
                        <span key={key} className="max-w-64 truncate rounded-sm border px-1 font-mono text-[11px] text-muted-foreground" title={`${key}: ${value}`}>
                          {key}: {value}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
