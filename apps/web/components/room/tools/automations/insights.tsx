/**
 * The Automations tool's Insights (n8n's): how the room's flows have done over the last 7, 30 or 90 days, from the sandbox's daily tally, which outlasts the
 * runs kept. Four figures (runs, failed with the failure rate, time saved, the average run), then each flow, then each day with runs. Time saved is each
 * flow's own setting, for runs that succeeded and were started by their trigger.
 */
"use client";

import type { AutomationInput, AutomationInsights } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const PERIODS = [7, 30, 90] as const;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const percent = (rate: number) => `${Math.round(rate * 1000) / 10}%`;
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");

/** Minutes as people say them: 45 min, 2 h 15 min, 3 days 4 h. */
export function savedWords(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  if (hours < 24) return whole % 60 ? `${hours} h ${whole % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} ${days === 1 ? "day" : "days"} ${hours % 24} h` : `${days} ${days === 1 ? "day" : "days"}`;
}

/** A run's length: 0.4 s, 12 s, 2 min 5 s. */
export function durationWords(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ""}`;
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid content-start gap-0.5 rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-muted-foreground">{detail}</span>}
    </div>
  );
}

const cell = "px-2 py-1 text-right tabular-nums";
const head = "px-2 py-1 text-right font-medium";

export function InsightsView({ ask }: { ask: <T>(input: AutomationInput) => Promise<T> }) {
  const { room } = useRoom();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const insights = useQuery({ queryKey: ["automations", room.id, "insights", days], queryFn: () => ask<AutomationInsights>({ op: "insights", days }), refetchInterval: 15_000, retry: false });
  const data = insights.data;
  const busyDays = (data?.perDay ?? []).filter((day) => day.runs > 0).reverse();

  return (
    <section aria-label="Insights" className="grid min-h-0 content-start gap-3 overflow-auto p-4 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-1">
          <h3 className="text-[13px] font-medium">Insights</h3>
          <p className="text-muted-foreground">How the room&apos;s flows have done, by flow and by day (UTC). Time saved is each flow&apos;s own setting, counted for runs that succeeded and were started by their trigger.</p>
        </div>
        <div role="radiogroup" aria-label="Over the last" className="flex rounded-md border p-0.5">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              role="radio"
              aria-checked={days === period}
              className={cn("rounded-sm px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", days === period ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground")}
              onClick={() => setDays(period)}
            >
              {period} days
            </button>
          ))}
        </div>
      </div>
      {insights.isPending ? (
        <p className="text-muted-foreground">Counting…</p>
      ) : insights.isError ? (
        <p role="alert" className="text-destructive">
          {failure(insights.error)}
        </p>
      ) : !data || data.totals.runs === 0 ? (
        <p className="text-muted-foreground">No runs in the last {days} days.</p>
      ) : (
        <>
          <div role="group" aria-label="In all" className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Runs" value={compact.format(data.totals.runs)} detail={`${compact.format(data.totals.byHand)} by hand`} />
            <Tile label="Failed" value={compact.format(data.totals.failed)} detail={`${percent(data.totals.failureRate)} of runs`} />
            <Tile label="Time saved" value={savedWords(data.totals.savedMinutes)} />
            <Tile label="Average run" value={durationWords(data.totals.averageMs)} />
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[32rem] border-collapse">
              <caption className="px-2 py-1 text-left font-medium">By flow</caption>
              <thead className="bg-chrome">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Flow
                  </th>
                  <th scope="col" className={head}>
                    Runs
                  </th>
                  <th scope="col" className={head}>
                    Failed
                  </th>
                  <th scope="col" className={head}>
                    Failure rate
                  </th>
                  <th scope="col" className={head}>
                    Average run
                  </th>
                  <th scope="col" className={head}>
                    Time saved
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.flows.map((flow) => (
                  <tr key={flow.key} className="border-t">
                    <th scope="row" className="max-w-56 truncate px-2 py-1 text-left font-normal" title={flow.path}>
                      {flow.name}
                    </th>
                    <td className={cell}>{compact.format(flow.runs)}</td>
                    <td className={cell}>{compact.format(flow.failed)}</td>
                    <td className={cell}>{percent(flow.failureRate)}</td>
                    <td className={cell}>{durationWords(flow.averageMs)}</td>
                    <td className={cell}>{flow.savedMinutes ? savedWords(flow.savedMinutes) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[20rem] border-collapse">
              <caption className="px-2 py-1 text-left font-medium">By day</caption>
              <thead className="bg-chrome">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Day
                  </th>
                  <th scope="col" className={head}>
                    Runs
                  </th>
                  <th scope="col" className={head}>
                    Failed
                  </th>
                </tr>
              </thead>
              <tbody>
                {busyDays.map((day) => (
                  <tr key={day.day} className="border-t">
                    <th scope="row" className="px-2 py-1 text-left font-normal tabular-nums">
                      {day.day}
                    </th>
                    <td className={cell}>{compact.format(day.runs)}</td>
                    <td className={cell}>{compact.format(day.failed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
