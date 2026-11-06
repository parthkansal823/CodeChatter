/** Manage organisation webhooks and delivery history, keeping once-only signing secrets out of query caches. */
"use client";

import { WEBHOOK_EVENTS, WebhookInput, type WebhookDelivery, type WebhookDeliveryPage, type WebhookItem } from "@codechatter/contracts";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Clock3, Copy, Plus, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ONLY_ADMINS = "Only the organisation's owners and admins can manage webhooks.";
const eventLabel = (event: string) => event === "*" ? "Everything" : event;
const detail = (error: unknown) => error instanceof ApiError
  ? error.status === 403 ? ONLY_ADMINS : error.errors?.[0]?.message ?? error.detail
  : "Couldn't complete that request. Try again.";

function Status({ status }: { status: WebhookDelivery["status"] }) {
  const Icon = status === "delivered" ? CheckCircle2 : status === "failed" ? XCircle : Clock3;
  return <Badge variant="outline" className="gap-1"><Icon aria-hidden />{status === "delivered" ? "Delivered" : status === "failed" ? "Failed" : "Pending"}</Badge>;
}

function Time({ value }: { value: string }) {
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{formatRelativeTime(value)}</time>;
}

function WebhookForm({ webhook, busy, error, onSave, onClose }: {
  webhook: WebhookItem | null;
  busy: boolean;
  error: string | null;
  onSave: (input: WebhookInput) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [description, setDescription] = useState(webhook?.description ?? "");
  const [events, setEvents] = useState<string[]>(webhook?.events ?? ["*"]);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [validation, setValidation] = useState<string | null>(null);
  const message = validation ?? error;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto shadow-none" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{webhook ? "Edit webhook" : "Add webhook"}</DialogTitle><DialogDescription>Send selected organisation events to your receiver.</DialogDescription></DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          const parsed = WebhookInput.safeParse({ url, events, description, active });
          if (!parsed.success) { setValidation(parsed.error.issues[0]?.message ?? "Check the webhook settings."); return; }
          setValidation(null);
          onSave(parsed.data);
        }}>
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <div className="grid gap-1.5"><label htmlFor={`${id}-url`} className="text-xs font-medium">Receiver URL</label><Input id={`${id}-url`} type="url" value={url} onChange={(event) => { setUrl(event.target.value); setValidation(null); }} placeholder="https://example.com/codechatter" maxLength={2048} spellCheck={false} autoComplete="off" aria-describedby={message ? `${id}-error` : undefined} /><p className="text-xs text-muted-foreground">Use HTTPS for production. Private network addresses are blocked.</p></div>
            <div className="grid gap-1.5"><label htmlFor={`${id}-description`} className="text-xs font-medium">Description</label><Textarea id={`${id}-description`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} placeholder="What this receiver does" /></div>
            <fieldset className="grid gap-2"><legend className="mb-2 text-xs font-medium">Events</legend>
              <label className="flex min-h-7 items-center gap-2 text-xs"><Checkbox checked={events.includes("*")} onCheckedChange={(checked) => { setEvents(checked === true ? ["*"] : []); setValidation(null); }} />Everything</label>
              <div className="grid gap-1 sm:grid-cols-2">{WEBHOOK_EVENTS.filter((event) => event !== "*").map((event) => (
                <label key={event} className="flex min-h-7 items-center gap-2 text-xs"><Checkbox disabled={events.includes("*")} checked={events.includes(event)} onCheckedChange={(checked) => { setEvents((current) => checked === true ? [...current.filter((item) => item !== "*"), event] : current.filter((item) => item !== event)); setValidation(null); }} /><span className="break-all font-mono">{event}</span></label>
              ))}</div>
            </fieldset>
            <label className="flex min-h-7 items-center gap-2 text-xs"><Switch size="sm" checked={active} onCheckedChange={setActive} />Active</label>
          </fieldset>
          {message && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{message}</p>}
          <DialogFooter><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={busy}>{busy ? "Saving..." : webhook ? "Save changes" : "Add webhook"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ value, onClose }: { value: { url: string; secret: string }; onClose: () => void }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="shadow-none">
        <DialogHeader><DialogTitle>Save your signing secret</DialogTitle><DialogDescription>This is the only time it will be shown. Store it in your receiver&apos;s secret settings.</DialogDescription></DialogHeader>
        <p className="break-all text-xs text-muted-foreground">{value.url}</p>
        <div className="grid gap-1.5"><label htmlFor={`${id}-secret`} className="text-xs font-medium">Signing secret</label><Input id={`${id}-secret`} value={value.secret} readOnly autoComplete="off" spellCheck={false} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} /></div>
        <DialogFooter><Button size="sm" variant="outline" onClick={async () => { if (await copyText(value.secret)) { setCopied(true); toast.success("Signing secret copied"); } else toast.error("Couldn't copy. Select the secret and copy it manually."); }}><Copy />{copied ? "Copied" : "Copy secret"}</Button><Button size="sm" onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveryRows({ delivery, busy, redeliver }: { delivery: WebhookDelivery; busy: boolean; redeliver: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell><Time value={delivery.createdAt} /></TableCell>
        <TableCell className="font-mono">{delivery.event}</TableCell>
        <TableCell><div className="grid max-w-60 gap-1 whitespace-normal"><Status status={delivery.status} />{delivery.inFlight && <span className="text-muted-foreground">Sending</span>}{delivery.lastError === "Expired while the webhook was paused" && <span className="text-destructive">{delivery.lastError}</span>}</div></TableCell>
        <TableCell>{delivery.lastStatusCode ?? "—"}</TableCell>
        <TableCell>{delivery.attempts}/6</TableCell>
        <TableCell>{delivery.status === "pending" && delivery.nextAttemptAt ? <Time value={delivery.nextAttemptAt} /> : "—"}</TableCell>
        <TableCell><div className="flex items-center gap-1"><Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls={`webhook-delivery-${delivery.id}`} aria-label={`${expanded ? "Hide" : "Show"} details for delivery ${delivery.id}`} onClick={() => setExpanded(!expanded)}><ChevronDown aria-hidden className={cn("size-3 transition-transform", expanded && "rotate-180")} />Details</Button><Button size="xs" variant="outline" disabled={busy || delivery.inFlight} onClick={redeliver}>Redeliver</Button></div></TableCell>
      </TableRow>
      {expanded && <TableRow id={`webhook-delivery-${delivery.id}`}><TableCell colSpan={7} className="whitespace-normal bg-muted/30 p-4">
        <div className="grid min-w-0 gap-4">
          <p className="break-all font-mono text-muted-foreground">Delivery {delivery.id}</p>
          {delivery.lastError && <p className="break-words text-destructive">{delivery.lastError}</p>}
          <div className="grid gap-1"><h3 className="font-medium">Payload</h3><pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">{JSON.stringify(delivery.payload, null, 2)}</pre></div>
          <div className="grid gap-1"><h3 className="font-medium">Last response</h3><pre className="max-h-48 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">{delivery.lastResponse || "No response body recorded."}</pre></div>
          <div className="grid gap-2"><h3 className="font-medium">Attempt history</h3>{delivery.attemptLog.length ? delivery.attemptLog.map((attempt, index) => <div key={`${attempt.at}-${index}`} className="grid gap-1 rounded-md border bg-background p-3"><p className="font-medium">Attempt {attempt.attempt}, {new Date(attempt.at).toLocaleString()}, {attempt.statusCode ? `HTTP ${attempt.statusCode}` : "No HTTP response"}, {attempt.durationMs} ms</p>{attempt.error && <p className="break-words text-destructive">{attempt.error}</p>}{attempt.response && <pre className="max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap break-all">{attempt.response}</pre>}</div>) : <p className="text-muted-foreground">No attempts yet.</p>}</div>
        </div>
      </TableCell></TableRow>}
    </>
  );
}

