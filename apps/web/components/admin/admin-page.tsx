/** Server-wide account, room and service controls; every request is independently checked by the API for instance-admin permission. */
"use client";

import type { AdminHealth, AdminRoom, AdminRoomsPage, AdminUser, AdminUsersPage } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/app-shell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";

const PAGE_SIZE = 25;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";
const failure = (error: unknown) => error instanceof ApiError ? error.detail : "Couldn't complete this request. Try again.";

function RequestError({ error, retry }: { error: unknown; retry: () => void }) {
  if (error instanceof ApiError && [401, 403, 404].includes(error.status)) notFound();
  return <div className="grid justify-items-start gap-2" role="alert"><p>{failure(error)}</p><Button variant="outline" size="sm" onClick={retry}>Try again</Button></div>;
}

function Search({ kind, onSearch, busy }: { kind: "users" | "rooms"; onSearch: (value: string) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  const id = useId();
  return <form role="search" aria-label={`Search ${kind}`} onSubmit={(event) => { event.preventDefault(); onSearch(value.trim()); }} className="flex min-w-0 flex-wrap items-end gap-2">
    <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-sm"><Label htmlFor={id}>{kind === "users" ? "Name or email" : "Room code or name"}</Label><Input id={id} type="search" value={value} onChange={(event) => setValue(event.target.value)} maxLength={200} autoComplete="off" /></div>
    <Button type="submit" size="sm" disabled={busy}>Search</Button>
    {value && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setValue(""); onSearch(""); }}>Clear</Button>}
  </form>;
}

function Pagination({ kind, page, total, pageSize, busy, onPage }: { kind: string; page: number; total: number; pageSize: number; busy: boolean; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label={`${kind} pages`} className="flex flex-wrap items-center justify-between gap-3">
    <p role="status" className="text-muted-foreground">{total} {kind.toLowerCase()}. Page {page} of {pages}.</p>
    <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /> Previous</Button><Button variant="outline" size="sm" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight /></Button></div>
  </nav>;
}

type Action = { user: AdminUser; kind: "ban" | "unban" | "sessions/revoke" | "role" };
function actionText(action: Action): { title: string; description: string; confirm: string } {
  switch (action.kind) {
    case "ban": return { title: `Ban ${action.user.name}?`, description: "They won't be able to sign in. Their active sessions and room access will end.", confirm: "Ban account" };
    case "unban": return { title: `Unban ${action.user.name}?`, description: "They can sign in again. Their existing sessions will end, so they must sign in afresh.", confirm: "Unban account" };
    case "sessions/revoke": return { title: `Sign ${action.user.name} out everywhere?`, description: "Their active sessions and open room connections will end. They can sign in again.", confirm: "Sign out everywhere" };
    case "role": return action.user.role === "admin"
      ? { title: `Remove ${action.user.name}'s instance-admin access?`, description: "They will lose server-wide administration. Organisation memberships and room roles will stay the same.", confirm: "Remove admin access" }
      : { title: `Make ${action.user.name} an instance admin?`, description: "They will be able to manage accounts and inspect server-wide room and service information. This does not grant room or file access.", confirm: "Make instance admin" };
  }
}

function UserAction({ action, ownId, close, changed }: { action: Action; ownId: string; close: () => void; changed: () => Promise<unknown> }) {
  const router = useRouter();
  const id = useId();
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = actionText(action);
  async function confirm(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    let expiresAt: string | null = null;
    if (action.kind === "ban") {
      if (!reason.trim()) { setError("Add a reason for this ban."); return; }
      if (expires) {
        const end = new Date(expires);
        if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.now()) { setError("Choose an end time in the future, or leave it empty."); return; }
        expiresAt = end.toISOString();
      }
    }
    setBusy(true);
    setError("");
    try {
      const json = action.kind === "ban" ? { reason: reason.trim(), expiresAt } : action.kind === "role" ? { role: action.user.role === "admin" ? "user" : "admin" } : {};
      await api(`/api/admin/users/${encodeURIComponent(action.user.id)}/${action.kind}`, { method: "POST", json });
      await changed();
      toast.success("Account updated.");
      close();
      if (action.user.id === ownId && action.kind === "sessions/revoke") router.refresh();
    } catch (caught) { setError(failure(caught)); }
    finally { setBusy(false); }
  }
  return <AlertDialog open onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <AlertDialogContent><form onSubmit={(event) => void confirm(event)} className="grid min-w-0 gap-4">
      <AlertDialogHeader><AlertDialogTitle>{text.title}</AlertDialogTitle><AlertDialogDescription>{text.description}</AlertDialogDescription></AlertDialogHeader>
      <p className="break-all text-xs text-muted-foreground">{action.user.email}</p>
      {action.kind === "ban" && <fieldset disabled={busy} className="grid gap-3"><legend className="sr-only">Ban details</legend><div className="grid gap-1.5"><Label htmlFor={`${id}-reason`}>Reason</Label><Textarea id={`${id}-reason`} required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} /></div><div className="grid gap-1.5"><Label htmlFor={`${id}-until`}>End time (optional)</Label><Input id={`${id}-until`} type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} /><p className="text-xs text-muted-foreground">Your local time. Leave empty for an indefinite ban.</p></div></fieldset>}
      {error && <p role="alert">{error}</p>}
      <AlertDialogFooter><AlertDialogCancel type="button" disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction type="button" disabled={busy} onClick={(event) => { event.preventDefault(); void confirm(); }}>{busy ? <><Loader2 className="animate-spin" /> Saving…</> : text.confirm}</AlertDialogAction></AlertDialogFooter>
    </form></AlertDialogContent>
  </AlertDialog>;
}

