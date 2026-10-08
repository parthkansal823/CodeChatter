"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { FileText } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { useRecentFiles } from "@/components/room/editor-store";
import { useRoom } from "@/components/room/room-context";
import { CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { rankFiles } from "./fuzzy";
import { PaletteDialog } from "./palette-dialog";
import { dirOf, useRoomFiles } from "./room-files";

/** Recent files shown ahead of the rest while nothing is typed. */
const RECENT_SHOWN = 8;

/**
 * Pick one of the room's files: fuzzy search over paths, recently opened first.
 * Quick Open uses it, and so does Compare files and the split editor's file switcher.
 */
export function FilePicker({
  open,
  onOpenChange,
  title,
  exclude = null,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A file id to leave out (the one you are comparing against). */
  exclude?: string | null;
  onPick: (file: TreeNode) => void;
}) {
  const { room } = useRoom();
  const files = useRoomFiles();
  const recent = useRecentFiles(room.id);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const ranked = useMemo(
    () =>
      rankFiles(
        files.filter((file) => file.id !== exclude),
        deferred,
        recent,
      ),
    [files, exclude, deferred, recent],
  );

  const pick = (file: TreeNode) => {
    onOpenChange(false);
    onPick(file);
  };
  const row = (entry: (typeof ranked)[number]) => (
    <CommandItem key={entry.file.id} value={entry.file.id} onSelect={() => pick(entry.file)}>
      <FileText />
      <Highlighted text={entry.file.name} indices={entry.indices} offset={entry.file.path.length - entry.file.name.length} />
      <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{dirOf(entry.file.path)}</span>
    </CommandItem>
  );

  // With nothing typed, the files you opened lately come first under their own heading.
  const showRecent = !deferred.trim();
  const recentRows = showRecent ? ranked.filter((entry) => recent.includes(entry.file.id)).slice(0, RECENT_SHOWN) : [];
  const shownAsRecent = new Set(recentRows.map((entry) => entry.file.id));

  return (
    <PaletteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Type part of a file name or path, then press Enter"
      shouldFilter={false}
      loop
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder={`${title}, by name or path`} className="h-9 py-0" />
      <CommandList className="max-h-80">
        <CommandEmpty>No file matches that.</CommandEmpty>
        {recentRows.length > 0 && <CommandGroup heading="Recently opened">{recentRows.map(row)}</CommandGroup>}
        {ranked.length > recentRows.length && (
          <CommandGroup heading={showRecent ? "All files" : "Files"}>{ranked.filter((entry) => !shownAsRecent.has(entry.file.id)).map(row)}</CommandGroup>
        )}
      </CommandList>
    </PaletteDialog>
  );
}

/** `text` with the characters at `indices` (positions in the full path, minus `offset`) in bold. */
function Highlighted({ text, indices, offset }: { text: string; indices: number[]; offset: number }) {
  const marked = new Set(indices.map((i) => i - offset));
  return (
    <span className="truncate">
      {[...text].map((char, i) =>
        marked.has(i) ? (
          <span key={i} className="font-semibold text-foreground">
            {char}
          </span>
        ) : (
          char
        ),
      )}
    </span>
  );
}
