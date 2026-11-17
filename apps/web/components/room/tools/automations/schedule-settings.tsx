/**
 * Turning a flow on a schedule on, on its trigger's panel, as n8n's Schedule Trigger: the times it'll run, worked out from the trigger's settings the way
 * Activepieces' schedule piece does (contracts' schedule.ts, the same code the API's timer uses), whether it's on, when it next runs and last ran, and why it
 * stopped if it did. Changing the settings while it's on changes the times it runs. Kept with the room by the API, so it runs with nobody in the room.
 */
"use client";

import { nextRuns, scheduleOf, scheduleProblem, type AutomationTrigger, type Schedule } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Power, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

import type { Flow } from "./model";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const sameSchedule = (a: Schedule | null, b: Schedule | null) => a?.cron === b?.cron && a?.timezone === b?.timezone;

/** A time as the schedule's own clock has it, with its zone, so "09:00" means what the trigger says. */
function timeOf(at: number, timezone: string) {
  try {
    return new Date(at).toLocaleString(undefined, { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  } catch {
    return new Date(at).toLocaleString();
  }
}

function inHowLong(at: number, now: number) {
  const minutes = Math.max(0, Math.round((at - now) / 60_000));
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `in ${Math.round(hours / 24)} days`;
}

export function ScheduleSettings({ flow, path, canRun, onSave }: { flow: Flow; path: string; canRun: boolean; onSave: (flow: Flow) => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "triggers"];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const triggers = useQuery({ queryKey: key, queryFn: () => api<AutomationTrigger[]>(`/api/rooms/${room.id}/automations/triggers`), enabled: canRun, retry: false });
  const trigger = triggers.data?.find((each) => each.kind === "schedule" && each.flowId === flow.id) ?? null;

  const settings = flow.trigger.settings as { triggerName?: string; input?: Record<string, unknown> };
  const wanted = settings.triggerName ? scheduleOf(settings.triggerName, settings.input ?? {}) : null;
  const wrong = wanted ? scheduleProblem(wanted, now) : "Say when it runs, above.";
  const upcoming = wanted && !wrong ? nextRuns(wanted.cron, wanted.timezone, now, 3) : [];
  const changed = Boolean(trigger && wanted && !wrong && !sameSchedule(wanted, trigger.schedule));

  // The times move on; so does what's shown as next.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: key });
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(false);
    }
  };
  const patch = (json: Record<string, unknown>) => act(() => api(`/api/rooms/${room.id}/automations/triggers/${trigger!.id}`, { method: "PATCH", json }));

  // Settings changed while it's on: it runs at the new times, once the typing stops.
  const saveTimes = useEffectEvent(() => {
    if (wanted && trigger) void patch({ schedule: wanted });
  });
  const pending = changed && wanted ? `${trigger?.id} ${wanted.cron} ${wanted.timezone}` : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => saveTimes(), 800);
    return () => clearTimeout(timer);
  }, [pending]);

  const turnOn = () =>
    act(async () => {
      // A flow written by hand may have no id yet: it gets one, so its trigger and runs follow it.
      let id = flow.id;
      if (!id) {
        id = `flow_${crypto.randomUUID()}`;
        onSave({ ...flow, id });
      }
      await api(`/api/rooms/${room.id}/automations/triggers`, { method: "POST", json: { path, flowId: id, kind: "schedule", schedule: wanted } });
    });

  if (!canRun) return <p className="text-muted-foreground">Turning a flow on needs Run rights in this room.</p>;
  if (triggers.isPending) return <p className="text-muted-foreground">Seeing whether it&apos;s on…</p>;
  if (triggers.isError) return <p className="text-destructive">{failure(triggers.error)}</p>;

  return (
    <section aria-label="Starting by itself" className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 font-medium">Starting by itself</h4>
        {trigger && <span className={trigger.enabled ? "font-medium" : "text-muted-foreground"}>{trigger.enabled ? "On" : "Off"}</span>}
      </div>
      {wrong ? (
        <p className="text-destructive">{wrong}</p>
      ) : (
        <div className="grid gap-0.5">
          <span className="text-muted-foreground">
            Runs on <code className="font-mono text-[11px]">{wanted!.cron}</code>, {wanted!.timezone} time. The next times:
          </span>
          <ul aria-label="The next times it runs" className="grid gap-0.5 font-mono text-[11px]">
            {upcoming.map((at) => (
              <li key={at}>{timeOf(at, wanted!.timezone)}</li>
            ))}
          </ul>
        </div>
      )}
      {!trigger ? (
        <>
          <p className="text-muted-foreground">Turned on, it runs by itself at these times, even with nobody in the room.</p>
          <div>
            <Button size="xs" disabled={busy || Boolean(wrong)} onClick={() => void turnOn()}>
              {busy ? <Loader2 className="animate-spin" /> : <Power />} Turn on
            </Button>
          </div>
        </>
      ) : (
        <>
          {changed && <p className="text-muted-foreground">Saving the new times…</p>}
          {trigger.enabled && trigger.nextRunAt && (
            <p>
              Next run {timeOf(trigger.nextRunAt, trigger.schedule?.timezone ?? "UTC")}, {inHowLong(trigger.nextRunAt, now)}.
            </p>
          )}
          {trigger.lastRunAt && <p className="text-muted-foreground">Last ran {new Date(trigger.lastRunAt).toLocaleString()}.</p>}
          {trigger.problem && (
            <p role="alert" className="text-destructive">
              {trigger.problem}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" disabled={busy || (!trigger.enabled && Boolean(wrong))} onClick={() => void patch({ enabled: !trigger.enabled })}>
              <Power /> {trigger.enabled ? "Turn off" : "Turn on again"}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>
              <Trash2 /> Forget it
            </Button>
          </div>
          {confirming && (
            <div role="group" aria-label="Are you sure?" className="grid gap-1 rounded-md bg-chrome p-2">
              <p>It&apos;s turned off, and stops running at these times. Its runs so far are kept.</p>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    void act(() => api(`/api/rooms/${room.id}/automations/triggers/${trigger.id}`, { method: "DELETE" }));
                  }}
                >
                  Forget it
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
