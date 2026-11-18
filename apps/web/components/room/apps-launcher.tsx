/**
 * The room's apps, from one button at the foot of the activity bar's views, so the bar keeps to the code's own views and the apps a person uses most. Each app
 * says in a line what it's for, grouped (Write and plan, Data, Build and run, Check and improve), with a search; one is pinned to the bar from here. The panels
 * beside the code (AI, Notes, Activity…) are listed too, as they open on the right.
 */
"use client";

import { LayoutGrid, Pin, PinOff, Search } from "lucide-react";
import { useState } from "react";

import type { RoomTool } from "@/components/room/tools/registry";
import { APP_GROUPS } from "@/components/room/tools/registry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  apps: RoomTool[];
  sides: RoomTool[];
  /** The app in the editor's place now, if any. */
  activeId: string | null;
  pinned: readonly string[];
  /** Pinning is for the Code layout; Research has its own set. */
  canPin: boolean;
  onOpen: (id: string) => void;
  onOpenSide: (id: string) => void;
  onTogglePin: (id: string) => void;
};

export function AppsLauncher({ apps, sides, activeId, pinned, canPin, onOpen, onOpenSide, onTogglePin }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const matches = (tool: RoomTool) => !words || `${tool.label} ${tool.description} ${tool.group ?? ""}`.toLowerCase().includes(words);
  const groups = [...APP_GROUPS.map((name) => ({ name, tools: apps.filter((tool) => (tool.group ?? "Build and run") === name && matches(tool)) })), { name: "Beside the code", tools: sides.filter(matches) }].filter((group) => group.tools.length > 0);
  const choose = (run: () => void) => {
    setOpen(false);
    setQuery("");
    run();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Apps"
          title="Apps"
          aria-expanded={open}
          className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", open && "bg-accent text-foreground")}
        >
          <LayoutGrid className="size-[18px]" />
        </button>
      </PopoverTrigger>
      {/* An app or the editor taking focus as it loads shouldn't close it on someone who just opened it; clicking elsewhere still does. */}
      <PopoverContent side="right" align="start" sideOffset={8} onFocusOutside={(event) => event.preventDefault()} className="flex max-h-[min(680px,calc(100dvh-5rem))] w-[36rem] max-w-[calc(100vw-5rem)] flex-col gap-0 overflow-hidden p-0 text-xs">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label="Search apps"
            placeholder="Search apps"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div role="group" aria-label="Apps" className="grid min-h-0 gap-3 overflow-y-auto p-2">
          {groups.length === 0 && <p className="px-2 py-4 text-center text-muted-foreground">No app is called that.</p>}
          {groups.map((group) => (
            <section key={group.name} aria-label={group.name} className="grid grid-cols-2 gap-0.5">
              <h3 className="col-span-2 px-2 pb-1 text-[11px] font-medium text-muted-foreground">{group.name}</h3>
              {group.tools.map((tool) => {
                const side = group.name === "Beside the code";
                const isPinned = pinned.includes(tool.id);
                const descriptionId = `app-about-${tool.id}`;
                return (
                  <div key={tool.id} className={cn("group/app flex items-center rounded-md hover:bg-accent", activeId === tool.id && "bg-accent")}>
                    <button
                      type="button"
                      aria-label={tool.label}
                      aria-describedby={descriptionId}
                      aria-pressed={side ? undefined : activeId === tool.id}
                      onClick={() => choose(() => (side ? onOpenSide(tool.id) : onOpen(tool.id)))}
                      className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
                        <tool.icon className="size-4" />
                      </span>
                      <span className="grid min-w-0">
                        <span className="font-medium text-foreground">{tool.label}</span>
                        <span id={descriptionId} className="line-clamp-2 text-muted-foreground">
                          {tool.description}
                        </span>
                      </span>
                    </button>
                    {canPin && !side && (
                      <button
                        type="button"
                        aria-label={isPinned ? `Unpin ${tool.label} from the bar` : `Pin ${tool.label} to the bar`}
                        aria-pressed={isPinned}
                        title={isPinned ? "Unpin from the bar" : "Pin to the bar"}
                        onClick={() => onTogglePin(tool.id)}
                        className={cn(
                          "mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          isPinned ? "text-foreground" : "opacity-0 group-hover/app:opacity-100",
                        )}
                      >
                        {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        {canPin && <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Pin the ones you use most, and they stay in the bar.</p>}
      </PopoverContent>
    </Popover>
  );
}
