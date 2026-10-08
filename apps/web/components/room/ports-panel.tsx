"use client";

import type { SandboxStatus } from "@codechatter/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, RotateCcw } from "lucide-react";
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
 * The room's sandbox at a glance: live CPU, memory and processes, the ports
 * servers listen on (each opens as a live preview on its own origin), and
 * Restart for a sandbox that's stuck.
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
        <p className="mt-2 text-xs text-muted-foreground">Live previews are turned off on this server (PREVIEW_ORIGIN isn't set).</p>
      )}
    </div>
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
