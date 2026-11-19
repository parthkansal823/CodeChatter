"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Circle,
  ComponentIcon,
  Eye,
  EyeOff,
  Frame,
  Group,
  ImageIcon,
  Lock,
  LockOpen,
  Minus,
  MoveUpRight,
  Pencil,
  Square,
  StickyNote,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Atom } from "./atom";
import type { Editor, LayerDrop } from "./editor";
import { useAtom, useAtomSelector, useChildIds, useEditor, useIsSelected, useShape } from "./hooks";
import { TYPE_LABEL, type ShapeType } from "./shape";
import { effectiveHidden, effectiveLocked, effectiveParent, isContainer } from "./tree";

const ICONS: Record<ShapeType, LucideIcon> = {
  frame: Frame,
  group: Group,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  arrow: MoveUpRight,
  text: Type,
  path: Pencil,
  image: ImageIcon,
  sticky: StickyNote,
  instance: ComponentIcon,
};

/**
 * Panel-local UI state as atoms, so a row re-renders only when its own
 * answer changes (collapsed, being renamed, being dropped on), not when
 * any row's does.
 */
class LayersState {
  readonly collapsed = new Atom<ReadonlySet<string>>(new Set());
  readonly renaming = new Atom<string | null>(null);
  readonly drop = new Atom<{ id: string; where: LayerDrop } | null>(null);
  /** What a drag in progress carries (dataTransfer can't be read until the drop). */
  dragIds: string[] = [];

  startDrag(ids: string[]) {
    this.dragIds = ids;
  }

  toggle(id: string) {
    const next = new Set(this.collapsed.get());
    if (!next.delete(id)) next.add(id);
    this.collapsed.set(next);
  }
}

function dropZone(event: DragEvent<HTMLElement>, container: boolean): LayerDrop {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = (event.clientY - rect.top) / Math.max(1, rect.height);
  if (container && y > 0.25 && y < 0.75) return "inside";
  // The list is drawn top-most first, so the upper half of a row is "above" it in the stack too.
  return y < 0.5 ? "above" : "below";
}

/** Layers: every shape by frame or group, top of the stack first. */
export function LayersPanel() {
  const editor = useEditor();
  const [state] = useState(() => new LayersState());
  const readOnly = useAtom(editor.readOnly);
  const top = useChildIds(editor, null);
  return (
    <aside aria-label="Layers" className="flex w-56 shrink-0 flex-col border-r bg-panel">
      <div className="flex h-9 shrink-0 items-center border-b px-3">
        <h2 className="text-xs font-medium">Layers</h2>
      </div>
      {top.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {readOnly ? "Nothing on this canvas yet." : "Shapes you draw appear here."}
        </p>
      )}
      <div
        role="tree"
        aria-label="Layers"
        aria-multiselectable
        className="min-h-0 flex-1 overflow-y-auto pb-6"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) state.drop.set(null);
        }}
      >
        {top.length > 0 && <LayerList parentId={null} depth={0} state={state} />}
      </div>
    </aside>
  );
}

function LayerList({ parentId, depth, state }: { parentId: string | null; depth: number; state: LayersState }) {
  const editor = useEditor();
  const ids = useChildIds(editor, parentId);
  return (
    <div role={parentId ? "group" : undefined}>
      {[...ids].reverse().map((id) => (
        <LayerRow key={id} id={id} depth={depth} state={state} />
      ))}
    </div>
  );
}

