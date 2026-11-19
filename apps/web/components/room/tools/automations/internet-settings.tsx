/**
 * The Internet dialog of the Automations tool: rooms reach nothing outside themselves, so a room's owner turns on the services its automations call
 * (each piece's hosts, PIECE_HOSTS in contracts), and any other hosts by name. The room's proxy (ADR 0007) then opens HTTPS tunnels to those hosts only,
 * for every program in the room, until they're turned off. Others in the room see what's on and who turned it on.
 */
"use client";

import { PIECE_HOSTS, type AutomationInternet, type PieceInfo } from "@codechatter/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";

const OPEN_EVENT = "cc:automation-internet";
const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");

export function openInternet() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function InternetDialog({ pieces }: { pieces: Record<string, PieceInfo> }) {
  const { room, can } = useRoom();
  const owner = can("sandbox.network");
  const queryClient = useQueryClient();
  const key = ["automations", room.id, "internet"];
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<string[] | null>(null);
  const [hosts, setHosts] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = useQuery({ queryKey: key, queryFn: () => api<AutomationInternet>(`/api/rooms/${room.id}/automations/internet`), enabled: open, retry: false });
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setServices(null);
      setHosts(null);
      setProblem(null);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  const chosen = services ?? current.data?.services ?? [];
  const typed = hosts ?? (current.data?.hosts ?? []).join("\n");
  const choices = Object.entries(PIECE_HOSTS)
    .filter(([name, entry]) => pieces[name] && entry.hosts.length > 0)
    .sort(([a], [b]) => (pieces[a]?.label ?? a).localeCompare(pieces[b]?.label ?? b));

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await api<AutomationInternet>(`/api/rooms/${room.id}/automations/internet`, {
        method: "PUT",
        json: {
          services: chosen,
          hosts: typed
            .split(/[\s,]+/)
            .map((each) => each.trim())
            .filter(Boolean),
        },
      });
      queryClient.setQueryData(key, saved);
      setServices(null);
      setHosts(null);
    } catch (error) {
      setProblem(failure(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto text-xs sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>The internet</DialogTitle>
          <DialogDescription>
            A room reaches nothing outside itself. Turn on the services its automations call: every program in the room can then reach their hosts, and only those, over HTTPS. Turn them off when they&apos;re not needed.
          </DialogDescription>
        </DialogHeader>
        {current.isPending ? (
          <p className="text-muted-foreground">Reading what&apos;s on…</p>
        ) : current.isError ? (
          <p role="alert" className="text-destructive">
            {failure(current.error)}
          </p>
        ) : (
          <div className="grid gap-3">
            {current.data.on.length > 0 ? (
              <p>
                On for {current.data.on.length} {current.data.on.length === 1 ? "host" : "hosts"}
                {current.data.by ? `, by ${current.data.by}` : ""}
                {current.data.at ? `, ${new Date(current.data.at).toLocaleString()}` : ""}.
              </p>
            ) : (
              <p className="text-muted-foreground">Off: the room reaches only itself.</p>
            )}
            <fieldset className="grid gap-1" disabled={!owner || busy}>
              <legend className="mb-1 font-medium">Services</legend>
              <div className="grid grid-cols-2 gap-1">
                {choices.map(([name, entry]) => (
                  <label key={name} className="flex items-start gap-2" title={entry.hosts.join(", ")}>
                    <input type="checkbox" className="mt-0.5" checked={chosen.includes(name)} onChange={(event) => setServices(event.target.checked ? [...chosen, name] : chosen.filter((each) => each !== name))} />
                    <span className="grid min-w-0">
                      {pieces[name]?.label ?? name}
                      <span className="truncate font-mono text-[10px] text-muted-foreground">{entry.hosts.join(", ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="grid gap-1">
              Other hosts, one a line
              <Textarea
                className="min-h-16 font-mono text-[11px] md:text-[11px]"
                spellCheck={false}
                readOnly={!owner}
                placeholder={"your-team.atlassian.net\nfeeds.example.com"}
                value={typed}
                onChange={(event) => setHosts(event.target.value)}
              />
              <span className="text-muted-foreground">For the HTTP, RSS and GraphQL steps, and services with a host of their own (Jira, Confluence, Supabase). Names only: no addresses, ports or paths.</span>
            </label>
            {problem && (
              <p role="alert" className="text-destructive">
                {problem}
              </p>
            )}
            {owner ? (
              <div>
                <Button size="xs" disabled={busy} onClick={() => void save()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Globe />} Save
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">Only the room&apos;s owners turn the internet on and off.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
