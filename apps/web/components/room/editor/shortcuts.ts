"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";

import { monaco } from "@/components/room/monaco-setup";

import { getActiveEditor } from "./active-editor";
import { formatDocument } from "./format";
import { chordStarts, eventKey, keyMap, whereOf, type KeyOverrides } from "./keybindings";
import { currentSettings, useEditorSettings } from "./settings-store";
import { openPalette, openShortcuts, useEditorUi } from "./ui-store";

/** Something a key can run. `run` returns false when it doesn't apply now (F10 with nothing paused), and the key goes on to the page. */
export type KeyCommand = { id: string; label: string; group: string; run: () => boolean | void };

/** The commands keys can run, by who registered them (the editor, the room, the debugger). */
const sources = new Map<string, KeyCommand[]>();

/** Register commands keys can run while this component is mounted; the list is refreshed every render. */
export function useKeyCommands(source: string, commands: KeyCommand[]) {
  useLayoutEffect(() => {
    sources.set(source, commands);
  });
  useLayoutEffect(() => () => void sources.delete(source), [source]);
}

/** A Monaco action of the open editor ("editor.action.commentLine"), as a command keys can run. */
function editorAction(id: string): KeyCommand | undefined {
  const editor = getActiveEditor();
  const action = editor?.getAction(id);
  if (!editor || !action) return undefined;
  return {
    id,
    label: action.label,
    group: "Editing",
    run: () => {
      editor.focus();
      void action.run();
    },
  };
}

export function findCommand(id: string): KeyCommand | undefined {
  for (const commands of sources.values()) {
    const found = commands.find((command) => command.id === id);
    if (found) return found;
  }
  return id.includes(".") ? editorAction(id) : undefined;
}

/** Every registered command once, for the shortcuts sheet. */
export function allKeyCommands(): KeyCommand[] {
  const seen = new Map<string, KeyCommand>();
  for (const commands of sources.values()) for (const command of commands) if (!seen.has(command.id)) seen.set(command.id, command);
  return [...seen.values()];
}

/** Run a command by id; false when there's none, or it didn't apply. */
export function runCommand(id: string): boolean {
  const command = findCommand(id);
  return Boolean(command) && command!.run() !== false;
}

let cached: { overrides: KeyOverrides; map: Map<string, string>; starts: Set<string> } | null = null;
function bindings() {
  const overrides = useEditorSettings.getState().keybindings;
  if (cached?.overrides !== overrides) {
    const map = keyMap(overrides);
    cached = { overrides, map, starts: chordStarts(map) };
  }
  return cached;
}

/** Set while the shortcuts sheet listens for a new key: the shortcuts don't run. */
let recording = false;
export const setKeyRecording = (on: boolean) => {
  recording = on;
};

/** How long the second key of a chord is waited for. */
const CHORD_MS = 1500;

/**
 * The keyboard shortcuts (keybindings.ts) at work: one listener on the window in the capture
 * phase (before Monaco, and before the browser's own Print and Save) runs the command a key
 * is bound to. In the code editor Monaco owns chords (its own Ctrl+K ones too), so ours are
 * registered on each editor (bindEditorChords) and the key after a chord's first is Monaco's.
 * Also the editor's commands that aren't in the palette: the palette itself, Save, zoom reset.
 */
