"use client";

import type { TreeNode } from "@codechatter/workspace-model";

import { CommandPalette, useEditorCommands, type PaletteCommand } from "./command-palette";
import { FilePicker } from "./file-picker";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { SettingsDialog } from "./settings-dialog";
import { useKeyCommands } from "./shortcuts";
import { useEditorUi } from "./ui-store";

type Props = {
  openFile: (node: TreeNode) => void;
  activeFile: TreeNode | null;
  /** The room's own commands (Run, terminals, panels, apps) for the command palette. */
  commands: PaletteCommand[];
};

/**
 * Whichever editor dialog is open: the command palette, settings, keyboard shortcuts, Quick
 * Open, or a file picker for another command. The palette's commands are keys' commands too.
 */
export function EditorOverlays({ openFile, activeFile, commands }: Props) {
  const overlay = useEditorUi((state) => state.overlay);
  const close = useEditorUi((state) => state.close);
  const onOpenChange = (open: boolean) => !open && close();

  // Compare with…: pick the other file, then the two open side by side.
  const compare = () => {
    if (!activeFile) return;
    const ui = useEditorUi.getState();
    ui.open({
      kind: "pickFile",
      title: "Compare with",
      exclude: activeFile.id,
      onPick: (file) => ui.setDiff({ leftId: activeFile.id, rightId: file.id }),
    });
  };
  const editorCommands = useEditorCommands(activeFile, compare);
  useKeyCommands("editor", editorCommands.map((command) => ({ ...command, group: "Editor" })));
  useKeyCommands("room", commands.map((command) => ({ ...command, group: "Room" })));

  return (
    <>
      <SettingsDialog open={overlay?.kind === "settings"} onOpenChange={onOpenChange} />
      <KeyboardShortcuts open={overlay?.kind === "shortcuts"} onOpenChange={onOpenChange} />
      {overlay?.kind === "palette" && (
        <CommandPalette
          page={overlay.page}
          activeFile={activeFile}
          editor={editorCommands}
          extra={commands}
          onClose={close}
        />
      )}
      {overlay?.kind === "quickOpen" && (
        <FilePicker open onOpenChange={onOpenChange} title="Open file" onPick={openFile} />
      )}
      {overlay?.kind === "pickFile" && (
        <FilePicker
          open
          onOpenChange={onOpenChange}
          title={overlay.title}
          exclude={overlay.exclude}
          onPick={overlay.onPick}
        />
      )}
    </>
  );
}
