"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Threads, type PresenceSlot } from "@/components/presence/presence";
import { cn } from "@/lib/utils";

export function TabBar({
  tabs,
  activeId,
  threadsFor,
  onSelect,
  onClose,
  actions,
}: {
  actions?: ReactNode;
  tabs: TreeNode[];
  activeId: string | null;
  threadsFor: (id: string) => PresenceSlot[];
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex h-9 shrink-0 border-b bg-chrome">
    <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={tab.path}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(tab.id)}
            className={cn(
              "group relative flex max-w-52 shrink-0 cursor-pointer items-center gap-2 border-r pr-1.5 pl-3 text-sm select-none",
              active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-brand" />}
            <span className="truncate">{tab.name}</span>
            <Threads slots={threadsFor(tab.id)} className="h-3" />
            <button
              type="button"
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={cn(
                "rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground",
                !active && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-1 border-l px-1.5">{actions}</div>}
    </div>
  );
}
