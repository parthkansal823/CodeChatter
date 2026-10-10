"use client";

import { ChevronDown, ChevronLeft, Redo2, Undo2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PresenceAvatar } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useAtom, useEditor, useSession } from "./hooks";

/** A toolbar button with a tooltip naming it and its shortcut. */
export function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  disabled,
  size = "icon-sm",
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: "icon-sm" | "icon-xs";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size={size}
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && "text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Rename in place: click the name, type, Enter or click away to save, Escape to cancel. */
export function NameField({ name, editable, onRename, label }: { name: string; editable: boolean; onRename: (name: string) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!editable) return <span className="truncate text-sm font-medium">{name}</span>;
  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(name)}
        className="truncate rounded-sm px-1 text-sm font-medium hover:bg-accent"
        aria-label={`Rename ${label}`}
      >
        {name}
      </button>
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next.slice(0, 120));
    setDraft(null);
  };
  return (
    <input
      autoFocus
      aria-label={`${label} name`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      className="h-6 w-56 rounded-sm border border-input bg-background px-1.5 text-sm font-medium outline-none focus-visible:border-ring"
    />
  );
}

/**
 * Top bar of an open canvas: back to the list, the name, tools in the middle, actions on the
 * right. Three columns, so the tools stay put while the name changes width (renaming turns it
 * into a wider field and back): a toolbar that moves under the pointer loses the click.
 */
export function CanvasHeader({
  backLabel,
  onBack,
  name,
  children,
  actions,
  onClose,
}: {
  backLabel: string;
  onBack: () => void;
  name: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 border-b bg-chrome px-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="xs" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}>
          <ChevronLeft /> {backLabel}
        </Button>
        <span className="text-muted-foreground">/</span>
        <div className="flex min-w-0 items-center">{name}</div>
      </div>
      <div className="flex items-center gap-0.5">{children}</div>
      <div className="flex items-center justify-end gap-1.5">
        {actions}
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
    </header>
  );
}

/** The other people on this canvas, one avatar per person. */
export function PeerAvatars() {
  const session = useSession();
  const peers = useAtom(session.peers);
  const people = [...new Map(peers.map((p) => [p.user.id, p.user])).values()];
  if (people.length === 0) return null;
  return (
    <div className="flex items-center gap-1" aria-label={`${people.length} other ${people.length === 1 ? "person" : "people"} here`}>
      {people.slice(0, 4).map((user) => (
        <Tooltip key={user.id}>
          <TooltipTrigger asChild>
            <span>
              <PresenceAvatar name={user.name} image={user.image} slot={user.slot} size={22} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{user.name}</TooltipContent>
        </Tooltip>
      ))}
      {people.length > 4 && <span className="text-xs text-muted-foreground">+{people.length - 4}</span>}
    </div>
  );
}

export function HistoryButtons() {
  const editor = useEditor();
  const history = useAtom(editor.history);
  const readOnly = useAtom(editor.readOnly);
  if (readOnly) return null;
  return (
    <>
      <ToolButton label="Undo" shortcut="Ctrl Z" disabled={!history.canUndo} onClick={() => editor.undo()}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl Shift Z" disabled={!history.canRedo} onClick={() => editor.redo()}>
        <Redo2 />
      </ToolButton>
    </>
  );
}

export function ZoomMenu() {
  const editor = useEditor();
  const zoom = useAtom(editor.camera).zoom;
  const selection = useAtom(editor.selection);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`Zoom ${Math.round(zoom * 100)}%`} className="w-16 justify-between tabular-nums">
          {Math.round(zoom * 100)}% <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => editor.zoomBy(1.25)}>
          Zoom in <DropdownMenuShortcut>Ctrl +</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.zoomBy(0.8)}>
          Zoom out <DropdownMenuShortcut>Ctrl -</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => editor.zoomToFit()}>
          Zoom to fit <DropdownMenuShortcut>Shift 1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={selection.length === 0} onSelect={() => editor.zoomToFit(selection)}>
          Zoom to selection <DropdownMenuShortcut>Shift 2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => editor.zoomBy(1 / zoom)}>
          Zoom to 100% <DropdownMenuShortcut>Shift 0</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A shortcut hint for empty canvases: key, then what it does. */
export function ShortcutHint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-6">
      <span>{children}</span>
      <span className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </li>
  );
}

/** The centred note on an empty canvas. It never blocks drawing. */
export function EmptyCanvas({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border bg-background/90 p-4 text-sm">
        <p className="font-medium">{title}</p>
        <ul className="mt-3 grid gap-1.5 text-muted-foreground">{children}</ul>
      </div>
    </div>
  );
}
