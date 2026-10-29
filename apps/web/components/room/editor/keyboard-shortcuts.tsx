"use client";

import { IKeybindingService, StandaloneServices } from "@codingame/monaco-vscode-api";
import { Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

import { getActiveEditor } from "./active-editor";
import { assignKey, DEFAULT_KEYS, eventKey, keyLabel, keyMap, keysFor, removeKey, resetKeys } from "./keybindings";
import { useEditorSettings } from "./settings-store";
import { allKeyCommands, findCommand, setKeyRecording } from "./shortcuts";

const GROUPS = ["Room", "Editor", "Debug", "Editing"] as const;

type Row = { id: string; label: string; group: string; keys: string[]; changed: boolean; monacoKey?: string };

/** The open editor's own key for one of its actions, as Monaco shows it ("Ctrl+/"). */
function monacoKeyOf(id: string): string | undefined {
  try {
    return StandaloneServices.get(IKeybindingService).lookupKeybinding(id)?.getLabel() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The keyboard shortcuts sheet (Ctrl+K Ctrl+S): every command and its keys, searchable by
 * name or key. Add a key (press it, or a chord of two), take one away, or put a command's
 * defaults back; a key another command had moves here. Your keys follow your account (they
 * are editor settings). The open editor's own editing commands are listed with Monaco's key.
 */
export function KeyboardShortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80vh,720px)] flex-col gap-3 sm:max-w-2xl">
        {open && <Sheet />}
      </DialogContent>
    </Dialog>
  );
}

