"use client";

import { ChevronRight, Link2, Lock, Globe2, Search, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { LogoMark } from "@/components/brand/logo";
import { PresenceAvatar } from "@/components/presence/presence";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { copyText } from "@/lib/clipboard";
import { openQuickOpen } from "@/components/room/editor/ui-store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The right panel: what it shows now, how to switch it, and the toggles for the title bar. */
export type SidePanel = {
  panel: string | null;
  toggle: (id: string) => void;
  items: Array<{ id: string; label: string; icon: LucideIcon; badge?: number }>;
};

/** `actions` sit before Share (the workspace puts Run there). `side` adds the Chat and AI toggles; the avatars open People. */
export function TitleBar({ actions, side }: { actions?: ReactNode; side?: SidePanel }) {
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
            <button
              onClick={copyCode}
              className="rounded-sm px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
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

      {/* The command centre, as in VS Code: files by name, and ">" for every command (F1 or Ctrl+Shift+P too). */}
      <div className="hidden min-w-0 flex-1 justify-center px-2 md:flex">
        <button
          type="button"
          onClick={openQuickOpen}
          className="flex h-7 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-2.5 text-left text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Search files, or type &gt; for commands</span>
          <Kbd>Ctrl P</Kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <PeopleButton side={side}>
          <div className="flex items-center gap-1.5" aria-label={`${peers.length + 1} people here`}>
            {peers.slice(0, 5).map((peer) => (
              <Tooltip key={peer.user.id}>
                <TooltipTrigger asChild>
                  <span>
                    <PresenceAvatar
                      name={peer.user.name}
                      image={peer.user.image}
                      slot={peer.user.slot}
                      size={24}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{peer.user.name}</TooltipContent>
              </Tooltip>
            ))}
            {peers.length > 5 && <span className="text-xs text-muted-foreground">+{peers.length - 5}</span>}
            <PresenceAvatar
              name={me.user.name}
              image={me.user.image}
              slot={mySlot}
              size={24}
              className={status !== "connected" ? "opacity-50" : undefined}
            />
          </div>
        </PeopleButton>
        {side && (
          <div role="group" aria-label="Side panel" className="flex items-center gap-0.5">
            {side.items.map(({ id, label, icon: Icon, badge = 0 }) => (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={side.panel === id ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={badge ? `${label}, ${badge} unread` : label}
                    aria-pressed={side.panel === id}
                    onClick={() => side.toggle(id)}
                    className="relative"
                  >
                    <Icon />
                    {badge > 0 && (
                      <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] leading-none font-semibold text-brand-foreground tabular-nums">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
        {actions}
        <Button variant="outline" size="sm" onClick={copyCode}>
          <Link2 /> Share
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Clicking the people in the room opens the People panel. */
function PeopleButton({ side, children }: { side?: SidePanel; children: ReactNode }) {
  if (!side) return <>{children}</>;
  return (
    <button
      type="button"
      title="Who's here"
      aria-pressed={side.panel === "people"}
      onClick={() => side.toggle("people")}
      className={cn("rounded-full p-0.5 hover:bg-accent", side.panel === "people" && "bg-accent")}
    >
      {children}
    </button>
  );
}
