/** Let organisation owners and admins find events and inspect their details without exposing request metadata in the table. */
"use client";

import type { AuditActions, AuditActors, AuditEventItem, AuditPage } from "@codechatter/contracts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import { useState } from "react";

import { PageHeader, useMe } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const ONLY_ADMINS = "Only the organisation's owners and admins can see its audit log.";
const EMPTY_FILTERS = { action: "", actorId: "", room: "", from: "", to: "" };
const ACTION_LABELS: Record<string, string> = {
  "room.create": "Created a room",
  "room.delete": "Deleted a room",
  "room.update": "Updated a room",
  "repo.publish": "Published to GitHub",
  "repo.commit": "Committed to GitHub",
  "repo.pull-request": "Opened a pull request",
  "repo.gist": "Published a gist",
  "checkpoint.delete": "Deleted a checkpoint",
  "sandbox.image": "Changed the sandbox image",
  "sandbox.installs.allow": "Allowed package installs",
  "sandbox.installs.stop": "Stopped package installs",
  "dev.start": "Started a dev server",
  "dev.stop": "Stopped a dev server",
  run: "Ran code",
  "database.dump": "Downloaded a database backup",
  "database.load": "Loaded a database backup",
  "sqlite.dump": "Downloaded a SQLite backup",
  "sqlite.load": "Loaded a SQLite backup",
};

function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABELS, action) ? ACTION_LABELS[action] ?? action : action;
}

function dateBound(value: string, end: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  // The next local midnight includes the whole chosen day even when daylight saving changes its length.
  if (end) {
    date.setDate(date.getDate() + 1);
    date.setHours(0, 0, 0, 0);
    date.setMilliseconds(-1);
  }
  const iso = date.toISOString();
  return /^\d{4}-/.test(iso) ? iso : null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.status === 403 ? ONLY_ADMINS : error.detail;
  return fallback;
}

