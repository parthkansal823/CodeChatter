"use client";

import { notificationText, type NotificationItem, type NotificationSettings } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, MessageSquare, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

const KEY = ["notifications"] as const;
const SETTINGS_KEY = ["notification-settings"] as const;

const ICON = { mention: AtSign, "comment.reply": MessageSquare, "comment.new": MessageSquare, "room.joined": UserPlus, "room.requested": UserPlus };

/**
 * The inbox: a bell with how many notifications are unread, and the list. New ones arrive
 * live (the socket's own channel) with a short message, and the list is read again every
 * minute where there's no socket. Opening one marks it read and goes to its room.
 */
export function NotificationsBell({ className }: { className?: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ items: NotificationItem[]; unread: number }>("/api/me/notifications"),
    refetchInterval: 60_000,
  });
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<NotificationSettings>("/api/me/notification-settings"),
    enabled: open,
  });
  const read = useMutation({
    mutationFn: (body: { ids: string[] } | { all: true }) => api("/api/me/notifications/read", { method: "POST", json: body }),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const saveSettings = useMutation({
    mutationFn: (emailDigest: boolean) => api<NotificationSettings>("/api/me/notification-settings", { method: "PUT", json: { emailDigest } }),
    onSuccess: (data) => client.setQueryData(SETTINGS_KEY, data),
  });

  // Live: a new one is added at once, with a word about it.
  useEffect(() => {
    const socket = getSocket();
    const onNew = (item: NotificationItem) => {
      void client.invalidateQueries({ queryKey: KEY });
      toast.message(notificationText(item), { id: `notification-${item.id}` });
    };
    socket.on("notification:new", onNew);
    return () => void socket.off("notification:new", onNew);
  }, [client]);

  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];
  const go = (item: NotificationItem) => {
    if (!item.readAt) read.mutate({ ids: [item.id] });
    setOpen(false);
    if (item.room) router.push(`/rooms/${item.room.id}` as never);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className={cn("relative", className)}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] leading-none font-semibold text-brand-foreground tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" aria-label="Notifications">
        <div className="flex h-9 items-center gap-2 border-b px-3">
          <span className="text-xs font-medium">Notifications</span>
          <Button variant="ghost" size="xs" className="ml-auto h-6 text-xs" disabled={!unread} onClick={() => read.mutate({ all: true })}>
            Mark all read
          </Button>
        </div>
        <ul aria-label="Notifications" className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing yet. Mentions, replies on your comments and people joining your rooms show here.</li>
          ) : (
            items.map((item) => {
              const Icon = ICON[item.type] ?? Bell;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => go(item)}
                    className={cn("flex w-full gap-2 px-3 py-2 text-left text-xs hover:bg-accent", !item.readAt && "bg-brand-muted/30")}
                  >
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="line-clamp-3 break-words">{notificationText(item)}</span>
                      <span className="text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
                    </span>
                    {!item.readAt && <span aria-label="Unread" className="mt-1 size-2 shrink-0 rounded-full bg-brand" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <label className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <Switch
            checked={settings.data?.emailDigest ?? true}
            disabled={!settings.data || saveSettings.isPending}
            onCheckedChange={(on) => saveSettings.mutate(on)}
            aria-label="Email me what I miss"
          />
          Email me what stays unread for an hour (at most daily)
        </label>
      </PopoverContent>
    </Popover>
  );
}
