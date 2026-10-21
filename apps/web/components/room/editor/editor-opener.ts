"use client";

import { monaco } from "@/components/room/monaco-setup";

import type { RevealRange } from "./reveal";

type Opener = (path: string, range: RevealRange) => boolean;

let open: Opener | null = null;
let registered = false;

/** What opens a room file at a place: the workspace sets it while a room is open. */
export function setEditorOpener(opener: Opener | null): void {
  open = opener;
}

/** Open a room file at a place (the Problems tab, say); false when it isn't one. */
export function openRoomFile(path: string, range: RevealRange): boolean {
  return open?.(path, range) ?? false;
}

type Selection = { startLineNumber: number; startColumn: number; endLineNumber?: number; endColumn?: number };

/**
 * The same, for VS Code's editor service (the language client's go to definition goes
 * there): it has read the file (workspace-fs.ts) and asks for an editor to show it in.
 * The room opens its tab instead, so there's no editor to hand back.
 */
export async function openFromWorkbench(
  // Only what's used, so the workbench's own (internal) model and URI types fit.
  modelRef: { object: { textEditorModel: { uri: { scheme: string; path: string } } | null }; dispose(): void },
  options: object | undefined,
): Promise<undefined> {
  const uri = modelRef.object.textEditorModel?.uri;
  modelRef.dispose();
  if (!uri || uri.scheme !== "file" || !uri.path.startsWith("/workspace/") || !open) return undefined;
  // Typed as editor options in general; a text editor's carry where to put the cursor.
  const at = (options as { selection?: Selection } | undefined)?.selection;
  const line = at?.startLineNumber ?? 1;
  const column = at?.startColumn ?? 1;
  open(decodeURIComponent(uri.path.slice("/workspace/".length)), { startLine: line, startColumn: column, endLine: line, endColumn: column });
  return undefined;
}

/**
 * Go to definition (F12), references and the like into another file of the room: Monaco
 * asks to open file:///workspace/<path> at a position, and the room opens that file's
 * tab and puts the cursor there, as clicking it in the explorer would.
 */
export function registerEditorOpenerOnce(): void {
  if (registered) return;
  registered = true;
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== "file" || !resource.path.startsWith("/workspace/") || !open) return false;
      const path = decodeURIComponent(resource.path.slice("/workspace/".length));
      const at = selectionOrPosition;
      const range: RevealRange = !at
        ? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 }
        : "startLineNumber" in at
          ? { startLine: at.startLineNumber, startColumn: at.startColumn, endLine: at.startLineNumber, endColumn: at.startColumn }
          : { startLine: at.lineNumber, startColumn: at.column, endLine: at.lineNumber, endColumn: at.column };
      return open(path, range);
    },
  });
}