function focusSibling(event: KeyboardEvent<HTMLElement>, step: 1 | -1) {
  const tree = event.currentTarget.closest('[role="tree"]');
  const items = [...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
  items[items.indexOf(event.currentTarget) + step]?.focus();
}

/** A primitive snapshot keeps unrelated child edits from re-rendering every layer row. */
function useInheritedFlags(editor: Editor, id: string): number {
  "use no memo";
  const get = () => {
    const all = editor.store.all();
    const parent = effectiveParent(all, id);
    return parent ? Number(effectiveLocked(all, parent)) + 2 * Number(effectiveHidden(all, parent)) : 0;
  };
  return useSyncExternalStore(editor.store.subscribeAny, get, get);
}

function LayerRow({ id, depth, state }: { id: string; depth: number; state: LayersState }) {
  const editor = useEditor();
  const shape = useShape(editor, id);
  const selected = useIsSelected(editor, id);
  const readOnly = useAtom(editor.readOnly);
  const inherited = useInheritedFlags(editor, id);
  const parentLocked = Boolean(inherited & 1);
  const parentHidden = Boolean(inherited & 2);
  const collapsed = useAtomSelector(state.collapsed, (set) => set.has(id));
  const renaming = useAtomSelector(state.renaming, (current) => current === id);
  const dropHere = useAtomSelector(state.drop, (drop) => (drop?.id === id ? drop.where : null));
  if (!shape) return null;
  const Icon = ICONS[shape.type];
  const container = isContainer(shape);
  const locked = shape.locked || parentLocked;
  const hidden = shape.hidden || parentHidden;
  const name = shape.name || TYPE_LABEL[shape.type];

  const select = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) editor.toggleSelected(id);
    else editor.select([id]);
  };

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-level={depth + 1}
        aria-expanded={container ? !collapsed : undefined}
        aria-label={name}
        tabIndex={0}
        draggable={!readOnly && !locked && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/cc-layer", id);
          e.dataTransfer.effectAllowed = "move";
          state.startDrag(selected ? [...editor.selection.get()] : [id]);
        }}
        onDragEnd={() => state.drop.set(null)}
        onDragOver={(e) => {
          if (readOnly || !e.dataTransfer.types.includes("text/cc-layer")) return;
          e.preventDefault();
          e.stopPropagation();
          const where = dropZone(e, container);
          const current = state.drop.get();
          if (current?.id !== id || current.where !== where) state.drop.set({ id, where });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const where = dropZone(e, container);
          state.drop.set(null);
          editor.moveInLayers(state.dragIds, id, where);
        }}
        onClick={select}
        onDoubleClick={() => !readOnly && !locked && state.renaming.set(id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") select(e);
          else if (e.key === "F2" && !readOnly && !locked) state.renaming.set(id);
          else if (e.key === "ArrowDown") (e.preventDefault(), focusSibling(e, 1));
          else if (e.key === "ArrowUp") (e.preventDefault(), focusSibling(e, -1));
          else if (e.key === "ArrowRight" && container && collapsed) state.toggle(id);
          else if (e.key === "ArrowLeft" && container && !collapsed) state.toggle(id);
        }}
        className={cn(
          "group relative flex h-6 cursor-default items-center gap-1 pr-1 text-sm select-none hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
          selected ? "bg-accent text-foreground" : "text-muted-foreground",
          hidden && "opacity-50",
          dropHere === "inside" && "bg-brand-muted",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-thread bg-brand" />}
        {dropHere === "above" && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-brand" />}
        {dropHere === "below" && <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-brand" />}
        {container ? (
          <button
            type="button"
            aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              state.toggle(id);
            }}
            className="grid size-4 shrink-0 place-items-center rounded-sm hover:bg-secondary"
          >
            <ChevronRight className={cn("size-3 transition-transform duration-150", !collapsed && "rotate-90")} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <Icon className="size-3.5 shrink-0" />
        {renaming ? (
          <input
            autoFocus
            aria-label="Layer name"
            defaultValue={name}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              const next = e.target.value.trim();
              state.renaming.set(null);
              if (next && next !== shape.name) editor.update(id, { name: next.slice(0, 120) });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = name;
                e.currentTarget.blur();
              }
            }}
            className="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{name}</span>
        )}
        {!readOnly && !locked && !renaming && (
          <span className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <RowButton label={`Bring ${name} forward`} onClick={() => editor.reorder([id], "forward")}>
              <ArrowUp />
            </RowButton>
            <RowButton label={`Send ${name} backward`} onClick={() => editor.reorder([id], "backward")}>
              <ArrowDown />
            </RowButton>
          </span>
        )}
        {!readOnly && (
          <>
            <RowButton
              label={parentLocked ? "Locked by parent" : shape.locked ? `Unlock ${name}` : `Lock ${name}`}
              disabled={parentLocked}
              onClick={() => editor.update(id, { locked: !shape.locked })}
              className={cn(!locked && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}
            >
              {locked ? <Lock /> : <LockOpen />}
            </RowButton>
            <RowButton
              label={parentHidden ? "Hidden by parent" : shape.hidden ? `Show ${name}` : `Hide ${name}`}
              disabled={parentHidden}
              onClick={() => editor.update(id, { hidden: !shape.hidden })}
              className={cn(!hidden && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100")}
            >
              {hidden ? <EyeOff /> : <Eye />}
            </RowButton>
          </>
        )}
      </div>
      {container && !collapsed && <LayerList parentId={id} depth={depth + 1} state={state} />}
    </>
  );
}

function RowButton({ label, onClick, className, children, disabled = false }: { label: string; onClick: () => void; className?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      disabled={disabled}
      tabIndex={-1}
      className={cn("size-5 [&_svg:not([class*='size-'])]:size-3", className)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}
