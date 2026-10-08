"use client";

import { ChevronRight, Link2, Lock, Globe2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { LogoMark } from "@/components/brand/logo";
import { PresenceAvatar } from "@/components/presence/presence";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { copyText } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** `actions` sit before Share (the workspace puts Run there). */
export function TitleBar({ actions }: { actions?: ReactNode }) {
  const { room, me, mySlot, status } = useRoom();
  const peers = usePeers();

  async function copyCode() {
    if (await copyText(room.id)) toast.success(`Room code ${room.id} copied`);
    else toast.message(`Room code: ${room.id}`);
  }

  return (
    <header className="flex h-titlebar shrink-0 items-center gap-3 border-b bg-chrome px-3">
      <Link href="/dashboard" aria-label="Back to rooms" className="rounded-sm">
        <LogoMark className="size-4" />
      </Link>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link href="/dashboard" className="hidden text-muted-foreground hover:text-foreground sm:inline">
          Rooms
        </Link>
        <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
        <span className="truncate font-medium">{room.name}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={copyCode} className="rounded-sm px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
              {room.id}
            </button>
          </TooltipTrigger>
          <TooltipContent>Copy room code</TooltipContent>
        </Tooltip>
        {room.visibility === "private" ? (
          <Lock aria-label="Private room" className="size-3.5 text-muted-foreground" />
        ) : (
          <Globe2 aria-label="Public room" className="size-3.5 text-muted-foreground" />
        )}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5" aria-label={`${peers.length + 1} people here`}>
          {peers.slice(0, 5).map((peer) => (
            <Tooltip key={peer.user.id}>
              <TooltipTrigger asChild>
                <span>
                  <PresenceAvatar name={peer.user.name} image={peer.user.image} slot={peer.user.slot} size={24} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{peer.user.name}</TooltipContent>
            </Tooltip>
          ))}
          {peers.length > 5 && <span className="text-xs text-muted-foreground">+{peers.length - 5}</span>}
          <PresenceAvatar name={me.user.name} image={me.user.image} slot={mySlot} size={24} className={status !== "connected" ? "opacity-50" : undefined} />
        </div>
        {actions}
        <Button variant="outline" size="sm" onClick={copyCode}>
          <Link2 /> Share
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
