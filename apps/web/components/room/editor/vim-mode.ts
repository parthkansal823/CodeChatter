"use client";

import { toast } from "sonner";

import type { monaco } from "@/components/room/monaco-setup";

import { formatDocument } from "./format";
import { currentSettings } from "./settings-store";

type VimApi = { defineEx(name: string, prefix: string, run: () => void): void };
let commandsDefined = false;

/**
 * Vim key bindings on one editor (Settings, Key bindings): modes, motions, operators,
 * registers and : commands, with the mode and the command line shown in `status`.
 * Loaded only for people who turn it on. Returns what turns it off again.
 */
export async function attachVim(editor: monaco.editor.IStandaloneCodeEditor, status: HTMLElement): Promise<() => void> {
  const { initVimMode, VimMode } = await import("monaco-vim");
  if (!commandsDefined) {
    commandsDefined = true;
    const vim = (VimMode as unknown as { Vim: VimApi }).Vim;
    // Everything saves as you type: :w does what Ctrl+S does (formats, when that's on).
    vim.defineEx("write", "w", () => {
      void (async () => {
        const formatted = currentSettings().formatOnSave && (await formatDocument({ quiet: true }));
        toast.message(formatted ? "Formatted. Changes sync as you type." : "Saved. Changes sync as you type.", { id: "saved" });
      })();
    });
  }
  const adapter = initVimMode(editor, status);
  return () => adapter.dispose();
}
