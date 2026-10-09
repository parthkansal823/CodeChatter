"use client";

import { ROOM_CONFIG_PATH, type DevServerStatus, type SandboxStatus } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, Play, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { openPreview } from "@/components/room/open-preview";
import { useRoom } from "@/components/room/room-context";
import { TerminalView } from "@/components/room/terminal-view";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The room's dev server (roadmap §14 C): what `.codechatter/room.json` says to
 * install and run, in one terminal everyone in the room shares. People with
 * terminal rights start, restart and stop it; once its port listens, its
 * preview opens on its own origin.
 */
export function DevServerPanel({ visible }: { visible: boolean }) {
  const { room, can } = useRoom();
  const queryClient = useQueryClient();
  const key = ["dev", room.id];
  const status = useQuery({
    queryKey: key,
    queryFn: () => api<DevServerStatus>(`/api/rooms/${room.id}/dev`),
    refetchInterval: visible ? 2000 : false,
    staleTime: 0,
  });
  // Whether package installs are on (the Ports panel's query, shared).
  const sandbox = useQuery({
    queryKey: ["sandbox", room.id],
    queryFn: () => api<SandboxStatus>(`/api/rooms/${room.id}/sandbox`),
    refetchInterval: visible ? 5000 : false,
    enabled: visible,
  });
  // A new terminal after each start: the session it showed is gone.
  const [starts, setStarts] = useState(0);
  const change = useMutation({
    mutationFn: async (action: "start" | "stop" | "install") => {
      // One click for the owner: allow installs for the hour, then start.
      if (action === "install") await api(`/api/rooms/${room.id}/sandbox/installs`, { method: "PUT" });
      return api<DevServerStatus>(`/api/rooms/${room.id}/dev`, {
        method: action === "stop" ? "DELETE" : "POST",
      });
    },
    onSuccess: (next, action) => {
      queryClient.setQueryData(key, next);
      if (action !== "stop") setStarts((n) => n + 1);
      if (action === "install") void queryClient.invalidateQueries({ queryKey: ["sandbox", room.id] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Couldn't change the dev server."),
  });

  const data = status.data;
  const config = data?.config ?? null;
  const settings = config && !("error" in config) ? config : null;
  const manage = can("terminal.open");
  // The first start installs packages, which needs installs on; the owner can switch them on with it.
  const installFirst = Boolean(
    !data?.running && settings?.install && data?.needsInstall !== false && !sandbox.data?.installs,
  );
  const canAllow = can("sandbox.network");
  const state = !data?.running
    ? "Stopped"
    : data.listening
      ? `Running on port ${settings?.port}`
      : settings?.port
        ? `Running, not listening on port ${settings.port} yet`
        : "Running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            data?.listening
              ? "bg-success"
              : data?.running
                ? "animate-pulse bg-warning"
                : "bg-muted-foreground/40",
          )}
        />
        <span className="font-medium">{status.isPending ? "Checking" : state}</span>
        {settings?.dev && <code className="truncate font-mono text-muted-foreground">{settings.dev}</code>}
        <div className="ml-auto flex items-center gap-1">
          {data?.listening && settings?.port && (
            <Button size="xs" variant="outline" onClick={() => void openPreview(room.id, settings.port!)}>
              <ExternalLink /> Open preview
            </Button>
          )}
          {manage && settings?.dev && installFirst && canAllow && (
            <Button size="xs" disabled={change.isPending} onClick={() => change.mutate("install")}>
              {change.isPending && change.variables === "install" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              Allow installs and start
            </Button>
          )}
          {manage && settings?.dev && (
            <Button
              size="xs"
              variant={installFirst && canAllow ? "outline" : "default"}
              disabled={change.isPending}
              onClick={() => change.mutate("start")}
            >
              {change.isPending && change.variables === "start" ? (
                <Loader2 className="animate-spin" />
              ) : data?.running ? (
                <RotateCcw />
              ) : (
                <Play />
              )}
              {data?.running ? "Restart" : "Start"}
            </Button>
          )}
          {manage && data?.running && (
            <Button
              size="xs"
              variant="outline"
              disabled={change.isPending}
              onClick={() => change.mutate("stop")}
            >
              <Square /> Stop
            </Button>
          )}
        </div>
      </div>
      {manage && installFirst && !canAllow && (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
          The first start installs packages, which needs the room&apos;s owner to allow package installs
          (Ports tab).
        </p>
      )}
      {config && "error" in config && (
        <p className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{config.error}</p>
      )}
      <div className="relative min-h-0 flex-1">
        {/* Only while it runs: opening the shared session would otherwise start an empty one.
            And only for people with terminal rights: it's a shell, and the API lets no one else in. */}
        {data?.running && manage ? (
          <TerminalView key={starts} shared="dev" />
        ) : data?.running ? (
          <p className="px-6 py-8 text-center text-xs text-muted-foreground">
            The dev server is running. Its terminal is for people with terminal rights in this room.
          </p>
        ) : (
          <div className="mx-auto max-w-lg px-6 py-8 text-center text-xs text-muted-foreground">
            {settings?.dev ? (
              <>
                <p>
                  Start runs this room&apos;s app, as <code className="font-mono">{ROOM_CONFIG_PATH}</code>{" "}
                  says:
                  {settings.install && (
                    <>
                      {" "}
                      <code className="font-mono text-foreground">{settings.install}</code> the first time,
                      then
                    </>
                  )}{" "}
                  <code className="font-mono text-foreground">{settings.dev}</code>
                  {settings.databases?.length
                    ? `, with ${settings.databases.join(" and ")} started first`
                    : ""}
                  .
                </p>
                <p className="mt-2">
                  Its output shows here, the same for everyone in the room.
                  {manage ? "" : " People with terminal rights can start it."}
                </p>
              </>
            ) : !config || "error" in config ? null : (
              <p>{ROOM_CONFIG_PATH} has no &quot;dev&quot; command to run.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