function summaryOf(data: AuditEventItem["data"]): string {
  if (!data) return "No extra details";
  // List field names rather than serialising values: IPs and user agents stay in the expanded row.
  const fields = Object.keys(data).filter((key) => !/^(?:ip|ipAddress|ip_address|userAgent|user_agent|ua)$/i.test(key));
  if (!fields.length) return "No extra details";
  const names = fields.slice(0, 3).map((key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "));
  return names.join(", ") + (fields.length > names.length ? ` (+${fields.length - names.length} more)` : "");
}

function EventRows({ event }: { event: AuditEventItem }) {
  const [expanded, setExpanded] = useState(false);
  const fullTime = new Date(event.at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
  const action = actionLabel(event.action);
  return (
    <>
      <TableRow>
        <TableCell><time dateTime={event.at} title={fullTime}>{formatRelativeTime(event.at)}</time></TableCell>
        <TableCell className="max-w-64 whitespace-normal">
          {event.actor ? (
            <><div className="break-words font-medium">{event.actor.name || event.actor.email}</div><div className="break-all text-muted-foreground">{event.actor.email}</div></>
          ) : <span className="text-muted-foreground">System or deleted person</span>}
        </TableCell>
        <TableCell title={event.action} className="whitespace-normal">{action}</TableCell>
        <TableCell className="max-w-64 whitespace-normal">
          {event.room ? (
            <><div className="break-words">{event.room.name}</div><div className="font-mono text-muted-foreground">{event.room.id}</div></>
          ) : event.targetId ? (
            <><div className="text-muted-foreground">{event.targetType === "room" ? "Deleted room" : event.targetType || "Target"}</div><div className="break-all font-mono">{event.targetId}</div></>
          ) : <span className="text-muted-foreground">Organisation</span>}
        </TableCell>
        <TableCell className="max-w-72 whitespace-normal">
          <Button
            size="xs"
            variant="ghost"
            className="h-auto min-h-6 max-w-full justify-start whitespace-normal text-left"
            aria-expanded={expanded}
            aria-controls={`audit-details-${event.id}`}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${action} at ${fullTime}`}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown aria-hidden className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            <span className="break-words">{summaryOf(event.data)}</span>
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow id={`audit-details-${event.id}`}>
          <TableCell colSpan={5} className="whitespace-normal bg-muted/30 p-4">
            <div className="grid gap-3">
              <div><h3 className="mb-1 font-medium">Event details</h3><pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">{JSON.stringify(event.data, null, 2)}</pre></div>
              <dl className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <dt className="font-medium">IP address</dt><dd className="break-all text-muted-foreground">{event.ip || "Not recorded"}</dd>
                <dt className="font-medium">User agent</dt><dd className="break-all text-muted-foreground">{event.userAgent || "Not recorded"}</dd>
              </dl>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function OrganisationAudit({ org }: { org: { id: string; name: string } }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const from = filters.from ? dateBound(filters.from, false) : undefined;
  const to = filters.to ? dateBound(filters.to, true) : undefined;
  const roomInvalid = Boolean(filters.room && !/^[A-Z0-9]{6}$/.test(filters.room));
  const filterError = roomInvalid ? "Room codes use six uppercase letters or digits." : (filters.from && !from) || (filters.to && !to) ? "Choose a valid date." : from && to && from > to ? "From must be on or before To." : "";
  const params = new URLSearchParams();
  for (const key of ["action", "actorId", "room"] as const) if (filters[key]) params.set(key, filters[key]);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const base = `/api/orgs/${encodeURIComponent(org.id)}/audit` as const;
  const actions = useQuery({ queryKey: ["audit-actions", org.id], queryFn: ({ signal }) => api<AuditActions>(`${base}/actions`, { signal }) });
  const actors = useQuery({ queryKey: ["audit-actors", org.id], queryFn: ({ signal }) => api<AuditActors>(`${base}/actors`, { signal }) });
  const events = useInfiniteQuery({
    queryKey: ["audit-events", org.id, query],
    enabled: !filterError,
    // Leaving a filter discards its loaded pages, so returning to it starts at the first page too.
    gcTime: 0,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const page = new URLSearchParams(query);
      if (pageParam) page.set("before", pageParam);
      return api<AuditPage>(`${base}?${page}`, { signal });
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
  });
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  const update = (key: keyof typeof EMPTY_FILTERS, value: string) => setFilters((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      <PageHeader
        title="Audit log"
        description={`What happened in ${org.name}: who did what, and when.`}
        actions={filterError ? <Button size="sm" variant="outline" disabled><Download /> Download CSV</Button> : (
          <Button size="sm" variant="outline" asChild><a href={`${base}/export.csv${query ? `?${query}` : ""}`} download title="Download up to 100,000 matching events"><Download /> Download CSV</a></Button>
        )}
      />
      <div className="grid gap-4 px-6 py-6 sm:px-8">
        <section aria-label="Audit filters" className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="grid min-w-0 gap-1.5"><label htmlFor="audit-action" className="text-xs font-medium">Action</label>
            <Select value={filters.action ? `action:${filters.action}` : "all"} onValueChange={(value) => update("action", value === "all" ? "" : value.slice(7))}>
              <SelectTrigger id="audit-action" size="sm" className="w-full"><SelectValue placeholder="Every action" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Every action</SelectItem>{actions.data?.actions.map((action) => <SelectItem key={action} value={`action:${action}`}>{actionLabel(action)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1.5"><label htmlFor="audit-person" className="text-xs font-medium">Person</label>
            <Select value={filters.actorId ? `person:${filters.actorId}` : "all"} onValueChange={(value) => update("actorId", value === "all" ? "" : value.slice(7))}>
              <SelectTrigger id="audit-person" size="sm" className="w-full"><SelectValue placeholder="Every person" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Every person</SelectItem>{actors.data?.actors.map((actor) => <SelectItem key={actor.id} value={`person:${actor.id}`}>{actor.name ? `${actor.name} (${actor.email})` : actor.email}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 gap-1.5"><label htmlFor="audit-room" className="text-xs font-medium">Room</label><Input id="audit-room" value={filters.room} maxLength={6} placeholder="Every room" aria-invalid={roomInvalid} aria-describedby={filterError ? "audit-filter-error" : undefined} className="h-8 font-mono text-xs uppercase" onChange={(event) => update("room", event.target.value.toUpperCase())} /></div>
          <div className="grid min-w-0 gap-1.5"><label htmlFor="audit-from" className="text-xs font-medium">From</label><Input id="audit-from" type="date" value={filters.from} max={filters.to || undefined} className="h-8 text-xs" onChange={(event) => update("from", event.target.value)} /></div>
          <div className="grid min-w-0 gap-1.5"><label htmlFor="audit-to" className="text-xs font-medium">To</label><Input id="audit-to" type="date" value={filters.to} min={filters.from || undefined} className="h-8 text-xs" onChange={(event) => update("to", event.target.value)} /></div>
        </section>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Button size="xs" variant="ghost" disabled={!Object.values(filters).some(Boolean)} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button><span>Dates use your local time. CSV streams up to 100,000 events; a final line marks exports that reach the cap or fail.</span></div>
        {filterError && <p id="audit-filter-error" role="status" className="text-xs text-muted-foreground">{filterError}</p>}
        {(actions.isError || actors.isError) && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p>{errorMessage(actions.error ?? actors.error, "Couldn't load the filter choices. Try again.")}</p><Button size="xs" variant="outline" onClick={() => { void actions.refetch(); void actors.refetch(); }}>Try again</Button></div>}
        {!filterError && events.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p>{errorMessage(events.error, "Couldn't load the audit log. Try again.")}</p><Button size="xs" variant="outline" onClick={() => void events.refetch()}>Try again</Button></div>}
        {!filterError && (!events.isError || items.length > 0) && (
          <div className="overflow-hidden rounded-md border" aria-busy={events.isPending}>
            <Table className="min-w-3xl text-xs">
              <caption className="sr-only">Audit events in {org.name}</caption>
              <TableHeader><TableRow><TableHead className="h-8">When</TableHead><TableHead className="h-8">Who</TableHead><TableHead className="h-8">What</TableHead><TableHead className="h-8">Where</TableHead><TableHead className="h-8">Details</TableHead></TableRow></TableHeader>
              <TableBody>
                {events.isPending ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{Array.from({ length: 5 }, (_, column) => <TableCell key={column}><Skeleton className="h-4 w-24" /></TableCell>)}</TableRow>) : items.length ? items.map((event) => <EventRows key={event.id} event={event} />) : <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nothing matches these filters.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
        {!filterError && events.hasNextPage && <div><Button size="sm" variant="outline" disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>{events.isFetchingNextPage ? "Loading…" : "Load more"}</Button></div>}
      </div>
    </>
  );
}

export function AuditLog() {
  const me = useMe();
  const org = me.organizations.find((item) => item.id === me.session.activeOrganizationId);
  if (org && (org.role === "owner" || org.role === "admin")) return <OrganisationAudit key={org.id} org={org} />;
  return <><PageHeader title="Audit log" description={org ? `What happened in ${org.name}: who did what, and when.` : "What happened in your organisation."} /><p className="px-6 py-6 text-muted-foreground sm:px-8">{ONLY_ADMINS}</p></>;
}
