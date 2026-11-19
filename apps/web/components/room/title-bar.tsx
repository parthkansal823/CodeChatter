"use client";

import { chatUnreadLabel } from "@codechatter/contracts";
import { ChevronRight, GitFork, Moon, MoreHorizontal, Presentation, Search, Sun, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { LogoMark } from "@/components/brand/logo";
import { NotificationsBell } from "@/components/notifications/notifications-bell";
import { CallButton } from "@/components/room/call/call-dock";
import { useChatUnread } from "@/components/room/chat-panel";
import { ForkDialog } from "@/components/room/fork-dialog";
import { ShareMenu } from "@/components/room/share-menu";
import { VisibilityMenu } from "@/components/room/visibility-menu";
import { PresenceAvatar } from "@/components/presence/presence";
import { usePeers } from "@/components/room/hooks";
import { useRoomPeople } from "@/components/room/people/use-room-people";
import { useRoom } from "@/components/room/room-context";
import { copyText } from "@/lib/clipboard";
import { keyLabel, keysFor } from "@/components/room/editor/keybindings";
import { useEditorSettings } from "@/components/room/editor/settings-store";
import { openQuickOpen, useEditorUi } from "@/components/room/editor/ui-store";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The right panel: what it shows now, how to switch it, and the toggles for the title bar. */
export type SidePanel = {
  panel: string | null;
  toggle: (id: string) => void;
  items: Array<{ id: string; label: string; icon: LucideIcon; badge?: number }>;
};

/**
 * `actions` sit before Call and Share (the workspace puts Run there). `side` adds the Chat and AI toggles; the avatars open People. What's used now and then
 * (presenting, forking, the theme) is under More, so the bar stays short.
 */
export function TitleBar({ actions, side }: { actions?: ReactNode; side?: SidePanel }) {
  const { room, me, mySlot, status } = useRoom();
  const chatUnread = useChatUnread(me.user.id, room.id).state?.count ?? 0;
  const peers = usePeers();
  // Go to file's key, as you've set it (keybindings.ts).
  const quickOpenKey = useEditorSettings((state) => keysFor("quick-open", state.keybindings)[0]);
  const presenting = useEditorUi((state) => state.presenting !== null);

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
              className="hidden min-h-6 rounded-sm px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:block"
            >
              {room.id}
            </button>
          </TooltipTrigger>
          <TooltipContent>Copy room code</TooltipContent>
        </Tooltip>
        <VisibilityMenu />
        {room.forkedFrom && (
          <Link
            href={`/rooms/${room.forkedFrom.id}` as never}
            className="hidden truncate text-xs text-muted-foreground hover:text-foreground lg:inline"
            title="The room this one was forked from"
          >
            forked from {room.forkedFrom.name}
          </Link>
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
          {quickOpenKey && <Kbd>{keyLabel(quickOpenKey)}</Kbd>}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
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
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        {side && (
          <div role="group" aria-label="Side panel" className="flex items-center gap-0.5">
            {side.items.map(({ id, label, icon: Icon, badge: suppliedBadge = 0 }) => {
              const badge = id === "chat" ? chatUnread : suppliedBadge;
              const badgeLabel = id === "chat" ? chatUnreadLabel(badge) : badge > 9 ? "9+" : String(badge);
              return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={side.panel === id ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={badge ? `${label}, ${badgeLabel} unread` : label}
                    aria-pressed={side.panel === id}
                    onClick={() => side.toggle(id)}
                    className="relative"
                  >
                    <Icon />
                    {badge > 0 && (
                      <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] leading-none font-semibold text-brand-foreground tabular-nums">
                        {badgeLabel}
                      </span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
              );
            })}
          </div>
        )}
        <div className="ml-1 flex items-center gap-1.5">
          {actions}
          <CallButton />
          {/* While presenting, it says so here, and stops in one click. */}
          {presenting && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" aria-pressed onClick={() => useEditorUi.getState().setPresenting(false)}>
                  <Presentation /> Presenting
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop presenting</TooltipContent>
            </Tooltip>
          )}
          <ShareMenu />
        </div>
        <MoreMenu presenting={presenting} />
        <NotificationsBell />
      </div>
    </header>
  );
}

/** Presenting, forking and the theme: used now and then, so one click further away. */
function MoreMenu({ presenting }: { presenting: boolean }) {
  const { room } = useRoom();
  const { resolvedTheme, setTheme } = useTheme();
  const [forking, setForking] = useState(false);
  // The menu gives focus back to its button when it closes, which would open the tooltip there and leave it over the buttons beside it (the
  // Automations tool's header, say) until the pointer came back: it waits for the pointer instead.
  const [tip, setTip] = useState(false);
  const [quiet, setQuiet] = useState(false);
  return (
    <>
      {/* Not modal: a modal menu hides the whole page from screen readers while its buttons can still take focus. */}
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (!open) setQuiet(true);
          setTip(false);
        }}
      >
        <Tooltip open={tip && !quiet} onOpenChange={setTip}>
          <TooltipTrigger asChild onPointerEnter={() => setQuiet(false)}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => useEditorUi.getState().setPresenting(!presenting)}>
            <Presentation /> {presenting ? "Stop presenting" : "Present"}
          </DropdownMenuItem>
          <p className="px-2 pb-1.5 pl-8 text-[11px] text-muted-foreground">Everyone in the room follows your file and scroll.</p>
          {room.kind !== "interview" && (
            <DropdownMenuItem onSelect={() => setForking(true)}>
              <GitFork /> Fork…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            <Sun className="hidden dark:block" />
            <Moon className="dark:hidden" />
            <span className="dark:hidden">Dark theme</span>
            <span className="hidden dark:inline">Light theme</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {room.kind !== "interview" && <ForkDialog open={forking} onOpenChange={setForking} />}
    </>
  );
}

/** Clicking the people in the room opens the People panel. Its owner sees here that someone's waiting, with the panel closed. */
function PeopleButton({ side, children }: { side?: SidePanel; children: ReactNode }) {
  const waiting = useRoomPeople().people?.waiting.length ?? 0;
  if (!side) return <>{children}</>;
  const title = waiting ? `${waiting} waiting to join` : "Who's here";
  return (
    <button
      type="button"
      title={title}
      aria-label={waiting ? title : undefined}
      aria-pressed={side.panel === "people"}
      onClick={() => side.toggle("people")}
      className={cn("relative rounded-full p-0.5 hover:bg-accent", side.panel === "people" && "bg-accent")}
    >
      {children}
      {waiting > 0 && (
        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[9px] leading-none font-semibold text-brand-foreground tabular-nums">
          {waiting > 9 ? "9+" : waiting}
        </span>
      )}
    </button>
  );
}
