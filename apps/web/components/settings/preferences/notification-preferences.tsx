/** Save the existing digest preference immediately and restore its previous value on failure. */
"use client";

import type { NotificationSettings } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useMe } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

export function NotificationPreferences() {
  const me = useMe();
  const client = useQueryClient();
  const key = ["notification-preferences", me.user.id];
  const [message, setMessage] = useState<string | null>(null);
  const settings = useQuery({
    queryKey: key,
    retry: false,
    queryFn: ({ signal }) => api<NotificationSettings>("/api/me/notification-settings", { signal }),
  });
  const save = useMutation({
    mutationFn: (emailDigest: boolean) => api<NotificationSettings>("/api/me/notification-settings", { method: "PUT", json: { emailDigest } }),
    onMutate: async (emailDigest) => {
      setMessage(null);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<NotificationSettings>(key);
      client.setQueryData<NotificationSettings>(key, { emailDigest });
      return { previous };
    },
    onSuccess: async (saved) => {
      // Focus or reconnect can start a new read while this write is pending.
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, saved);
    },
    onError: async (_error, _value, context) => {
      await client.cancelQueries({ queryKey: key });
      if (context?.previous) client.setQueryData(key, context.previous);
      setMessage("Couldn't save your digest preference. Your previous setting is back. Try again.");
    },
  });

  return (
    <section aria-labelledby="notifications-heading" className="grid gap-3 border-t pt-6">
      <div className="grid gap-1">
        <h2 id="notifications-heading" className="font-medium">Notifications</h2>
        <p id="digest-description" className="text-muted-foreground">Unread mentions, code comments, join requests and room membership changes are grouped into a digest; the server controls how often it is sent.</p>
        <p className="text-muted-foreground">Email delivery depends on this server&apos;s mail setup.</p>
      </div>
      {settings.isPending ? <p role="status" className="text-muted-foreground">Loading notification settings…</p> : settings.isError && !settings.data ? (
        <div className="grid gap-2">
          <p role="alert">Couldn&apos;t load your notification settings. Try again.</p>
          <div><Button size="sm" variant="outline" onClick={() => void settings.refetch()}>Retry notification settings</Button></div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
            <Label htmlFor="email-digest">Email me a daily digest</Label>
            <Switch id="email-digest" aria-describedby="digest-description" checked={settings.data?.emailDigest ?? false} disabled={save.isPending || settings.isFetching} onCheckedChange={(value) => { if (!save.isPending) save.mutate(value); }} />
          </div>
          {message ? <p role="alert">{message}</p> : <p role="status" className="text-muted-foreground">{save.isPending ? "Saving digest preference…" : save.isSuccess ? "Digest preference saved." : "Your inbox notifications stay on."}</p>}
          {settings.isError && <p role="alert">Couldn&apos;t refresh your notification settings. Showing the last saved preference.</p>}
        </>
      )}
    </section>
  );
}
