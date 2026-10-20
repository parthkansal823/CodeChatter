"use client";

import { useEffect, useMemo, useState } from "react";

import { usePeers } from "@/components/room/hooks";
import { monaco } from "@/components/room/monaco-setup";
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

import { getActiveEditor } from "./active-editor";
import { formatDocument } from "./format";
import { PaletteDialog } from "./palette-dialog";
import { useEditorSettings } from "./settings-store";
import { previewKindOf, PREVIEW_LABEL } from "./preview-kind";
import { insertSnippet } from "./snippet-provider";
import { snippetsFor, type Snippet } from "./snippets";
import { getSymbols, type SymbolItem } from "./symbols";
import {
  openPalette,
  openQuickOpen,
  openSettings,
  toggleFilePreview,
  toggleSplit,
  toggleZen,
  useEditorUi,
  type PalettePage,
} from "./ui-store";

/** A command the room adds (Run, terminals, panels); the palette brings the editor's own. */
export type PaletteCommand = { id: string; label: string; shortcut?: string; run: () => void };

type ActiveFile = { id: string; name: string } | null;
type Props = {
  page: PalettePage;
  activeFile: ActiveFile;
  extra: PaletteCommand[];
  onCompare: () => void;
  onClose: () => void;
};

/** Ctrl+Shift+P: every command. Its other pages: go to a line (Ctrl+G), a symbol, a language mode, or a person to follow. */
export function CommandPalette({ page, activeFile, extra, onCompare, onClose }: Props) {
  if (page === "line") return <GoToLine onClose={onClose} />;
  if (page === "symbols") return <GoToSymbol onClose={onClose} />;
  if (page === "language") return <ChangeLanguage fileId={activeFile?.id ?? null} onClose={onClose} />;
  if (page === "people") return <FollowPerson onClose={onClose} />;
  if (page === "snippets") return <InsertSnippet onClose={onClose} />;
  return <Commands activeFile={activeFile} extra={extra} onCompare={onCompare} onClose={onClose} />;
}

const dialogProps = (onClose: () => void) => ({
  open: true,
  onOpenChange: (open: boolean) => !open && onClose(),
});

