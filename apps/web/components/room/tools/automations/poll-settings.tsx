/**
 * Turning on a flow that starts on a service's new items (a piece's polling trigger: a new row, a new issue, a new email), on its trigger's panel: how often
 * it looks, whether it's on, when it last looked and next will, and why it stopped if it did. Turned on, what's there already doesn't count; each new item
 * from then on is a run of its own, with that item. "Try it" asks the service now for an example of what the flow would be given. Kept with the room by
 * the API, which looks on its timer, so it runs with nobody in the room.
 */
"use client";

import { type AutomationTrigger } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Power, Search, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";

import { DataView } from "./data-view";
import type { Flow } from "./model";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const field = "h-7 w-20 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
const minutesProblem = (minutes: number) => (!Number.isInteger(minutes) || minutes < 1 ? "At least every minute." : minutes > 1440 ? "At most once a day (1440 minutes)." : null);

function inHowLong(at: number, now: number) {
  const minutes = Math.round((at - now) / 60_000);
  return minutes <= 0 ? "any moment" : minutes === 1 ? "in a minute" : `in ${minutes} minutes`;
}

export function PollSettings({ flow, path, label, canRun, onUseEvent }: { flow: Flow; path: string; label: string; canRun: boolean; onUseEvent: (body: unknown) => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "triggers"];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [example, setExample] = useState<unknown[] | null>(null);
  const triggers = useQuery({ queryKey: key, queryFn: () => api<AutomationTrigger[]>(`/api/rooms/${room.id}/automations/triggers`), enabled: canRun, retry: false });
  const trigger = triggers.data?.find((each) => each.kind === "poll" && each.flowId === flow.id) ?? null;
  const minutes = Number(typed ?? trigger?.poll?.everyMinutes ?? 5);
  const wrong = minutesProblem(minutes);
  const changed = Boolean(trigger && !wrong && trigger.poll?.everyMinutes !== minutes);

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

  // How often, changed while it's on: once the typing stops.
  const saveMinutes = useEffectEvent(() => {
    if (trigger && !wrong) void patch({ poll: { everyMinutes: minutes } });
  });
  const pending = changed ? `${trigger?.id} ${minutes}` : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => saveMinutes(), 800);
    return () => clearTimeout(timer);
  }, [pending]);

  const turnOn = () =>
    act(async () => {
      if (!flow.id) throw new Error("Save the flow first: it gets an id when it's saved.");
      await api(`/api/rooms/${room.id}/automations/triggers`, { method: "POST", json: { path, flowId: flow.id, kind: "poll", poll: { everyMinutes: minutes } } });
    });
  const tryIt = async () => {
    setTrying(true);
    setProblem(null);
    try {
      const answer = await api<{ items: unknown[] }>(`/api/rooms/${room.id}/automations/triggers/poll-test`, { method: "POST", json: { path, ...(flow.id && { flowId: flow.id }) } });
      setExample(answer.items);
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setTrying(false);
    }
  };

  if (!canRun) return <p className="text-muted-foreground">Turning a flow on needs Run rights in this room.</p>;
  if (triggers.isPending) return <p className="text-muted-foreground">Seeing whether it&apos;s on…</p>;
  if (triggers.isError) return <p className="text-destructive">{failure(triggers.error)}</p>;

  const tryButton = (
    <Button size="xs" variant="outline" disabled={trying} onClick={() => void tryIt()}>
      {trying ? <Loader2 className="animate-spin" /> : <Search />} Try it
    </Button>
  );
  return (
    <section aria-label="Starting by itself" className="grid gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 font-medium">Starting by itself</h4>
        {trigger && <span className={trigger.enabled ? "font-medium" : "text-muted-foreground"}>{trigger.enabled ? "On" : "Off"}</span>}
      </div>
      <label className="flex flex-wrap items-center gap-2">
        Looks for a {label.toLowerCase()} every
        <input aria-label="Minutes between looks" type="number" min={1} max={1440} className={field} value={typed ?? String(trigger?.poll?.everyMinutes ?? 5)} onChange={(event) => setTyped(event.target.value)} />
        minutes
      </label>
      {wrong && <p className="text-destructive">{wrong}</p>}
      {!trigger ? (
        <>
          <p className="text-muted-foreground">Turned on, what&apos;s there already doesn&apos;t count: each one new from then on runs the flow, with it, even with nobody in the room.</p>
          <div className="flex flex-wrap gap-1">
            <Button size="xs" disabled={busy || Boolean(wrong)} onClick={() => void turnOn()}>
              {busy ? <Loader2 className="animate-spin" /> : <Power />} Turn on
            </Button>
            {tryButton}
          </div>
        </>
      ) : (
        <>
          {changed && <p className="text-muted-foreground">Saving how often…</p>}
          {trigger.enabled && trigger.nextRunAt && <p>Looks next {inHowLong(trigger.nextRunAt, now)}.</p>}
          {trigger.lastRunAt && <p className="text-muted-foreground">Last started a run {new Date(trigger.lastRunAt).toLocaleString()}.</p>}
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
            {tryButton}
          </div>
          {confirming && (
            <div role="group" aria-label="Are you sure?" className="grid gap-1 rounded-md bg-chrome p-2">
              <p>It&apos;s turned off, and stops looking. Its runs so far are kept.</p>
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
      <div className="grid gap-1 empty:hidden">
        {example && example.length === 0 && <p className="text-muted-foreground">It found nothing to give as an example.</p>}
        {example && example.length > 0 && (
          <>
            <DataView label="What the flow would be given, for example" value={example[0]} />
            <div>
              <Button size="xs" variant="outline" onClick={() => onUseEvent(example[0])}>
                Use it as what to send
              </Button>
            </div>
          </>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
