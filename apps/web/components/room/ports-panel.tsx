"use client";

import { PACKAGE_REGISTRIES, type SandboxStatus } from "@codechatter/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = SandboxStatus & { previews: boolean };

/** Well-known dev-server ports, named so the list reads at a glance. */
const KNOWN: Record<number, string> = {
  3000: "Node / Next.js",
  4200: "Angular",
  5000: "Flask",
  5173: "Vite",
  8000: "Django / FastAPI",
  8080: "HTTP server",
  8888: "Jupyter",
};

/**
 * The room's sandbox at a glance: live CPU, memory and processes, package
 * installs, the ports servers listen on (each opens as a live preview on its
 * own origin), and Restart for a sandbox that's stuck.
 */
export function PortsPanel({ visible }: { visible: boolean }) {
  const { room, can } = useRoom();
  const status = useQuery({
    queryKey: ["sandbox", room.id],
    queryFn: () => api<Status>(`/api/rooms/${room.id}/sandbox`),
    refetchInterval: visible ? 2000 : false,
    enabled: visible,
  });
  const restart = useMutation({
    mutationFn: () => api(`/api/rooms/${room.id}/sandbox/restart`, { method: "POST" }),
    onSuccess: () => toast.success("Sandbox restarted"),
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Couldn't restart the sandbox."),
  });

  async function openPreview(port: number) {
    // Open the tab synchronously (popup blockers), then point it at the one-time link.
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await api<{ url: string }>(`/api/rooms/${room.id}/preview`, { method: "POST", json: { port } });
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      tab?.close();
      toast.error(e instanceof ApiError ? e.detail : "Couldn't open the preview.");
    }
  }

  const data = status.data;
  return (
    <div className="h-full overflow-y-auto p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Meter label="CPU" value={data?.cpuPercent ?? null} max={100} unit="%" />
        <Meter label="Memory" value={data?.memory?.usedMb ?? null} max={data?.memory?.limitMb ?? 0} unit=" MB" />
        <Meter label="Processes" value={data?.processes?.current ?? null} max={data?.processes?.limit ?? 0} unit="" />
        {can("terminal.open") && (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            disabled={restart.isPending || !data?.running}
            onClick={() => {
              if (window.confirm("Restart the sandbox? Running programs and terminals in this room stop. Files are kept.")) restart.mutate();
            }}
          >
            {restart.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Restart sandbox
          </Button>
        )}
      </div>

      <Installs roomId={room.id} installs={data?.installs ?? null} canSwitch={can("sandbox.network")} />

      <h3 className="mt-5 mb-2 text-xs font-medium text-muted-foreground">Ports</h3>
      {!data?.running ? (
        <p className="text-muted-foreground">The sandbox starts when someone runs code or opens a terminal.</p>
      ) : data.ports.length === 0 ? (
        <p className="text-muted-foreground">
          No servers yet. Start one in a terminal (for example <code className="rounded-sm bg-muted px-1 font-mono text-xs">npm run dev</code> or{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-xs">python3 -m http.server 8000</code>) and its port appears here.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {data.ports.map((port) => (
            <li key={port} className="flex items-center gap-3 px-3 py-2">
              <span className="font-mono tabular-nums">{port}</span>
              <span className="text-xs text-muted-foreground">{KNOWN[port] ?? "Server"}</span>
              <Button size="xs" variant="ghost" className="ml-auto" disabled={!data.previews} onClick={() => void openPreview(port)}>
                <ExternalLink /> Open preview
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data && !data.previews && data.ports.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">Live previews are turned off on this server (PREVIEW_ORIGIN isn&apos;t set).</p>
      )}
    </div>
  );
}

/**
 * Package installs (ADR 0007): the sandbox has no internet, and the owner can
 * open package registries, and nothing else, for an hour. Everyone sees when
 * they're open and who opened them.
 */
function Installs({ roomId, installs, canSwitch }: { roomId: string; installs: SandboxStatus["installs"]; canSwitch: boolean }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (allow: boolean) => api(`/api/rooms/${roomId}/sandbox/installs`, { method: allow ? "PUT" : "DELETE" }),
    onSuccess: (_, allow) => {
      toast.success(allow ? "Package installs allowed for an hour" : "Package installs turned off");
      void queryClient.invalidateQueries({ queryKey: ["sandbox", roomId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.detail : "Couldn't change package installs."),
  });
  const until = installs && new Date(installs.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section aria-label="Package installs">
      <h3 className="mt-5 mb-2 text-xs font-medium text-muted-foreground">Package installs</h3>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", installs ? "bg-brand" : "bg-muted-foreground/40")} />
        <div className="min-w-0 flex-1">
          <p>
            {installs
              ? `On until ${until}${installs.by ? `, allowed by ${installs.by}` : ""}. Terminals and Run reach package registries, and nothing else.`
              : "Off. The sandbox has no internet."}
          </p>
          <p className="text-xs text-muted-foreground">{PACKAGE_REGISTRIES.map((registry) => registry.name).join(", ")}</p>
        </div>
        {canSwitch ? (
          <Button size="xs" variant="outline" disabled={change.isPending} onClick={() => change.mutate(!installs)}>
            {change.isPending ? <Loader2 className="animate-spin" /> : !installs && <Download />}
            {installs ? "Turn off" : "Allow for an hour"}
          </Button>
        ) : (
          !installs && <span className="text-xs text-muted-foreground">The room&apos;s owner can turn them on.</span>
        )}
      </div>
    </section>
  );
}

function Meter({ label, value, max, unit }: { label: string; value: number | null; max: number; unit: string }) {
  const ratio = value !== null && max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="min-w-36">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {value === null ? "—" : `${value}${unit}`}
          {value !== null && max > 0 && unit !== "%" && <span className="text-muted-foreground"> / {max}{unit}</span>}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width]", ratio > 0.85 ? "bg-destructive" : "bg-foreground/70")} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
