"use client";

import type { RoomRepo, WebhookSetup } from "@codechatter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

import { repoKey } from "./use-repo";

/**
 * The Source Control view's switch for GitHub activity in the room's chat (pushes, pull
 * requests, Actions results), for people who manage the room. With a token that can, the
 * webhook is made on GitHub; otherwise the address and secret to add it by hand show once.
 */
export function WebhookSection({ repo }: { repo: RoomRepo }) {
  const { room } = useRoom();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Extract<WebhookSetup, { made: "manual" }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: repoKey(room.id) });

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const setup = await api<WebhookSetup>(`/api/rooms/${room.id}/repo/webhook`, { method: "POST" });
      if (setup.made === "github") toast.success("GitHub will post its activity in chat");
      setManual(setup.made === "manual" ? setup : null);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't turn it on. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await api<void>(`/api/rooms/${room.id}/repo/webhook`, { method: "DELETE" });
      setManual(null);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't turn it off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Activity in chat
        <span className="ml-auto">{repo.webhook ? "On" : "Off"}</span>
      </button>
      {open && (
        <div className="grid max-h-72 gap-2 overflow-y-auto px-3 pb-3 text-xs">
          <p className="text-muted-foreground">
            Pushes, pull requests and Actions results on {repo.owner}/{repo.name}, posted to this room’s chat.
          </p>
          {repo.webhook ? (
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void turnOff()}>
              Turn off
            </Button>
          ) : (
            <Button variant="outline" size="xs" disabled={busy} onClick={() => void turnOn()}>
              {busy ? "Connecting…" : "Post GitHub activity to chat"}
            </Button>
          )}
          {manual && <ManualSteps repo={repo} setup={manual} />}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Adding the webhook by hand: shown once, as the secret isn't kept readable. */
function ManualSteps({ repo, setup }: { repo: RoomRepo; setup: { url: string; secret: string } }) {
  const local = /\/\/(localhost|127\.)/.test(setup.url);
  return (
    <div
      role="region"
      aria-label="Add the webhook on GitHub"
      className="grid gap-1.5 rounded-md border bg-background p-2"
    >
      <p>
        Your token can’t add webhooks here, so add it on GitHub:{" "}
        <a
          href={`https://github.com/${repo.owner}/${repo.name}/settings/hooks/new`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline underline-offset-2"
        >
          Settings → Webhooks → Add webhook <ExternalLink className="size-3" />
        </a>
      </p>
      <CopyField label="Payload URL" value={setup.url} />
      <CopyField label="Secret" value={setup.secret} />
      <p className="text-muted-foreground">
        Content type application/json. Events: pushes, pull requests and workflow runs. The secret is shown
        only now.
      </p>
      {local && (
        <p className="text-muted-foreground">
          GitHub can’t reach a localhost address: deliveries arrive once CodeChatter has a public one
          (docs/deploy.md).
        </p>
      )}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 rounded-sm border bg-panel px-1.5 py-1 font-mono break-all select-all">
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Copy the ${label.toLowerCase()}`}
          onClick={async () => {
            if (!(await copyText(value)))
              return void toast.error("Couldn’t copy. Select it and copy it by hand.");
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
