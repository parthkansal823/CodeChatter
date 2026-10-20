"use client";

import {
  registerFileSystemOverlay,
  RegisteredFileSystemProvider,
  RegisteredReadOnlyFile,
} from "@codingame/monaco-vscode-files-service-override";
import { textOf, type TreeNode } from "@codechatter/workspace-model";
import type * as Y from "yjs";

import { monaco } from "@/components/room/monaco-setup";

const encoder = new TextEncoder();
let provider: RegisteredFileSystemProvider | null = null;
const registered = new Map<string, { id: string; dispose: () => void }>();

/**
 * Every file of the open room, readable by VS Code's services at file:///workspace/<path>
 * with its live text from the room. Go to definition into a file nobody has open reads
 * it from here (open files have their own, higher-priority copy: monaco-setup.ts).
 * Read-only: edits always go through the editor and Yjs.
 */
export function mirrorRoomFiles(doc: Y.Doc, files: TreeNode[]): void {
  if (!provider) {
    provider = new RegisteredFileSystemProvider(true);
    registerFileSystemOverlay(0, provider);
  }
  const wanted = new Map(files.filter((n) => n.kind === "file").map((n) => [uriFor(n.path), n]));
  for (const [uri, entry] of registered) {
    if (wanted.get(uri)?.id !== entry.id) {
      entry.dispose();
      registered.delete(uri);
    }
  }
  for (const [uri, node] of wanted) {
    if (registered.has(uri)) continue;
    const read = async () => encoder.encode(textOf(doc, node.id)?.toString() ?? "");
    const handle = provider.registerFile(new RegisteredReadOnlyFile(monaco.Uri.parse(uri), read, textOf(doc, node.id)?.length ?? 0));
    registered.set(uri, { id: node.id, dispose: () => handle.dispose() });
  }
}

/** Leaving the room: its files go from the editor's view of the disk. */
export function clearRoomFiles(): void {
  for (const entry of registered.values()) entry.dispose();
  registered.clear();
}

const uriFor = (path: string) => `file:///workspace/${path.split("/").map(encodeURIComponent).join("/")}`;
