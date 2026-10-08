"use client";

import type { TreeNode } from "@codechatter/workspace-model";

import { FilePicker } from "./file-picker";
import { SettingsDialog } from "./settings-dialog";
import { useEditorUi } from "./ui-store";

/** Whichever editor dialog is open: settings, Quick Open, or a file picker for another command. */
export function EditorOverlays({ openFile }: { openFile: (node: TreeNode) => void }) {
  const overlay = useEditorUi((state) => state.overlay);
  const close = useEditorUi((state) => state.close);
  const onOpenChange = (open: boolean) => !open && close();
  return (
    <>
      <SettingsDialog open={overlay?.kind === "settings"} onOpenChange={onOpenChange} />
      {overlay?.kind === "quickOpen" && <FilePicker open onOpenChange={onOpenChange} title="Open file" onPick={openFile} />}
      {overlay?.kind === "pickFile" && (
        <FilePicker open onOpenChange={onOpenChange} title={overlay.title} exclude={overlay.exclude} onPick={overlay.onPick} />
      )}
    </>
  );
}
