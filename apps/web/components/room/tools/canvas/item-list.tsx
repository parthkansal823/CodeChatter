"use client";

import { MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";

import { createItem, nextName, renameItem, restoreItem, trashItem } from "./list";
import type { LiveDoc } from "./live-doc";
import { useListItems } from "./use-canvas";

type Noun = { one: string; many: string; untitled: string };

/**
 * The room's designs or whiteboards: open, create, rename, trash and
 * restore. The list is one shared document, so everyone sees changes live.
 */
export function ItemList({
  live,
  noun,
  icon: Icon,
  description,
  editable,
  userId,
  onOpen,
  onClose,
}: {
  live: LiveDoc | null;
  noun: Noun;
  icon: LucideIcon;
  description: string;
  editable: boolean;
  userId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const items = useListItems(live);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const active = items.filter((item) => !item.trashedAt);
  const trashed = items.filter((item) => item.trashedAt);

  const create = () => {
    if (!live) return;
    onOpen(createItem(live.doc, nextName(active, noun.untitled), userId));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-chrome px-3">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{noun.many}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {editable && (
            <Button size="sm" onClick={create} disabled={!live?.synced}>
              <Plus /> New {noun.one}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!live?.synced ? (
          <div className="grid gap-2 p-4" aria-label={`Loading ${noun.many.toLowerCase()}`}>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : active.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center">
            <Icon className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No {noun.many.toLowerCase()} yet</p>
            <p className="text-sm text-muted-foreground">{description}</p>
            {editable ? (
              <Button size="sm" onClick={create}>
                <Plus /> New {noun.one}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Editors can create one, and it will show up here.</p>
            )}
          </div>
        ) : (
          <ul aria-label={noun.many} className="divide-y border-b">
            {active.map((item) => (
              <li key={item.id} className="group flex h-11 items-center gap-2 px-3 hover:bg-accent/60">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                {renaming === item.id ? (
                  <input
                    autoFocus
                    aria-label={`${noun.one} name`}
                    defaultValue={item.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && live) renameItem(live.doc, item.id, name.slice(0, 120));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
                  />
                ) : (
                  <button type="button" onClick={() => onOpen(item.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">
                    {item.name}
                  </button>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">{item.createdAt ? `Created ${formatRelativeTime(new Date(item.createdAt))}` : ""}</span>
                {editable && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${item.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setRenaming(item.id)}>
                        <Pencil /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          if (!live) return;
                          trashItem(live.doc, item.id);
                          toast(`Moved "${item.name}" to the trash`, { action: { label: "Undo", onClick: () => restoreItem(live.doc, item.id) } });
                        }}
                      >
                        <Trash2 /> Move to trash
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
        {live?.synced && trashed.length > 0 && (
          <div className="px-3 py-3">
            <Button variant="ghost" size="xs" onClick={() => setShowTrash((v) => !v)} aria-expanded={showTrash}>
              <Trash2 /> Trash ({trashed.length})
            </Button>
            {showTrash && (
              <ul aria-label="Trash" className="mt-1">
                {trashed.map((item) => (
                  <li key={item.id} className="flex h-9 items-center gap-2 px-2 text-sm text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {editable && (
                      <Button variant="ghost" size="xs" onClick={() => live && restoreItem(live.doc, item.id)}>
                        <RotateCcw /> Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
