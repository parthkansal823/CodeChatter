/** Every call to the AI from this room: who or what made it, its model, tokens and time, and for your own and the room's code, what was sent and what came back. */
"use client";

import { AI_TRACE_SOURCES, type AiTrace, type AiTraceSource } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const FROM: Record<AiTraceSource, string> = { chat: "AI panel", prompt: "Playground", gateway: "Code in the room", embedding: "Embeddings" };
const STATUS: Record<AiTrace["status"], string> = { ok: "Done", cut: "Cut short", refused: "Refused", stopped: "Stopped", error: "Failed" };
const seconds = (ms: number | null) => (ms === null ? "–" : ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`);
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const whole = (value: number) => value.toLocaleString();

function Tile({ label, value, note, alarm }: { label: string; value: string; note?: string; alarm?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", alarm && "text-destructive")}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Detail({ trace }: { trace: AiTrace }) {
  return (
    <section aria-label="This call" className="grid gap-2 rounded-md border p-2 text-xs">
      <p className="font-medium">
        {FROM[trace.source]}
        {trace.mode && ` (${trace.mode})`}
        <span className="ml-2 font-mono font-normal text-muted-foreground">{trace.model}</span>
      </p>
      {trace.error && <p className="text-destructive">{trace.error}</p>}
      {trace.hidden && <p className="text-muted-foreground">This was {trace.by}&apos;s own conversation, so only they can read it.</p>}
      {trace.input?.map((message, index) => (
        <div key={index} className="grid gap-0.5">
          <span className="text-muted-foreground capitalize">{message.role}</span>
          <pre tabIndex={0} role="group" aria-label={`Message ${index + 1}: ${message.role}`} className="max-h-60 overflow-auto rounded-sm bg-chrome p-1.5 font-mono break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {message.content}
          </pre>
        </div>
      ))}
      {trace.output && (
        <div className="grid gap-0.5">
          <span className="text-muted-foreground">What came back</span>
          <pre tabIndex={0} role="group" aria-label="What came back" className="max-h-60 overflow-auto rounded-sm bg-chrome p-1.5 font-mono break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {trace.output}
          </pre>
        </div>
      )}
      {trace.estimated && <p className="text-muted-foreground">The server didn&apos;t report tokens, so these are counted from the characters.</p>}
    </section>
  );
}

export function TracesView() {
  const { room } = useRoom();
  const [source, setSource] = useState<AiTraceSource | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const traces = useQuery({ queryKey: ["ai-traces", room.id], queryFn: () => api<AiTrace[]>(`/api/rooms/${room.id}/ai/traces`), refetchInterval: 15_000 });
  const all = traces.data ?? [];
  const shown = source === "all" ? all : all.filter((trace) => trace.source === source);
  const failures = shown.filter((trace) => trace.status === "error").length;
  const timed = shown.filter((trace) => trace.firstMs !== null);
  const selected = shown.find((trace) => trace.id === open);
  return (
    <div className="grid min-h-0 flex-1 content-start gap-3 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <select aria-label="Show calls from" value={source} onChange={(event) => setSource(event.target.value as AiTraceSource | "all")} className="h-6 rounded-sm border bg-background px-1 text-xs text-foreground">
            <option value="all">Everywhere</option>
            {AI_TRACE_SOURCES.map((name) => (
              <option key={name} value={name}>
                {FROM[name]}
              </option>
            ))}
          </select>
        </label>
        <Button size="xs" variant="ghost" className="ml-auto" disabled={traces.isFetching} onClick={() => void traces.refetch()}>
          {traces.isFetching ? <Loader2 className="animate-spin" /> : <RotateCw />} Look again
        </Button>
      </div>
      {traces.isPending && (
        <div role="status" className="grid gap-2" aria-label="Loading the calls" aria-busy>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {traces.isError && (
        <p role="alert" className="text-xs text-destructive">
          Couldn&apos;t load the calls. Try again.
        </p>
      )}
      {traces.isSuccess && shown.length === 0 && <p className="max-w-prose text-xs text-muted-foreground">No calls here yet. Every call to the AI from this room shows up here, with its tokens and how long it took: from the AI panel, the Playground, and code running in the sandbox. They&apos;re kept for two weeks.</p>}
      {shown.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Calls" value={whole(shown.length)} note={all.length >= 200 ? "The latest 200" : undefined} />
            <Tile label="Tokens" value={whole(shown.reduce((sum, trace) => sum + trace.inputTokens + trace.outputTokens, 0))} note={`${whole(shown.reduce((sum, trace) => sum + trace.outputTokens, 0))} written`} />
            <Tile label="First word, on average" value={timed.length ? seconds(timed.reduce((sum, trace) => sum + (trace.firstMs ?? 0), 0) / timed.length) : "–"} />
            <Tile label="Failed" value={whole(failures)} alarm={failures > 0} />
          </div>
          <div tabIndex={0} role="group" aria-label="The calls" className="overflow-x-auto rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full border-collapse text-xs">
              <caption className="sr-only">Calls to the AI from this room, newest first. Open one to see more.</caption>
              <thead className="bg-chrome">
                <tr>
                  {["When", "From", "Who", "Model", "Tokens in", "Tokens out", "First word", "In all", "Result"].map((name) => (
                    <th key={name} scope="col" className="border-b px-2 py-1 text-left font-medium whitespace-nowrap">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((trace) => (
                  <tr key={trace.id} className={cn(open === trace.id && "bg-accent")}>
                    <td className="border-b px-2 py-1 whitespace-nowrap">
                      <button type="button" aria-pressed={open === trace.id} className="min-h-6 rounded-sm tabular-nums underline-offset-2 hover:underline" onClick={() => setOpen((current) => (current === trace.id ? null : trace.id))}>
                        {clock(trace.at)}
                      </button>
                    </td>
                    <td className="border-b px-2 py-1 whitespace-nowrap">{FROM[trace.source]}</td>
                    <td className="border-b px-2 py-1 whitespace-nowrap">{trace.by ?? "–"}</td>
                    <td className="border-b px-2 py-1 font-mono">{trace.model}</td>
                    <td className="border-b px-2 py-1 tabular-nums">
                      {trace.estimated && "~"}
                      {whole(trace.inputTokens)}
                    </td>
                    <td className="border-b px-2 py-1 tabular-nums">
                      {trace.estimated && "~"}
                      {whole(trace.outputTokens)}
                    </td>
                    <td className="border-b px-2 py-1 tabular-nums">{seconds(trace.firstMs)}</td>
                    <td className="border-b px-2 py-1 tabular-nums">{seconds(trace.totalMs)}</td>
                    <td className={cn("border-b px-2 py-1 whitespace-nowrap", trace.status === "error" && "font-medium text-destructive")}>{STATUS[trace.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && <Detail trace={selected} />}
          <p className="text-xs text-muted-foreground">Someone&apos;s conversation with the AI is theirs: you can see that it happened and what it cost, but only they can read it. Secrets are taken out of what&apos;s kept, and calls are kept for two weeks.</p>
        </>
      )}
    </div>
  );
}