function Users({ ownId }: { ownId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);
  const query = useQuery({ queryKey: ["instance-admin", "users", search, page], queryFn: ({ signal }) => api<AdminUsersPage>(`/api/admin/users?${new URLSearchParams({ search, page: String(page), pageSize: String(PAGE_SIZE) })}`, { signal }), refetchInterval: 30_000 });
  const changed = () => queryClient.invalidateQueries({ queryKey: ["instance-admin", "users"] });
  return <section aria-label="Users" className="grid min-w-0 gap-4">
    <h2 className="text-base font-medium">Users</h2><Search kind="users" busy={query.isFetching} onSearch={(value) => { setPage(1); setSearch(value); }} />
    {query.isPending ? <Skeleton className="h-48" /> : query.isError ? <RequestError error={query.error} retry={() => void query.refetch()} /> : <>
      <Table aria-label="Instance users"><TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Joined</TableHead><TableHead>Security</TableHead><TableHead>Organisations</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>
        {query.data.items.length === 0 ? <TableRow><TableCell colSpan={6}>No users match this search.</TableCell></TableRow> : query.data.items.map((user) => <TableRow key={user.id}>
          <TableCell className="max-w-64 whitespace-normal"><div className="break-words font-medium">{user.name || "Unnamed person"}{user.id === ownId && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}</div><div className="break-all text-xs text-muted-foreground">{user.email}</div>{user.role === "admin" && <Badge variant="outline" className="mt-1">Instance admin</Badge>}</TableCell>
          <TableCell><time dateTime={user.createdAt}>{date(user.createdAt)}</time></TableCell><TableCell className="whitespace-normal"><div>Email {user.emailVerified ? "verified" : "not verified"}</div><div className="text-xs text-muted-foreground">Two-factor {user.twoFactorEnabled ? "on" : "off"}</div></TableCell>
          <TableCell className="max-w-56 whitespace-normal">{user.organizations.length ? <ul className="grid gap-1">{user.organizations.map((org) => <li key={org.id} className="break-words">{org.name}<span className="ml-1 text-xs text-muted-foreground">({org.role})</span></li>)}</ul> : <span className="text-muted-foreground">None</span>}</TableCell>
          <TableCell className="max-w-56 whitespace-normal"><Badge variant="outline">{user.banned ? "Banned" : "Active"}</Badge>{user.banned && <div className="mt-1 grid gap-1 text-xs text-muted-foreground"><p className="break-words">{user.banReason || "No reason recorded"}</p><p>{user.banExpires ? `Until ${date(user.banExpires)}` : "No end time"}</p></div>}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1"><Button size="xs" variant="outline" disabled={user.id === ownId} onClick={() => setAction({ user, kind: user.banned ? "unban" : "ban" })}>{user.banned ? "Unban" : "Ban"}</Button><Button size="xs" variant="ghost" onClick={() => setAction({ user, kind: "sessions/revoke" })}>Sign out everywhere</Button><Button size="xs" variant="ghost" disabled={user.id === ownId && user.role === "admin"} onClick={() => setAction({ user, kind: "role" })}>{user.role === "admin" ? "Remove admin" : "Make admin"}</Button></div></TableCell>
        </TableRow>)}
      </TableBody></Table><Pagination kind="Users" page={query.data.page} total={query.data.total} pageSize={query.data.pageSize} busy={query.isFetching} onPage={setPage} />
    </>}
    <p className="text-xs text-muted-foreground">Instance-admin access is separate from organisation ownership. The server protects self-ban and the last admin. Impersonation is not available here.</p>
    {action && <UserAction key={`${action.user.id}:${action.kind}`} action={action} ownId={ownId} close={() => setAction(null)} changed={changed} />}
  </section>;
}

