"use client";

import { ChevronDown, ChevronRight, Copy, Folder, FolderOpen, FolderPlus, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";

import { Threads } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

import { methodLabel, methodTone } from "./format";
import { createFolder, createRequest, duplicateRequest, moveNode, renameNode, requestsIn, type TreeItem } from "./model";
import { useStudio } from "./studio-context";

type Row = { item: TreeItem; depth: number };

function flatten(items: TreeItem[], collapsed: ReadonlySet<string>, depth = 0): Row[] {
  return items.flatMap((item) => [{ item, depth }, ...(item.kind === "folder" && !collapsed.has(item.id) ? flatten(item.children, collapsed, depth + 1) : [])]);
}

/** After a request is created, put the cursor in its URL field. */
export function focusUrlSoon() {
  setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Request URL"]')?.focus(), 30);
}

export function CollectionsTree() {
  const { doc, tree, selectedId, select, canEdit, peers, openDialog } = useStudio();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  const rows = flatten(tree, collapsed);
  const stop = selectedId && rows.some((r) => r.item.id === selectedId) ? selectedId : rows[0]?.item.id;

  const expand = (id: string | null) => {
    if (!id || !collapsed.has(id)) return;
    const next = new Set(collapsed);
    next.delete(id);
    setCollapsed(next);
  };
  const toggleFolder = (id: string) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
  };

  const addRequest = (parentId: string | null) => {
    expand(parentId);
    select(createRequest(doc, { name: "New request", parentId }));
    focusUrlSoon();
  };
  const addFolder = (parentId: string | null) => {
    expand(parentId);
    const id = createFolder(doc, "New folder", parentId);
    setRenaming(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: Row) => {
    const items = [...event.currentTarget.closest('[role="tree"]')!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const at = items.indexOf(event.currentTarget);
    const { item } = row;
    const focus = (el: HTMLElement | undefined) => {
      event.preventDefault();
      el?.focus();
    };
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case "ArrowDown":
        return focus(items[at + 1]);
      case "ArrowUp":
        return focus(items[at - 1]);
      case "Home":
        return focus(items[0]);
      case "End":
        return focus(items.at(-1));
      case "ArrowRight":
        if (item.kind === "folder") {
          event.preventDefault();
          if (collapsed.has(item.id)) toggleFolder(item.id);
          else focus(items[at + 1]);
        }
        return;
      case "ArrowLeft":
        if (item.kind === "folder" && !collapsed.has(item.id)) {
          event.preventDefault();
          toggleFolder(item.id);
        } else if (item.parentId) focus(items.find((el) => el.dataset.id === item.parentId));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (item.kind === "folder") toggleFolder(item.id);
        else select(item.id);
        return;
      case "F2":
        if (canEdit) {
          event.preventDefault();
          setRenaming(item.id);
        }
        return;
      case "Delete":
        if (canEdit) {
          event.preventDefault();
          openDialog({ kind: "delete", id: item.id });
        }
    }
  };

  const onDrop = (event: DragEvent, folderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const id = event.dataTransfer.getData("text/plain");
    if (id && canEdit) moveNode(doc, id, folderId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-0.5 px-2">
        <span className="mr-auto text-xs text-muted-foreground">Requests and folders</span>
        {canEdit && (
          <>
            <Button size="icon-xs" variant="ghost" aria-label="New request" title="New request" onClick={() => addRequest(null)}>
              <Plus />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label="New folder" title="New folder" onClick={() => addFolder(null)}>
              <FolderPlus />
            </Button>
          </>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Run all requests" title="Run all requests" disabled={requestsIn(tree).length === 0} onClick={() => openDialog({ kind: "run", folderId: null })}>
          <Play />
        </Button>
      </div>
      <div
        role="tree"
        aria-label="Requests"
        className={cn("min-h-0 flex-1 overflow-y-auto pb-2", dropTarget === "root" && "bg-accent/50")}
        onDragOver={(event) => {
          if (!canEdit) return;
          event.preventDefault();
          setDropTarget("root");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => onDrop(event, null)}
      >
        {rows.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nothing here yet.</p>}
        {rows.map((row) => {
          const { item, depth } = row;
          const selected = item.id === selectedId;
          const folder = item.kind === "folder";
          const open = folder && !collapsed.has(item.id);
          const slots = peers.filter((p) => p.requestId === item.id).map((p) => p.user.slot);
          return (
            <ContextMenu key={item.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="treeitem"
                  data-id={item.id}
                  aria-level={depth + 1}
                  aria-selected={selected}
                  aria-expanded={folder ? open : undefined}
                  tabIndex={item.id === stop ? 0 : -1}
                  draggable={canEdit && renaming !== item.id}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)}
                  onDragOver={(event) => {
                    if (!folder || !canEdit) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget(item.id);
                  }}
                  onDrop={(event) => folder && onDrop(event, item.id)}
                  onKeyDown={(event) => onKeyDown(event, row)}
                  onClick={() => (folder ? toggleFolder(item.id) : select(item.id))}
                  className={cn(
                    "group relative flex h-row cursor-default items-center gap-1.5 pr-2 text-sm outline-offset-[-2px] hover:bg-accent",
                    selected && "bg-accent text-foreground",
                    dropTarget === item.id && "bg-accent ring-1 ring-brand ring-inset",
                  )}
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  {slots.length > 0 && <Threads slots={slots} className="absolute inset-y-0 left-0" />}
                  {folder ? (
                    <>
                      {open ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                      {open ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    </>
                  ) : (
                    <span className={cn("w-8 shrink-0 text-right font-mono text-2xs font-semibold", methodTone(item.method))}>{methodLabel(item.method, item.protocol)}</span>
                  )}
                  {renaming === item.id ? (
                    <input
                      autoFocus
                      defaultValue={item.name}
                      aria-label="Name"
                      maxLength={120}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setRenaming(null);
                      }}
                      onBlur={(event) => {
                        if (event.target.value.trim() && event.target.value !== item.name) renameNode(doc, item.id, event.target.value);
                        setRenaming(null);
                      }}
                      className="h-5 min-w-0 flex-1 rounded-sm border bg-background px-1 text-sm outline-none"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {folder && canEdit && (
                  <>
                    <ContextMenuItem onSelect={() => addRequest(item.id)}>
                      <Plus /> New request
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => addFolder(item.id)}>
                      <FolderPlus /> New folder
                    </ContextMenuItem>
                  </>
                )}
                {folder && (
                  <ContextMenuItem disabled={requestsIn(item.children).length === 0} onSelect={() => openDialog({ kind: "run", folderId: item.id })}>
                    <Play /> Run folder
                  </ContextMenuItem>
                )}
                {canEdit && (
                  <>
                    {folder && <ContextMenuSeparator />}
                    <ContextMenuItem onSelect={() => setRenaming(item.id)}>
                      <Pencil /> Rename
                    </ContextMenuItem>
                    {!folder && (
                      <ContextMenuItem
                        onSelect={() => {
                          const copy = duplicateRequest(doc, item.id);
                          if (copy) select(copy);
                        }}
                      >
                        <Copy /> Duplicate
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => openDialog({ kind: "delete", id: item.id })}>
                      <Trash2 /> Delete
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