function Commands({ activeFile, extra, onCompare, onClose }: Omit<Props, "page">) {
  const settings = useEditorSettings();
  const preview = activeFile ? previewKindOf(activeFile.name) : null;
  const editorCommands: PaletteCommand[] = [
    { id: "quick-open", label: "Go to file…", shortcut: "Ctrl P", run: openQuickOpen },
    { id: "go-line", label: "Go to line…", shortcut: "Ctrl G", run: () => openPalette("line") },
    {
      id: "go-symbol",
      label: "Go to symbol in file…",
      shortcut: "Ctrl Shift O",
      run: () => openPalette("symbols"),
    },
    { id: "language", label: "Change language mode…", run: () => openPalette("language") },
    { id: "snippet", label: "Insert snippet…", run: () => openPalette("snippets") },
    { id: "format", label: "Format document", shortcut: "Shift Alt F", run: () => void formatDocument() },
    {
      id: "split",
      label: "Split editor",
      shortcut: "Ctrl \\",
      run: () => toggleSplit(activeFile?.id ?? null),
    },
    { id: "compare", label: "Compare with another file…", run: onCompare },
    ...(preview
      ? [
          {
            id: "preview-side",
            label: `Open ${PREVIEW_LABEL[preview]} to the side`,
            shortcut: "Ctrl K V",
            run: () => toggleFilePreview("side"),
          },
          {
            id: "preview-full",
            label: `Open ${PREVIEW_LABEL[preview]}`,
            shortcut: "Ctrl Shift V",
            run: () => toggleFilePreview("full"),
          },
        ]
      : []),
    { id: "zen", label: "Toggle Zen mode", shortcut: "Ctrl K Z", run: toggleZen },
    { id: "follow", label: "Follow someone…", run: () => openPalette("people") },
    {
      id: "vim",
      label: settings.keymap === "vim" ? "Turn Vim key bindings off" : "Turn Vim key bindings on",
      run: () => settings.update({ keymap: settings.keymap === "vim" ? "standard" : "vim" }),
    },
    {
      id: "wrap",
      label: settings.wordWrap ? "Turn word wrap off" : "Turn word wrap on",
      run: () => settings.update({ wordWrap: !settings.wordWrap }),
    },
    {
      id: "minimap",
      label: settings.minimap ? "Hide the minimap" : "Show the minimap",
      run: () => settings.update({ minimap: !settings.minimap }),
    },
    {
      id: "ai-suggestions",
      label: settings.aiCompletions ? "Turn AI suggestions off" : "Turn AI suggestions on",
      run: () => settings.update({ aiCompletions: !settings.aiCompletions }),
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      shortcut: "Ctrl =",
      run: () => settings.update({ fontSize: settings.fontSize + 1 }),
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      shortcut: "Ctrl -",
      run: () => settings.update({ fontSize: settings.fontSize - 1 }),
    },
    { id: "settings", label: "Open settings", shortcut: "Ctrl ,", run: openSettings },
  ];
  // Monaco's own actions (comment lines, fold, sort, change case…), as VS Code lists them.
  const builtIn = useMemo(() => {
    const editor = getActiveEditor();
    return (editor?.getSupportedActions() ?? [])
      .filter((action) => action.label)
      .map((action) => ({
        id: action.id,
        label: action.label,
        run: () => (editor?.focus(), void action.run()),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);
  const choose = (command: { run: () => void }) => {
    onClose();
    command.run();
  };

  return (
    <PaletteDialog {...dialogProps(onClose)} title="Command palette" description="Run a command by name">
      <CommandInput placeholder="Type a command" className="h-9 py-0" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No command matches.</CommandEmpty>
        {extra.length > 0 && (
          <CommandGroup heading="Room">
            {extra.map((command) => (
              <Row key={command.id} command={command} onChoose={choose} />
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Editor">
          {editorCommands.map((command) => (
            <Row key={command.id} command={command} onChoose={choose} />
          ))}
        </CommandGroup>
        {builtIn.length > 0 && (
          <CommandGroup heading="Editing">
            {builtIn.map((command) => (
              <Row key={command.id} command={command} onChoose={choose} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </PaletteDialog>
  );
}

function Row({
  command,
  onChoose,
}: {
  command: PaletteCommand;
  onChoose: (command: PaletteCommand) => void;
}) {
  return (
    <CommandItem
      value={`${command.label} ${command.id}`}
      onSelect={() => onChoose(command)}
      className="py-1.5"
    >
      {command.label}
      {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
    </CommandItem>
  );
}

/** Ctrl+G: a line, or line:column, in the editor you're in. */
function GoToLine({ onClose }: { onClose: () => void }) {
  const editor = getActiveEditor();
  const lines = editor?.getModel()?.getLineCount() ?? 0;
  const [value, setValue] = useState("");
  const [line = NaN, column = NaN] = value.split(/[:,]/).map((part) => Number.parseInt(part, 10));
  const valid = Number.isInteger(line) && line >= 1 && line <= lines;
  const go = () => {
    if (!editor || !valid) return;
    onClose();
    editor.setPosition({ lineNumber: line, column: Number.isInteger(column) && column > 0 ? column : 1 });
    editor.revealLineInCenter(line);
    editor.focus();
  };
  return (
    <PaletteDialog
      {...dialogProps(onClose)}
      title="Go to line"
      description="Type a line number"
      shouldFilter={false}
    >
      <CommandInput
        value={value}
        onValueChange={setValue}
        placeholder={lines ? `Line 1 to ${lines} (line:column works too)` : "Open a file first"}
        className="h-9 py-0"
      />
      <CommandList>
        <CommandItem value="go" disabled={!valid} onSelect={go} className="py-1.5">
          {valid
            ? `Go to line ${line}${Number.isInteger(column) ? `, column ${column}` : ""}`
            : lines
              ? `Type a line number from 1 to ${lines}`
              : "No file is open"}
        </CommandItem>
      </CommandList>
    </PaletteDialog>
  );
}

/** Functions, classes and other declarations in this file, outermost first. */
function GoToSymbol({ onClose }: { onClose: () => void }) {
  const editor = getActiveEditor();
  const [symbols, setSymbols] = useState<SymbolItem[] | null>(null);
  useEffect(() => {
    const model = editor?.getModel();
    if (!model) return;
    let live = true;
    void getSymbols(model).then((found) => live && setSymbols(found ?? []));
    return () => {
      live = false;
    };
  }, [editor]);
  const reveal = (symbol: SymbolItem) => {
    const model = editor?.getModel();
    if (!editor || !model) return;
    onClose();
    const start = model.getPositionAt(symbol.start);
    editor.setSelection(monaco.Selection.fromPositions(start, start));
    editor.revealLineInCenter(start.lineNumber);
    editor.focus();
  };
  return (
    <PaletteDialog
      {...dialogProps(onClose)}
      title="Go to symbol"
      description="Pick a declaration in this file"
    >
      <CommandInput placeholder="Symbol name" className="h-9 py-0" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>{symbols === null ? "Reading the file…" : "No symbols in this file."}</CommandEmpty>
        {(symbols ?? []).map((symbol, i) => (
          <CommandItem
            key={`${symbol.start}-${i}`}
            value={`${symbol.name} ${i}`}
            onSelect={() => reveal(symbol)}
            className="py-1.5"
          >
            <span style={{ paddingLeft: symbol.depth * 12 }}>{symbol.name}</span>
            <CommandShortcut>{symbol.kind}</CommandShortcut>
          </CommandItem>
        ))}
      </CommandList>
    </PaletteDialog>
  );
}

/** The snippets for this file's language: pick one to put it in at the cursor. */
function InsertSnippet({ onClose }: { onClose: () => void }) {
  const editor = getActiveEditor();
  const language = editor?.getModel()?.getLanguageId() ?? null;
  const list = language ? snippetsFor(language) : [];
  const pick = (snippet: Snippet) => {
    onClose();
    // After the dialog has handed focus back.
    if (editor) setTimeout(() => insertSnippet(editor, snippet), 0);
  };
  return (
    <PaletteDialog {...dialogProps(onClose)} title="Insert snippet" description="Pick a snippet for this file's language">
      <CommandInput placeholder={language ? "Snippet" : "Open a file first"} className="h-9 py-0" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>{language ? "No snippets for this language." : "No file is open."}</CommandEmpty>
        {list.map((snippet) => (
          <CommandItem key={snippet.prefix} value={`${snippet.prefix} ${snippet.label}`} onSelect={() => pick(snippet)} className="py-1.5">
            {snippet.label}
            <CommandShortcut>{snippet.prefix}</CommandShortcut>
          </CommandItem>
        ))}
      </CommandList>
    </PaletteDialog>
  );
}

/** The language this file is highlighted (and checked) as, until you leave the room. */
function ChangeLanguage({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const languages = useMemo(
    () =>
      monaco.languages
        .getLanguages()
        .map((language) => ({ id: language.id, name: language.aliases?.[0] ?? language.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const pick = (id: string) => {
    onClose();
    if (fileId) useEditorUi.getState().setLanguage(fileId, id);
  };
  return (
    <PaletteDialog
      {...dialogProps(onClose)}
      title="Change language mode"
      description="Pick how this file is highlighted"
    >
      <CommandInput placeholder={fileId ? "Language" : "Open a file first"} className="h-9 py-0" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No language matches.</CommandEmpty>
        {languages.map((language) => (
          <CommandItem
            key={language.id}
            value={`${language.name} ${language.id}`}
            onSelect={() => pick(language.id)}
            disabled={!fileId}
            className="py-1.5"
          >
            {language.name}
            <CommandShortcut>{language.id}</CommandShortcut>
          </CommandItem>
        ))}
      </CommandList>
    </PaletteDialog>
  );
}

/** Follow someone: their file opens for you as they move between files. */
function FollowPerson({ onClose }: { onClose: () => void }) {
  const peers = usePeers();
  const following = useEditorUi((state) => state.following);
  const pick = (userId: string | null) => {
    onClose();
    useEditorUi.getState().follow(userId);
  };
  return (
    <PaletteDialog
      {...dialogProps(onClose)}
      title="Follow someone"
      description="Their file opens for you as they move"
    >
      <CommandInput placeholder="Name" className="h-9 py-0" />
      <CommandList>
        <CommandEmpty>Nobody else is in the room.</CommandEmpty>
        {following && (
          <CommandItem value="stop following" onSelect={() => pick(null)} className="py-1.5">
            Stop following
          </CommandItem>
        )}
        {peers.map((peer) => (
          <CommandItem
            key={peer.user.id}
            value={peer.user.name}
            onSelect={() => pick(peer.user.id)}
            className="py-1.5"
          >
            {peer.user.name}
            {following === peer.user.id && <CommandShortcut>following</CommandShortcut>}
          </CommandItem>
        ))}
      </CommandList>
    </PaletteDialog>
  );
}
