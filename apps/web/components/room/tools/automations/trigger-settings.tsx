/**
 * Turning a flow on, on its trigger's panel: a webhook's live address, which runs it, and its test address, which only shows what was sent so the flow can be
 * set up with real data, as n8n's are. Answering at once or when the flow finishes; a new address when the old one has got out; and turning it off. Kept with
 * the room by the API (apps/api/src/automations), so it works with nobody in the room.
 */
"use client";

import type { AutomationTestEvent, AutomationTrigger } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Power, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

import { DataView } from "./data-view";
import type { Flow } from "./model";

const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Address({ label, url, help }: { label: string; url: string | null; help: string }) {
  if (!url) return <p className="text-destructive">This address can&apos;t be shown: make a new one.</p>;
  return (
    <div className="grid gap-1">
      <span className="font-medium">{label}</span>
      <div className="flex gap-1">
        <Input readOnly aria-label={label} className="h-7 font-mono text-[11px]" value={url} onFocus={(event) => event.currentTarget.select()} />
        <Button
          size="icon-xs"
          variant="outline"
          aria-label={`Copy the ${label.toLowerCase()}`}
          title="Copy"
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast("Copied."))
              .catch(() => toast("Couldn't copy: select it and copy it by hand."))
          }
        >
          <Copy />
        </Button>
      </div>
      <span className="text-muted-foreground">{help}</span>
    </div>
  );
}

export function TriggerSettings({ flow, path, canRun, onSave, onUseEvent }: { flow: Flow; path: string; canRun: boolean; onSave: (flow: Flow) => void; onUseEvent: (body: unknown) => void }) {
  const { room } = useRoom();
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "triggers"];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [listeningSince, setListeningSince] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<"rotate" | "forget" | null>(null);
  const triggers = useQuery({ queryKey: key, queryFn: () => api<AutomationTrigger[]>(`/api/rooms/${room.id}/automations/triggers`), enabled: canRun, retry: false });
  const trigger = triggers.data?.find((each) => each.kind === "webhook" && each.flowId === flow.id) ?? null;
  const testEvent = useQuery({
    queryKey: ["automations", room.id, "test-event", trigger?.id],
    queryFn: () => api<AutomationTestEvent | null>(`/api/rooms/${room.id}/automations/triggers/${trigger!.id}/test-event`),
    enabled: Boolean(trigger && listeningSince),
    refetchInterval: (query) => (listeningSince && !(query.state.data && query.state.data.at >= listeningSince) ? 2000 : false),
    retry: false,
  });
  const heard = testEvent.data && listeningSince && testEvent.data.at >= listeningSince ? testEvent.data : null;

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
  const turnOn = () =>
    act(async () => {
      // A flow written by hand may have no id yet: it gets one, so its trigger and runs follow it.
      let id = flow.id;
      if (!id) {
        id = `flow_${crypto.randomUUID()}`;
        onSave({ ...flow, id });
      }
      await api(`/api/rooms/${room.id}/automations/triggers`, { method: "POST", json: { path, flowId: id, kind: "webhook", respond: "now" } });
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
      {!trigger ? (
        <>
          <p className="text-muted-foreground">Turned on, it gets an address. Anything that calls it, such as GitHub or your CI, runs this flow with what it sent, even with nobody in the room.</p>
          <div>
            <Button size="xs" disabled={busy} onClick={() => void turnOn()}>
              {busy ? <Loader2 className="animate-spin" /> : <Power />} Turn on
            </Button>
          </div>
        </>
      ) : (
        <>
          <Address label="Live address" url={trigger.url} help="Calling it runs the flow. Keep it secret: whoever has it can start the flow." />
          <Address label="Test address" url={trigger.testUrl} help="Calling it doesn't run the flow: it shows what was sent, below, to set the flow up with." />
          <div className="flex flex-wrap items-center gap-1">
            {listeningSince && !heard ? (
              <Button size="xs" variant="outline" onClick={() => setListeningSince(null)}>
                <Loader2 className="animate-spin" /> Waiting for a call… Stop
              </Button>
            ) : (
              <Button size="xs" variant="outline" onClick={() => setListeningSince(Date.now())}>
                Listen for a test call
              </Button>
            )}
          </div>
          {heard && (
            <div className="grid gap-1">
              <p className="text-muted-foreground">
                A {heard.method} came in at {new Date(heard.at).toLocaleTimeString()}.
              </p>
              <DataView label="What it sent" value={heard.body} />
              <div>
                <Button size="xs" variant="outline" onClick={() => onUseEvent(heard.body)}>
                  Use it as what to send
                </Button>
              </div>
            </div>
          )}
          <label className="grid gap-1">
            Answer the caller
            <select className={field} disabled={busy} value={trigger.respond} onChange={(event) => void act(() => api(`/api/rooms/${room.id}/automations/triggers/${trigger.id}`, { method: "PATCH", json: { respond: event.target.value } }))}>
              <option value="now">At once, with the run&apos;s id</option>
              <option value="finished">When the flow finishes, with what its last step gave</option>
            </select>
          </label>
          {trigger.lastRunAt && <p className="text-muted-foreground">Last called {new Date(trigger.lastRunAt).toLocaleString()}.</p>}
          <div className="flex flex-wrap gap-1">
            <Button size="xs" variant="outline" disabled={busy} onClick={() => void act(() => api(`/api/rooms/${room.id}/automations/triggers/${trigger.id}`, { method: "PATCH", json: { enabled: !trigger.enabled } }))}>
              <Power /> {trigger.enabled ? "Turn off" : "Turn on again"}
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} aria-expanded={confirming === "rotate"} onClick={() => setConfirming(confirming === "rotate" ? null : "rotate")}>
              <RefreshCw /> New address
            </Button>
            <Button size="xs" variant="ghost" disabled={busy} aria-expanded={confirming === "forget"} onClick={() => setConfirming(confirming === "forget" ? null : "forget")}>
              <Trash2 /> Forget it
            </Button>
          </div>
          {confirming && (
            <div role="group" aria-label="Are you sure?" className="grid gap-1 rounded-md bg-chrome p-2">
              <p>{confirming === "rotate" ? "The old address stops working at once, so anything calling it needs the new one." : "It's turned off, and its address forgotten. Turning it on again gives a new one."}</p>
              <div className="flex gap-1">
                <Button
                  size="xs"
                  variant={confirming === "forget" ? "destructive" : "default"}
                  disabled={busy}
                  onClick={() => {
                    const which = confirming;
                    setConfirming(null);
                    void act(() => (which === "rotate" ? api(`/api/rooms/${room.id}/automations/triggers/${trigger.id}/rotate`, { method: "POST" }) : api(`/api/rooms/${room.id}/automations/triggers/${trigger.id}`, { method: "DELETE" })));
                  }}
                >
                  {confirming === "rotate" ? "Make a new address" : "Forget it"}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
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
