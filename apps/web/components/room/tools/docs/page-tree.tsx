"use client";

import { ChevronRight, FileText, MoreHorizontal, Plus } from "lucide-react";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Threads } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useDocs } from "./docs-context";
import { useDocsStore, useRoomDocsState } from "./docs-store";
import { CONTEXT_KIT, DROPDOWN_KIT, NewPageMenu, PageActions } from "./page-menus";
import { movePage, siblingsOf, titleOf, trashPage, updatePage, type PageNode, type PageRecord } from "./pages-model";

const DRAG_TYPE = "text/cc-page";

type DropAt = { id: string; at: "before" | "inside" | "after" } | null;

/** Where a drop at this height of the row lands: the top and bottom quarters reorder, the middle nests. */
function dropPosition(event: DragEvent<HTMLElement>): "before" | "inside" | "after" {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = (event.clientY - rect.top) / rect.height;
  return y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
}

/** Arrow keys move between rows of every tree in the sidebar. */
function focusRow(from: HTMLElement, step: 1 | -1) {
  const rows = [...(from.closest("[data-docs-nav]")?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? [])];
  rows[rows.indexOf(from) + step]?.focus();
}

/** A tree of pages with drag to reorder or nest, rename in place and a menu per row. */
export function PageTree({ nodes, label, empty }: { nodes: PageNode[]; label: string; empty?: string }) {
  const docs = useDocs();
  const { expanded } = useRoomDocsState(docs.roomId);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt>(null);

  const drop = (draggedId: string, target: PageRecord, at: "before" | "inside" | "after") => {
    setDropAt(null);
    if (!draggedId || draggedId === target.id) return;
    let moved: boolean;
    if (at === "inside") {
      moved = movePage(docs.indexDoc, draggedId, target.id);
      if (moved) useDocsStore.getState().setExpanded(docs.roomId, target.id, true);
    } else {
      const parentId = target.parentId && docs.byId.has(target.parentId) ? target.parentId : null;
      const siblings = siblingsOf(docs.pages, parentId, docs.byId).filter((p) => p.id !== draggedId);
      const index = siblings.findIndex((p) => p.id === target.id);
      const [before, after] = at === "before" ? [siblings[index - 1], target] : [target, siblings[index + 1]];
      const order = before && after ? (before.order + after.order) / 2 : before ? before.order + 1 : after ? after.order - 1 : 1;
      moved = movePage(docs.indexDoc, draggedId, parentId, order);
    }
    if (!moved) toast.error("A page can't be moved inside itself.");
  };

  return (
    <div role="tree" aria-label={label} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropAt(null)}>
      {nodes.map((node) => (
        <PageRow
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          renaming={renaming}
          setRenaming={setRenaming}
          dropAt={dropAt}
          setDropAt={setDropAt}
          onDrop={drop}
        />
      ))}
      {nodes.length === 0 && empty && <p className="px-3 py-1 text-xs text-muted-foreground">{empty}</p>}
    </div>
  );
}

type RowProps = {
  node: PageNode;
  depth: number;
  expanded: string[];
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  dropAt: DropAt;
  setDropAt: (drop: DropAt) => void;
  onDrop: (draggedId: string, target: PageRecord, at: "before" | "inside" | "after") => void;
};

function PageRow(props: RowProps) {
  const { node, depth, expanded, renaming, setRenaming, dropAt, setDropAt, onDrop } = props;
  const docs = useDocs();
  const setExpanded = useDocsStore((state) => state.setExpanded);
  const hasChildren = node.children.length > 0;
  const open = hasChildren && expanded.includes(node.id);
  const active = node.id === docs.currentId && docs.view === "page";
  const drop = dropAt?.id === node.id ? dropAt.at : null;
  const toggle = (value = !open) => setExpanded(docs.roomId, node.id, value);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") docs.openPage(node.id);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "ArrowRight" && hasChildren) {
      if (open) focusRow(event.currentTarget, 1);
      else toggle(true);
    } else if (event.key === "ArrowLeft") {
      if (open) toggle(false);
      else event.currentTarget.parentElement?.closest<HTMLElement>("[role=group]")?.previousElementSibling?.querySelector<HTMLElement>("[role=treeitem]")?.focus();
    } else if (docs.editable && event.key === "F2") setRenaming(node.id);
    else if (docs.editable && event.key === "Delete") trashPage(docs.indexDoc, node.id);
  };

  const row = (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={active}
      tabIndex={0}
      draggable={docs.editable && renaming !== node.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!docs.editable || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        const at = dropPosition(e);
        if (drop !== at) setDropAt({ id: node.id, at });
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e.dataTransfer.getData(DRAG_TYPE), node, dropPosition(e));
      }}
      onDragEnd={() => setDropAt(null)}
      onClick={() => docs.openPage(node.id)}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative flex h-7 cursor-pointer items-center gap-1 pr-1 text-sm select-none hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
        drop === "inside" && "bg-brand-muted",
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-thread bg-brand" />}
      {drop === "before" && <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-brand" />}
      {drop === "after" && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />}
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? `Collapse ${titleOf(node)}` : `Expand ${titleOf(node)}`}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm hover:bg-background"
        >
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")} />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      {node.icon ? (
        <span aria-hidden className="w-4 shrink-0 text-center text-sm leading-none">
          {node.icon}
        </span>
      ) : (
        <FileText aria-hidden className="size-3.5 shrink-0" />
      )}
      {renaming === node.id ? (
        <InlineTitle
          initial={node.title}
          onDone={(title) => {
            if (title !== null) updatePage(docs.indexDoc, node.id, { title });
            setRenaming(null);
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{titleOf(node)}</span>
      )}
      <Threads slots={docs.slotsOn(node.id)} className="h-3.5" />
      {docs.editable && renaming !== node.id && (
        <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <NewPageMenu parentId={node.id}>
            <Button variant="ghost" size="icon-xs" aria-label={`New page inside ${titleOf(node)}`} onClick={(e) => e.stopPropagation()}>
              <Plus />
            </Button>
          </NewPageMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`More actions for ${titleOf(node)}`} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
              <PageActions kit={DROPDOWN_KIT} page={node} onRename={() => setRenaming(node.id)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          <PageActions kit={CONTEXT_KIT} page={node} onRename={() => setRenaming(node.id)} />
        </ContextMenuContent>
      </ContextMenu>
      {open && (
        <div role="group">
          {node.children.map((child) => (
            <PageRow key={child.id} {...props} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

/** Enter or blur saves, Escape cancels. */
function InlineTitle({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const finish = () => onDone(value !== initial ? value.trim() : null);
  return (
    <input
      autoFocus
      aria-label="Rename page"
      value={value}
      placeholder="Untitled"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish();
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={finish}
      className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-sm text-foreground outline-none"
    />
  );
}