function RoomRow({ room }: { room: AdminRoom }) {
  return <TableRow><TableCell className="max-w-64 whitespace-normal"><Link href={`/rooms/${room.id}` as never} className="break-words font-medium underline decoration-border underline-offset-4">{room.name}</Link><div className="font-mono text-xs text-muted-foreground">{room.id}</div></TableCell><TableCell className="max-w-48 whitespace-normal">{room.organization.name}</TableCell><TableCell className="max-w-48 whitespace-normal">{room.owners.length ? room.owners.map((owner) => owner.name || "Unnamed person").join(", ") : "No active owner"}</TableCell><TableCell>{room.kind}<div className="text-xs text-muted-foreground">{room.visibility}</div></TableCell><TableCell className="tabular-nums">{room.members}</TableCell><TableCell><time dateTime={room.lastActiveAt}>{date(room.lastActiveAt)}</time></TableCell><TableCell>{room.sandbox === "running" ? "Running" : room.sandbox === "stopped" ? "Stopped" : "Couldn't tell"}</TableCell></TableRow>;
}

function Rooms() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["instance-admin", "rooms", search, page], queryFn: ({ signal }) => api<AdminRoomsPage>(`/api/admin/rooms?${new URLSearchParams({ search, page: String(page), pageSize: String(PAGE_SIZE) })}`, { signal }), refetchInterval: 30_000 });
  return <section aria-label="Rooms" className="grid min-w-0 gap-4"><h2 className="text-base font-medium">Rooms</h2><p className="text-muted-foreground">Being an instance admin does not grant access to a room or its files. Normal room permissions still apply.</p><Search kind="rooms" busy={query.isFetching} onSearch={(value) => { setPage(1); setSearch(value); }} />
    {query.isPending ? <Skeleton className="h-48" /> : query.isError ? <RequestError error={query.error} retry={() => void query.refetch()} /> : <><Table aria-label="Instance rooms"><TableHeader><TableRow><TableHead>Room</TableHead><TableHead>Organisation</TableHead><TableHead>Owners</TableHead><TableHead>Kind and visibility</TableHead><TableHead>Members</TableHead><TableHead>Last active</TableHead><TableHead>Sandbox</TableHead></TableRow></TableHeader><TableBody>{query.data.items.length ? query.data.items.map((room) => <RoomRow key={room.id} room={room} />) : <TableRow><TableCell colSpan={7}>No rooms match this search.</TableCell></TableRow>}</TableBody></Table><Pagination kind="Rooms" page={query.data.page} total={query.data.total} pageSize={query.data.pageSize} busy={query.isFetching} onPage={setPage} /></>}
  </section>;
}

function Health() {
  const query = useQuery({ queryKey: ["instance-admin", "health"], queryFn: ({ signal }) => api<AdminHealth>("/api/admin/health", { signal }), refetchInterval: 30_000 });
  return <section aria-label="Health" className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-medium">Health</h2><Button size="sm" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /> Check now</Button></div><p className="text-muted-foreground">Service checks and the counters exposed by the runner and collaboration service. Missing or unreachable counters are shown as unknown.</p>
    {query.isPending ? <Skeleton className="h-48" /> : query.isError ? <RequestError error={query.error} retry={() => void query.refetch()} /> : <><p className="text-xs text-muted-foreground">Last checked <time dateTime={query.data.checkedAt}>{date(query.data.checkedAt)}</time></p><Table aria-label="Instance health"><TableHeader><TableRow><TableHead>Check</TableHead><TableHead>Status</TableHead><TableHead>Details</TableHead><TableHead>Checked</TableHead></TableRow></TableHeader><TableBody>{query.data.checks.map((check) => <TableRow key={check.id}><TableCell className="font-medium">{check.label}</TableCell><TableCell><Badge variant="outline">{check.status === "up" ? "Up" : check.status === "down" ? "Down" : "Couldn't tell"}</Badge></TableCell><TableCell className="max-w-96 whitespace-normal">{check.value !== null && <span className="mr-2 font-mono tabular-nums">{check.value}</span>}{check.detail || (check.value === null ? "No detail available" : "")}</TableCell><TableCell><time dateTime={check.checkedAt}>{date(check.checkedAt)}</time></TableCell></TableRow>)}</TableBody></Table></>}
  </section>;
}

export function AdminPage({ userId }: { userId: string }) {
  return <><PageHeader title="Instance admin" description="Accounts, rooms and health for this CodeChatter server." /><Tabs defaultValue="users" className="min-w-0 gap-5 px-6 py-4 sm:px-8"><TabsList aria-label="Instance administration"><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="rooms">Rooms</TabsTrigger><TabsTrigger value="health">Health</TabsTrigger></TabsList><TabsContent value="users" className="min-w-0"><Users ownId={userId} /></TabsContent><TabsContent value="rooms" className="min-w-0"><Rooms /></TabsContent><TabsContent value="health" className="min-w-0"><Health /></TabsContent></Tabs></>;
}