function Sheet() {
  const overrides = useEditorSettings((state) => state.keybindings);
  const update = useEditorSettings((state) => state.update);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);

  // Read once when the sheet opens: the commands registered now, and the open editor's actions.
  const commands = useMemo(() => {
    const listed = allKeyCommands();
    const ids = new Set(listed.map((command) => command.id));
    const editing = (getActiveEditor()?.getSupportedActions() ?? [])
      // Actions added to one editor are named "<editor id>:<id>" (ours, Ctrl+K Z's among them): only Monaco's own can be bound.
      .filter((action) => action.label && !action.id.includes(":") && !ids.has(action.id))
      .map((action) => ({ id: action.id, label: action.label, group: "Editing" }));
    return [...listed.map(({ id, label, group }) => ({ id, label, group })), ...editing];
  }, []);
  const monacoKeys = useMemo(() => new Map(commands.filter((c) => c.group === "Editing").map((c) => [c.id, monacoKeyOf(c.id)])), [commands]);

  const rows = useMemo((): Row[] => {
    const words = query.trim().toLowerCase();
    return commands
      .map((command) => {
        const keys = keysFor(command.id, overrides);
        return { ...command, keys, changed: command.id in overrides, monacoKey: monacoKeys.get(command.id) };
      })
      .filter((row) => {
        if (!words) return true;
        const text = [row.label, ...row.keys.map(keyLabel), row.monacoKey ?? ""].join(" ").toLowerCase();
        return words.split(/\s+/).every((word) => text.includes(word));
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [commands, monacoKeys, overrides, query]);

  const save = (id: string, key: string) => {
    const { overrides: next, takenFrom } = assignKey(id, key, useEditorSettings.getState().keybindings);
    update({ keybindings: next });
    setRecording(null);
    if (takenFrom) toast.message(`${keyLabel(key)} moved here from “${findCommand(takenFrom)?.label ?? takenFrom}”.`);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Every command and its keys. Your keys follow your account. Keys in the code editor that aren’t here are Monaco’s,
          as in VS Code.
        </DialogDescription>
      </DialogHeader>
      <Input
        aria-label="Search shortcuts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by command or key"
        className="h-8 text-xs"
        autoFocus
      />
      <div role="list" aria-label="Shortcuts" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {GROUPS.map((group) => {
          const inGroup = rows.filter((row) => row.group === group);
          if (!inGroup.length) return null;
          return (
            <section key={group} aria-label={group} className="mb-2">
              <h3 className="sticky top-0 bg-popover py-1 text-xs font-medium text-muted-foreground">{group}</h3>
              {inGroup.map((row) => (
                <ShortcutRow
                  key={row.id}
                  row={row}
                  recording={recording === row.id}
                  onRecord={() => setRecording(row.id)}
                  onCancel={() => setRecording(null)}
                  onSave={(key) => save(row.id, key)}
                  onRemove={(key) => update({ keybindings: removeKey(row.id, key, useEditorSettings.getState().keybindings) })}
                  onReset={() => update({ keybindings: resetKeys(row.id, useEditorSettings.getState().keybindings) })}
                />
              ))}
            </section>
          );
        })}
        {!rows.length && <p className="py-4 text-center text-xs text-muted-foreground">No command matches.</p>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          {Object.keys(overrides).length ? `${Object.keys(overrides).length} changed` : "All defaults"}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!Object.keys(overrides).length}
          onClick={() => {
            update({ keybindings: {} });
            toast.message("Every shortcut is back to its default.");
          }}
        >
          Reset all
        </Button>
      </div>
    </>
  );
}

function ShortcutRow({
  row,
  recording,
  onRecord,
  onCancel,
  onSave,
  onRemove,
  onReset,
}: {
  row: Row;
  recording: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onSave: (key: string) => void;
  onRemove: (key: string) => void;
  onReset: () => void;
}) {
  return (
    <div role="listitem" aria-label={row.label} className="group grid gap-1 rounded-sm px-1 py-1 hover:bg-accent/50">
      <div className="flex min-h-6 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs">{row.label}</span>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {row.monacoKey && (
            <Kbd title="The editor's own key" className="bg-transparent">
              {row.monacoKey}
            </Kbd>
          )}
          {row.keys.map((key) => (
            <span key={key} className="inline-flex items-center">
              <Kbd className="rounded-r-none">{keyLabel(key)}</Kbd>
              <button
                type="button"
                aria-label={`Remove ${keyLabel(key)} from ${row.label}`}
                onClick={() => onRemove(key)}
                className="inline-flex h-5 items-center rounded-r-sm bg-muted px-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            aria-label={`Add a key to ${row.label}`}
            onClick={onRecord}
            disabled={recording}
          >
            <Plus className="size-3.5" />
          </Button>
          {row.changed && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" aria-label={`Reset ${row.label}`} title="Its default keys back" onClick={onReset}>
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      {recording && <Recorder id={row.id} onCancel={onCancel} onSave={onSave} />}
    </div>
  );
}

/** Whether a first key press can be a shortcut: with Ctrl or Alt, or a function key (a plain letter is for typing). */
const usable = (press: string) => /(^|\+)(Ctrl|Alt)\+/.test(press) || /^(Shift\+)?F\d+$/.test(press);

/**
 * Press the keys: one, or a second for a chord (Ctrl+K, then Z). Enter keeps them and
 * Escape cancels (each on its own, without a modifier). While this listens, the
 * shortcuts don't run.
 */
function Recorder({ id, onCancel, onSave }: { id: string; onCancel: () => void; onSave: (key: string) => void }) {
  const [presses, setPresses] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const overrides = useEditorSettings((state) => state.keybindings);
  const binding = presses.join(" ");
  const owner = binding ? keyMap(overrides).get(binding) : undefined;
  const latest = useRef({ presses, onCancel, onSave });
  useEffect(() => {
    latest.current = { presses, onCancel, onSave };
  });

  useEffect(() => {
    setKeyRecording(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      const press = eventKey(event);
      if (!press) return;
      const { presses: current, onCancel: cancel, onSave: keep } = latest.current;
      if (press === "Escape") return cancel();
      if (press === "Enter" && current.length) return keep(current.join(" "));
      if (current.length === 0 && !usable(press)) {
        setProblem("Use Ctrl or Alt with it, or a function key: a plain key is for typing.");
        return;
      }
      setProblem(null);
      // A third press starts again.
      setPresses(current.length >= 2 ? [press] : [...current, press]);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      setKeyRecording(false);
    };
  }, []);

  return (
    <div role="group" aria-label="New key" className="grid gap-1.5 rounded-sm border border-dashed p-2 text-xs">
      <p aria-live="polite">
        {binding ? (
          <>
            <Kbd className="text-foreground">{keyLabel(binding)}</Kbd>
            {presses.length === 1 && <span className="ml-2 text-muted-foreground">Press another key for a chord, or Enter.</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Press the keys, then Enter. Escape cancels.</span>
        )}
      </p>
      {owner && owner !== id && (
        <p className="text-muted-foreground">
          Now “{findCommand(owner)?.label ?? owner}” has it: it moves here.
        </p>
      )}
      {owner === id && <p className="text-muted-foreground">This command has it already.</p>}
      {problem && <p className="text-destructive">{problem}</p>}
      {DEFAULT_KEYS[id]?.where === "editor" && <p className="text-muted-foreground">Works in the code editor.</p>}
      <div className="flex gap-2">
        <Button size="sm" className="h-6 text-xs" disabled={!binding} onClick={() => onSave(binding)}>
          Save
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
