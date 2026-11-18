/**
 * A flow started by what happens in its room (packages/contracts/src/room-events.ts), on its trigger's panel: which event, and for files, which ones (globs);
 * an example of what the flow is given, to try it with; and turning it on, as the schedule's and webhook's panels do. Changing what it listens for while it's
 * on changes it at once. Kept with the room by the API, so it runs with nobody in the room; what the room's own runs change doesn't count.
 */
"use client";

import { ERROR_FLOW_EVENT, pathsProblem, ROOM_EVENT_NAMES, ROOM_EVENTS, type AutomationTrigger, type RoomEventName, type RoomEventPayload, type RoomEventSettings } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Power, Trash2 } from "lucide-react";
import { useEffect, useEffectEvent, useId, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";

import { DataView } from "./data-view";
import type { Flow } from "./model";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** As the API keeps it: the patterns trimmed, and none at all when there are none. The file keeps what was typed, a newline being typed included. */
const kept = (settings: RoomEventSettings | null): RoomEventSettings | null => (settings ? (settings.event === "files.changed" && settings.paths?.trim() ? { event: settings.event, paths: settings.paths.trim() } : { event: settings.event }) : null);
const same = (a: RoomEventSettings | null, b: RoomEventSettings | null) => JSON.stringify(kept(a)) === JSON.stringify(kept(b));

/** What a flow on this event is given, to try it with before anything happens. */
export function exampleOf(event: RoomEventName, me: { id: string; name: string }): RoomEventPayload | Record<string, unknown> {
  const base = { event, at: new Date().toISOString(), by: [{ id: me.id, name: me.name }] };
  // An error flow gets what n8n's Error Trigger gives (automation/host.mjs).
  if (event === ERROR_FLOW_EVENT)
    return {
      execution: { id: "20261117-101500-a1b2c3d4", url: null, retryOf: null, error: { message: "Request failed with status 500", step: "fetch" }, lastNodeExecuted: "fetch", mode: "webhook", startedAt: base.at, stoppedAt: base.at },
      workflow: { id: "flow_…", name: "Sync the orders", path: "automations/sync-orders.flow.json" },
    };
  if (event === "files.changed") return { ...base, files: [{ path: "src/app.py", kind: "file", change: "changed" }, { path: "src/new_module.py", kind: "file", change: "added" }] };
  if (event === "repo.commit") return { ...base, data: { branch: "main", sha: "4f2a9c1", files: 3 } };
  if (event === "repo.pull-request") return { ...base, data: { number: 42, url: "https://github.com/you/repo/pull/42" } };
  if (event === "repo.publish") return { ...base, data: { repo: "you/repo" } };
  if (event === "room.member.approve" || event === "room.member.leave") return { ...base, data: { person: "Someone" } };
  if (event === "sandbox.image") return { ...base, data: { image: "full" } };
  return { ...base, data: { name: "This room" } };
}

export function RoomEventSettings({ flow, path, room: settings, canRun, canEdit, onSave, onUseEvent }: { flow: Flow; path: string; room: RoomEventSettings; canRun: boolean; canEdit: boolean; onSave: (flow: Flow) => void; onUseEvent: (body: unknown) => void }) {
  const { room, me } = useRoom();
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "triggers"];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pathsHelp = useId();
  const triggers = useQuery({ queryKey: key, queryFn: () => api<AutomationTrigger[]>(`/api/rooms/${room.id}/automations/triggers`), enabled: canRun, retry: false });
  const trigger = triggers.data?.find((each) => each.kind === "event" && each.flowId === flow.id) ?? null;
  const wrongPaths = settings.event === "files.changed" ? pathsProblem(settings.paths) : null;
  const changed = Boolean(trigger && !wrongPaths && !same(settings, trigger.event));

  /** What it listens for, in the flow's file; its name follows the event while it's still the event's own. */
  const setRoom = (next: RoomEventSettings) => {
    const named = ROOM_EVENTS[settings.event].label;
    const displayName = !flow.trigger.displayName || flow.trigger.displayName === named ? ROOM_EVENTS[next.event].label : flow.trigger.displayName;
    onSave({ ...flow, trigger: { ...flow.trigger, displayName, settings: { ...flow.trigger.settings, room: next } } });
  };

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

  // Changed while it's on: it listens for the new one, once the typing stops.
  const saveEvent = useEffectEvent(() => {
    if (trigger) void patch({ event: kept(settings) });
  });
  const pending = changed ? `${trigger?.id} ${JSON.stringify(settings)}` : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => saveEvent(), 800);
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
      await api(`/api/rooms/${room.id}/automations/triggers`, { method: "POST", json: { path, flowId: id, kind: "event", event: kept(settings) } });
    });
  const example = exampleOf(settings.event, { id: me.user.id, name: me.user.name });

  return (
    <div className="grid gap-3">
      <section aria-label="What starts it" className="grid gap-2">
        <label className="grid gap-1">
          When
          <select className={field} disabled={!canEdit} value={settings.event} onChange={(event) => setRoom({ event: event.target.value as RoomEventName, ...(event.target.value === "files.changed" && settings.paths && { paths: settings.paths }) })}>
            {ROOM_EVENT_NAMES.map((name) => (
              <option key={name} value={name}>
                {ROOM_EVENTS[name].label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground">{ROOM_EVENTS[settings.event].about}</p>
        {settings.event === "files.changed" && (
          <label className="grid gap-1">
            Which files
            <Textarea
              aria-describedby={pathsHelp}
              className="min-h-14 font-mono text-[11px] md:text-[11px]"
              spellCheck={false}
              readOnly={!canEdit}
              placeholder="src/**/*.py"
              value={settings.paths ?? ""}
              onChange={(event) => setRoom({ event: "files.changed", ...(event.target.value && { paths: event.target.value }) })}
            />
            <span id={pathsHelp} className={wrongPaths ? "text-destructive" : "text-muted-foreground"}>
              {wrongPaths ?? "Patterns, one a line or comma-separated: ** is any folders, * any name. Empty is every file. It runs a few seconds after people stop typing, once for all they changed."}
            </span>
          </label>
        )}
        <div className="grid gap-1">
          <DataView label="What the flow is given, for example" value={example} />
          {canRun && (
            <div>
              <Button size="xs" variant="outline" onClick={() => onUseEvent(example)}>
                Use it as what to send
              </Button>
            </div>
          )}
        </div>
      </section>

      {settings.event === ERROR_FLOW_EVENT ? (
        <p className="rounded-md border p-2 text-muted-foreground">There&apos;s nothing to turn on: choose this flow under &quot;If it fails, run&quot; on each flow it&apos;s for, and it runs when one of them fails.</p>
      ) : !canRun ? (
        <p className="text-muted-foreground">Turning a flow on needs Run rights in this room.</p>
      ) : triggers.isPending ? (
        <p className="text-muted-foreground">Seeing whether it&apos;s on…</p>
      ) : triggers.isError ? (
        <p className="text-destructive">{failure(triggers.error)}</p>
      ) : (
        <section aria-label="Starting by itself" className="grid gap-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <h4 className="flex-1 font-medium">Starting by itself</h4>
            {trigger && <span className={trigger.enabled ? "font-medium" : "text-muted-foreground"}>{trigger.enabled ? "On" : "Off"}</span>}
          </div>
          {!trigger ? (
            <>
              <p className="text-muted-foreground">Turned on, it runs each time this happens in the room, even with nobody here.</p>
              <div>
                <Button size="xs" disabled={busy || Boolean(wrongPaths)} onClick={() => void turnOn()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Power />} Turn on
                </Button>
              </div>
            </>
          ) : (
            <>
              {changed && <p className="text-muted-foreground">Saving what it listens for…</p>}
              {trigger.lastRunAt ? <p className="text-muted-foreground">Last ran {new Date(trigger.lastRunAt).toLocaleString()}.</p> : trigger.enabled && <p className="text-muted-foreground">Waiting for it to happen.</p>}
              {trigger.problem && (
                <p role="alert" className="text-destructive">
                  {trigger.problem}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="outline" disabled={busy || (!trigger.enabled && Boolean(wrongPaths))} onClick={() => void patch({ enabled: !trigger.enabled })}>
                  <Power /> {trigger.enabled ? "Turn off" : "Turn on again"}
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} aria-expanded={confirming} onClick={() => setConfirming(!confirming)}>
                  <Trash2 /> Forget it
                </Button>
              </div>
              {confirming && (
                <div role="group" aria-label="Are you sure?" className="grid gap-1 rounded-md bg-chrome p-2">
                  <p>It&apos;s turned off, and stops running when this happens. Its runs so far are kept.</p>
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
      )}
    </div>
  );
}