export function useEditorShortcuts() {
  useKeyCommands("keys", [
    { id: "palette", label: "Show all commands", group: "Editor", run: () => openPalette() },
    { id: "shortcuts", label: "Keyboard shortcuts", group: "Editor", run: openShortcuts },
    {
      id: "save",
      label: "Save",
      group: "Editor",
      run: () => {
        // Everything saves as you type; Ctrl+S would otherwise open the browser's Save Page dialog.
        void (async () => {
          const formatted = currentSettings().formatOnSave && (await formatDocument({ quiet: true }));
          toast.message(formatted ? "Formatted. Changes sync as you type." : "Saved. Changes sync as you type.", { id: "saved" });
        })();
      },
    },
    { id: "zoom-reset", label: "Reset zoom", group: "Editor", run: () => useEditorSettings.getState().zoom("reset") },
  ]);

  const chord = useRef<{ first: string; inEditor: boolean; until: number } | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = recording ? null : eventKey(event);
      if (!key) return;
      const target = event.target as HTMLElement | null;
      const inMonaco = Boolean(target?.closest?.(".monaco-editor"));
      const inField =
        !inMonaco && Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
      const ownKey = Boolean(target?.closest?.(".xterm, [data-own-run-key]"));
      const allowed = (id: string) => {
        const where = whereOf(id);
        return where === "editor" ? inMonaco : where === "notInField" ? !inField : where === "notOwnKey" ? !ownKey : true;
      };
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const { map, starts } = bindings();
      const now = Date.now();

      const pending = chord.current;
      chord.current = null;
      if (pending && pending.until > now) {
        // Monaco is waiting for this one (and runs our chords itself).
        if (pending.inEditor) return;
        const id = map.get(`${pending.first} ${key}`);
        if (id && allowed(id) && runCommand(id)) return take();
      }
      if (starts.has(key) || (inMonaco && key === "Ctrl+K")) {
        if (inMonaco) {
          chord.current = { first: key, inEditor: true, until: now + CHORD_MS };
          return;
        }
        if (!inField) {
          take();
          chord.current = { first: key, inEditor: false, until: now + CHORD_MS };
          return;
        }
      }
      const id = map.get(key);
      if (id && allowed(id) && runCommand(id)) take();
    };

    // Esc leaves zen mode unless something else (a dialog, Monaco's find box) used it first.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && useEditorUi.getState().zen)
        useEditorUi.getState().setZen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keydown", onEscape);
    };
  }, []);
}

const MONACO_KEYS: Record<string, keyof typeof monaco.KeyCode> = {
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  Up: "UpArrow",
  Down: "DownArrow",
  Left: "LeftArrow",
  Right: "RightArrow",
};

/** One key press ("Ctrl+K") as Monaco writes it, or null for a key Monaco has no code for. */
function monacoPress(press: string): number | null {
  const parts = press.split("+");
  const name = parts.pop()!;
  const codeName = MONACO_KEYS[name] ?? (/^[A-Z]$/.test(name) ? `Key${name}` : /^\d$/.test(name) ? `Digit${name}` : name);
  const code = monaco.KeyCode[codeName as keyof typeof monaco.KeyCode];
  if (typeof code !== "number") return null;
  let mods = 0;
  if (parts.includes("Ctrl")) mods |= monaco.KeyMod.CtrlCmd;
  if (parts.includes("Shift")) mods |= monaco.KeyMod.Shift;
  if (parts.includes("Alt")) mods |= monaco.KeyMod.Alt;
  return mods | code;
}

/** Our chords in a code editor, kept up with your shortcuts: Monaco owns chords in there. */
export function bindEditorChords(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  let actions: monaco.IDisposable[] = [];
  const apply = (overrides: KeyOverrides) => {
    actions.forEach((action) => action.dispose());
    actions = [];
    for (const [key, id] of keyMap(overrides)) {
      const [first, second] = key.split(" ");
      if (!second) continue;
      const a = monacoPress(first!);
      const b = monacoPress(second);
      if (a === null || b === null) continue;
      actions.push(
        editor.addAction({
          id: `cc.chord.${key}`,
          label: findCommand(id)?.label ?? id,
          keybindings: [monaco.KeyMod.chord(a, b)],
          run: () => void runCommand(id),
        }),
      );
    }
  };
  apply(useEditorSettings.getState().keybindings);
  const stop = useEditorSettings.subscribe((state, before) => {
    if (state.keybindings !== before.keybindings) apply(state.keybindings);
  });
  return {
    dispose: () => {
      stop();
      actions.forEach((action) => action.dispose());
    },
  };
}