function DeliveryLog({ orgId, webhook, onClose }: { orgId: string; webhook: WebhookItem; onClose: () => void }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${webhook.id}` as const;
  const key = ["org-webhook-deliveries", orgId, webhook.id] as const;
  const deliveries = useInfiniteQuery({
    queryKey: key, initialPageParam: null as string | null, gcTime: 0,
    queryFn: ({ pageParam, signal }) => api<WebhookDeliveryPage>(`${base}/deliveries${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 5000,
    retry: (count, failure) => !(failure instanceof ApiError && [401, 403, 404].includes(failure.status)) && count < 2,
  });
  const items = deliveries.data?.pages.flatMap((page) => page.items) ?? [];
  async function redeliver(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api<WebhookDelivery>(`${base}/deliveries/${id}/redeliver`, { method: "POST" });
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["org-webhooks", orgId] });
      toast.success("Delivery queued again");
    } catch (failure) { setError(detail(failure)); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto shadow-none sm:max-w-5xl">
        <DialogHeader><DialogTitle>Delivery log</DialogTitle><DialogDescription className="break-all">{webhook.url}</DialogDescription></DialogHeader>
        <p className="text-xs text-muted-foreground">Attempts and responses update every five seconds. Response bodies show the first 2 KB. Resuming expires pending deliveries older than 24 hours. Settled deliveries are kept for 30 days by default.</p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {deliveries.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><span>{detail(deliveries.error)}</span><Button size="xs" variant="outline" onClick={() => void deliveries.refetch()}>Try again</Button></div>}
        <div className="min-w-0 overflow-hidden rounded-md border" aria-busy={deliveries.isPending}>
          <Table className="min-w-3xl text-xs"><caption className="sr-only">Webhook delivery history</caption><TableHeader><TableRow>{["When", "Event", "Status", "HTTP", "Attempts", "Next try", "Actions"].map((label) => <TableHead key={label} className="h-8">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
            {deliveries.isPending ? <TableRow><TableCell colSpan={7}><Skeleton className="h-7 w-full" /></TableCell></TableRow> : items.length ? items.map((delivery) => <DeliveryRows key={delivery.id} delivery={delivery} busy={busy || !webhook.active} redeliver={() => void redeliver(delivery.id)} />) : !deliveries.isError && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No deliveries yet. Send a test to check this receiver.</TableCell></TableRow>}
          </TableBody></Table>
        </div>
        {!webhook.active && <p className="text-xs text-muted-foreground">Enable this webhook before redelivering an event.</p>}
        {deliveries.hasNextPage && <div><Button size="sm" variant="outline" disabled={deliveries.isFetchingNextPage} onClick={() => void deliveries.fetchNextPage()}>{deliveries.isFetchingNextPage ? "Loading..." : "Load more"}</Button></div>}
      </DialogContent>
    </Dialog>
  );
}

function OrganisationWebhooks({ org }: { org: { id: string; name: string } }) {
  const client = useQueryClient();
  const mounted = useRef(false);
  const pending = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ webhook: WebhookItem | null } | null>(null);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [log, setLog] = useState<WebhookItem | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "delete" | "rotate"; webhook: WebhookItem } | null>(null);
  const base = `/api/orgs/${encodeURIComponent(org.id)}/webhooks` as const;
  const key = ["org-webhooks", org.id] as const;
  const hooks = useQuery({
    queryKey: key, queryFn: ({ signal }) => api<{ items: WebhookItem[] }>(base, { signal }), gcTime: 0, refetchInterval: 5000,
    retry: (count, failure) => !(failure instanceof ApiError && [401, 403, 404].includes(failure.status)) && count < 2,
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function act<T>(name: string, request: () => Promise<T>, done: (result: T) => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(name);
    setError(null);
    try {
      const result = await request();
      if (!mounted.current) return;
      done(result);
      void client.invalidateQueries({ queryKey: key });
    } catch (failure) { if (mounted.current) setError(detail(failure)); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  function save(input: WebhookInput) {
    if (!editor) return;
    if (editor.webhook) {
      const id = editor.webhook.id;
      void act("save", () => api<WebhookItem>(`${base}/${id}`, { method: "PATCH", json: input }), () => { setEditor(null); toast.success("Webhook updated"); });
    } else {
      void act("save", () => api<{ webhook: WebhookItem; secret: string }>(base, { method: "POST", json: input }), (result) => { setEditor(null); setSecret({ url: result.webhook.url, secret: result.secret }); });
    }
  }
  const items = hooks.data?.items ?? [];
  return (
    <>
      <PageHeader title="Webhooks" description={`Send events from ${org.name} to your services.`} actions={<Button size="sm" disabled={busy !== null} onClick={() => { setError(null); setEditor({ webhook: null }); }}><Plus />Add webhook</Button>} />
      <div className="grid min-w-0 gap-4 px-6 py-6 sm:px-8">
        <p className="text-xs text-muted-foreground">Requests are signed with a secret. Delivery is tried up to six times.</p>
        {error && !editor && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {hooks.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><span>{detail(hooks.error)}</span><Button size="xs" variant="outline" onClick={() => void hooks.refetch()}>Try again</Button></div>}
        {hooks.isPending ? <div className="grid gap-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-28 w-full" />)}</div> : items.length ? items.map((webhook) => <section key={webhook.id} aria-labelledby={`webhook-${webhook.id}`} className="grid min-w-0 gap-3 rounded-md border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="grid min-w-0 flex-1 gap-1"><h2 id={`webhook-${webhook.id}`} className="break-all font-mono text-xs font-medium">{webhook.url}</h2>{webhook.description && <p className="break-words text-xs text-muted-foreground">{webhook.description}</p>}</div><label className="flex min-h-7 items-center gap-2 text-xs"><Switch size="sm" checked={webhook.active} disabled={busy !== null} aria-label={`Enable webhook ${webhook.url}`} onCheckedChange={(active) => void act(`active-${webhook.id}`, () => api<WebhookItem>(`${base}/${webhook.id}`, { method: "PATCH", json: { active } }), () => toast.success(active ? "Webhook enabled" : "Webhook paused"))} />{webhook.active ? "Active" : "Paused"}</label></div>
          <div className="flex flex-wrap gap-1.5">{webhook.events.map((event) => <Badge key={event} variant="secondary" className="max-w-full break-all whitespace-normal">{eventLabel(event)}</Badge>)}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">Last delivery</span>{webhook.lastDelivery ? <><Status status={webhook.lastDelivery.status} />{webhook.lastDelivery.lastStatusCode !== null && <span>HTTP {webhook.lastDelivery.lastStatusCode}</span>}<span className="text-muted-foreground"><Time value={webhook.lastDelivery.createdAt} /></span></> : <span className="text-muted-foreground">None yet</span>}</div>
          <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={busy !== null} onClick={() => { setError(null); setEditor({ webhook }); }}>Edit</Button><Button size="xs" variant="outline" disabled={busy !== null || !webhook.active} onClick={() => void act(`test-${webhook.id}`, () => api<WebhookDelivery>(`${base}/${webhook.id}/test`, { method: "POST" }), () => toast.success("Test event queued"))}>{busy === `test-${webhook.id}` ? "Queuing..." : "Send a test"}</Button><Button size="xs" variant="outline" onClick={() => setLog(webhook)}>Delivery log</Button><Button size="xs" variant="outline" disabled={busy !== null} onClick={() => { setError(null); setConfirmation({ kind: "rotate", webhook }); }}><RefreshCw />Rotate secret</Button><Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => { setError(null); setConfirmation({ kind: "delete", webhook }); }}>Delete</Button></div>
        </section>) : !hooks.isError && <div className="rounded-md border px-4 py-10 text-center"><h2 className="font-medium">No webhooks yet</h2><p className="mt-1 text-xs text-muted-foreground">Add a receiver to get signed organisation events.</p></div>}
      </div>
      {editor && <WebhookForm key={editor.webhook?.id ?? "new"} webhook={editor.webhook} busy={busy === "save"} error={error} onSave={save} onClose={() => { setEditor(null); setError(null); }} />}
      {secret && <SecretDialog value={secret} onClose={() => setSecret(null)} />}
      {log && <DeliveryLog key={log.id} orgId={org.id} webhook={items.find((item) => item.id === log.id) ?? log} onClose={() => setLog(null)} />}
      {confirmation && <AlertDialog open onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }}><AlertDialogContent className="shadow-none"><AlertDialogHeader><AlertDialogTitle>{confirmation.kind === "delete" ? "Delete webhook?" : "Rotate signing secret?"}</AlertDialogTitle><AlertDialogDescription>{confirmation.kind === "delete" ? "This removes the webhook and its delivery history." : "New attempts use the new secret. An attempt already in flight may still use the previous secret. Update your receiver with the new secret shown next."}<span className="mt-2 block break-all">{confirmation.webhook.url}</span></AlertDialogDescription></AlertDialogHeader>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel size="sm" disabled={busy !== null}>Cancel</AlertDialogCancel><AlertDialogAction size="sm" disabled={busy !== null} onClick={(event) => {
        event.preventDefault();
        const { kind, webhook } = confirmation;
        if (kind === "delete") void act(`delete-${webhook.id}`, () => api<void>(`${base}/${webhook.id}`, { method: "DELETE" }), () => { setConfirmation(null); toast.success("Webhook deleted"); });
        else void act(`rotate-${webhook.id}`, () => api<{ secret: string }>(`${base}/${webhook.id}/rotate-secret`, { method: "POST" }), (result) => { setConfirmation(null); setSecret({ url: webhook.url, secret: result.secret }); });
      }}>{busy ? "Working..." : confirmation.kind === "delete" ? "Delete webhook" : "Rotate secret"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    </>
  );
}

export function OutgoingWebhooks() {
  const me = useMe();
  const org = me.organizations.find((item) => item.id === me.session.activeOrganizationId);
  if (org && (org.role === "owner" || org.role === "admin")) return <OrganisationWebhooks key={org.id} org={org} />;
  return <><PageHeader title="Webhooks" description="Send organisation events to your services." /><p className="px-6 py-6 text-muted-foreground sm:px-8">{ONLY_ADMINS}</p></>;
}
