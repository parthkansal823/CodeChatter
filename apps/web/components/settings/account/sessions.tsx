/** Show owned active sessions and revoke other devices without rendering their authentication tokens. */
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";

import { describeSessionAgent } from "./session-agent";

type Session = NonNullable<Awaited<ReturnType<typeof authClient.listSessions>>["data"]>[number];

class SessionError extends Error {
  constructor(readonly needsSignIn: boolean) { super(needsSignIn ? "Sign in again to manage your sessions." : "Couldn't load your sessions. Try again."); }
}

function timeText(value: string | Date): string { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }

export function AccountSessions({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const key = ["account-sessions", userId];
  const [busy, setBusy] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: key,
    gcTime: 0,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const [result, current] = await Promise.all([
        authClient.listSessions({ fetchOptions: { signal } }),
        authClient.getSession({ query: { disableCookieCache: true }, fetchOptions: { signal } }),
      ]);
      if (result.error || current.error || !current.data || current.data.user.id !== userId) {
        const status = result.error?.status ?? current.error?.status;
        throw new SessionError(!current.data || status === 401 || status === 403);
      }
      const items = result.data ?? [];
      if (items.some((item) => item.userId !== userId)) throw new SessionError(true);
      return { items, currentId: current.data.session.id };
    },
  });

  useEffect(() => () => {
    // Native revokeSession needs a token. Keep those credentials only in the active view's memory.
    queryClient.removeQueries({ queryKey: ["account-sessions", userId], exact: true });
  }, [queryClient, userId]);

  async function revoke(session?: Session) {
    if (busy || (session && session.id === sessions.data?.currentId)) return;
    setBusy(session?.id ?? "all");
    try {
      const result = session ? await authClient.revokeSession({ token: session.token }) : await authClient.revokeOtherSessions();
      if (result.error) { toast.error(result.error.status === 401 || result.error.status === 403 ? "Sign in again before signing out other devices." : "Couldn't sign out the device. Try again."); return; }
      await sessions.refetch();
      toast.success(session ? "Device signed out." : "Other devices signed out.");
    } catch { toast.error("Couldn't connect. Check your connection and try again."); }
    finally { setBusy(null); }
  }

  const others = sessions.data?.items.filter((session) => session.id !== sessions.data.currentId) ?? [];
  return (
    <section aria-labelledby="account-sessions-heading" className="grid gap-4 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="account-sessions-heading" className="font-medium">Where you&apos;re signed in</h2><p className="text-muted-foreground">Sign out devices you no longer use.</p></div><Button size="icon-sm" variant="outline" aria-label="Refresh sessions" disabled={sessions.isFetching || Boolean(busy)} onClick={() => void sessions.refetch()}><RefreshCw aria-hidden className="size-3.5" /></Button></div>
      {sessions.isPending ? <p role="status" className="text-muted-foreground">Loading sessions…</p> : sessions.isError ? (
        <div role="alert" className="grid gap-2"><p className="text-destructive">{sessions.error.message}</p>{sessions.error instanceof SessionError && sessions.error.needsSignIn && <Link href="/sign-in?returnTo=%2Fsettings%2Faccount" className="text-xs underline underline-offset-4">Sign in again</Link>}</div>
      ) : (
        <>
          <div className="rounded-md border"><Table className="min-w-2xl text-xs" aria-label="Active sessions">
            <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>IP address</TableHead><TableHead>Last active</TableHead><TableHead>Started</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>{sessions.data?.items.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="whitespace-normal"><div>{describeSessionAgent(session.userAgent)}</div>{session.id === sessions.data.currentId && <span className="font-medium text-muted-foreground">This device</span>}</TableCell>
                <TableCell>{session.ipAddress || "Not recorded"}</TableCell>
                <TableCell><time dateTime={new Date(session.updatedAt).toISOString()}>{timeText(session.updatedAt)}</time></TableCell>
                <TableCell><time dateTime={new Date(session.createdAt).toISOString()}>{timeText(session.createdAt)}</time></TableCell>
                <TableCell className="text-right">{session.id !== sessions.data.currentId && <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => void revoke(session)}>{busy === session.id ? "Signing out…" : "Sign out"}</Button>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table></div>
          <div><Button size="sm" variant="outline" disabled={Boolean(busy) || !others.length} onClick={() => void revoke()}>{busy === "all" ? "Signing out…" : "Sign out all other devices"}</Button></div>
          <p className="text-xs text-muted-foreground">Last active is when the session was last refreshed. Device names come from the browser and may be approximate.</p>
        </>
      )}
    </section>
  );
}
