"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { Eye, Settings2 } from "lucide-react";
import type { ComponentProps } from "react";

import { getActiveEditor, useEditorInfo } from "@/components/room/editor/active-editor";
import { languageLabel } from "@/components/room/editor/languages";
import { TAB_SIZES } from "@/components/room/editor/settings";
import { openPalette, openSettings } from "@/components/room/editor/ui-store";
import { usePeers } from "@/components/room/hooks";
import { useRoom } from "@/components/room/room-context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const STATUS = {
  connected: { label: "Live", dot: "bg-success" },
  connecting: { label: "Connecting…", dot: "bg-warning animate-pulse" },
  offline: { label: "Offline, changes kept locally", dot: "bg-destructive" },
} as const;

const ROLE = { owner: "Owner", editor: "Editor", runner: "Can run", viewer: "Viewer", interviewer: "Interviewer", candidate: "Candidate" } as const;

export function StatusBar({ file }: { file: TreeNode | null }) {
  const { status, room, can } = useRoom();
  const peers = usePeers();
  const info = useEditorInfo((state) => state.info);
  const s = STATUS[status];
  const show = file && info;
  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-4 border-t bg-chrome px-3 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5" role="status">
        <span className={cn("size-1.5 rounded-full", s.dot)} />
        {s.label}
      </span>
      <span>{ROLE[room.role]}</span>
      {!can("files.edit") && (
        <span className="flex items-center gap-1">
          <Eye className="size-3" /> Read only
        </span>
      )}
      <span>{peers.length === 0 ? "Only you" : `${peers.length + 1} people`}</span>
      <div className="ml-auto flex h-full items-center">
        {show && (
          <>
            <span className="px-1.5">
              Ln {info.line}, Col {info.column}
            </span>
            {info.selected > 0 && <span className="px-1.5">{info.selected} selected</span>}
            {info.cursors > 1 && <span className="px-1.5">{info.cursors} cursors</span>}
            <IndentMenu insertSpaces={info.insertSpaces} tabSize={info.tabSize} />
            <span className="px-1.5" title="Line endings">
              {info.eol}
            </span>
            <StatusButton title="Change language mode" onClick={() => openPalette("language")}>
              {languageLabel(info.language)}
            </StatusButton>
          </>
        )}
        <span className="px-1.5">UTF-8</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <StatusButton aria-label="Editor settings" onClick={openSettings}>
              <Settings2 className="size-3.5" />
            </StatusButton>
          </TooltipTrigger>
          <TooltipContent>Editor settings</TooltipContent>
        </Tooltip>
      </div>
    </footer>
  );
}

function StatusButton({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={cn("flex h-full items-center px-1.5 hover:bg-accent hover:text-foreground", className)} {...props} />;
}

/** "Spaces: 2": indentation of the open file only (the saved default is in editor settings). */
function IndentMenu({ insertSpaces, tabSize }: { insertSpaces: boolean; tabSize: number }) {
  const apply = (options: { insertSpaces?: boolean; tabSize?: number }) => getActiveEditor()?.getModel()?.updateOptions(options);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <StatusButton title="Change indentation">
          {insertSpaces ? "Spaces" : "Tabs"}: {tabSize}
        </StatusButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Indent with</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={insertSpaces ? "spaces" : "tabs"} onValueChange={(v) => apply({ insertSpaces: v === "spaces" })}>
          <DropdownMenuRadioItem value="spaces">Spaces</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="tabs">Tabs</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Width</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(tabSize)} onValueChange={(v) => apply({ tabSize: Number(v) })}>
          {TAB_SIZES.map((n) => (
            <DropdownMenuRadioItem key={n} value={String(n)}>
              {n} columns
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
