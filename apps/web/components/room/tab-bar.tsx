"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Threads, type PresenceSlot } from "@/components/presence/presence";
import { getActiveEditor } from "@/components/room/editor/active-editor";
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
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            aria-keyshortcuts="Delete"
            tabIndex={active ? 0 : -1}
            title={tab.path}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
            onKeyDown={(e) => {
              if (e.key === "Delete") return onClose(tab.id);
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(tab.id);
                // The arrows only look; Enter goes into the file, as it does in other editors.
                requestAnimationFrame(() => getActiveEditor()?.focus());
                return;
              }
              const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[e.key];
              if (to === undefined) return;
              e.preventDefault();
              const next = (to + tabs.length) % tabs.length;
              onSelect(tabs[next]!.id);
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
            }}
            className={cn(
              "group relative flex max-w-52 shrink-0 cursor-pointer items-center gap-2 border-r pr-1.5 pl-3 text-sm select-none",
              active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-brand" />}
            <span className="truncate">{tab.name}</span>
            <Threads slots={threadsFor(tab.id)} className="h-3" />
            {/* For the mouse. A tab can't hold a control, so the keyboard and screen readers close it with Delete. */}
            <span
              aria-hidden
              title="Close (Delete)"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className={cn(
                "grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                !active && "opacity-0 group-hover:opacity-100",
              )}
            >
              <X className="size-3.5" />
            </span>
          </div>
        );
      })}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-1 border-l px-1.5">{actions}</div>}
    </div>
  );
}
