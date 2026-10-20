"use client";

import { toast } from "sonner";

import { monaco } from "@/components/room/monaco-setup";
import { api, ApiError } from "@/lib/api";

import { modelOwner } from "./file-models";
import { lineEdits } from "./line-edits";

/** Languages formatted in the room's sandbox (apps/runner/src/format.ts); the browser formats the web ones itself. */
export const SANDBOX_FORMATTED = ["python", "c", "cpp", "shell", "go", "rust"] as const;
/** Biggest file sent to be formatted (the API takes JSON bodies up to 1 MB). */
const MAX_CHARS = 512 * 1024;

let room: string | null = null;
let registered = false;

/** The room whose sandbox formats files; the workspace sets it while a room is open. */
export function setFormatRoom(roomId: string | null): void {
  room = roomId;
}

/**
 * Format document (Shift+Alt+F, and on save when that's on) for Python, C, C++, shell,
 * Go and Rust: the file's text goes to its formatter in the sandbox, and comes back as
 * small edits (one per changed run of lines), so others' cursors in untouched lines stay put.
 */
export function registerSandboxFormatters(): void {
  if (registered) return;
  registered = true;
  for (const language of SANDBOX_FORMATTED) {
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      displayName: "Room sandbox",
      async provideDocumentFormattingEdits(model, options, token) {
        const roomId = room;
        const owner = modelOwner(model);
        if (!roomId || !owner) return [];
        const text = model.getValue();
        if (text.length > MAX_CHARS) {
          toast.message("This file is too big to format (over 512 KB).");
          return [];
        }
        const path = decodeURIComponent(model.uri.path.replace(/^\/workspace\//, ""));
        try {
          const result = await api<{ text: string }>(`/api/rooms/${roomId}/format`, {
            method: "POST",
            json: { path, language, text, tabSize: options.tabSize, insertSpaces: options.insertSpaces },
          });
          // Someone typed meanwhile: the result is for text that's gone.
          if (token.isCancellationRequested || model.isDisposed() || model.getValue() !== text) return [];
          return lineEdits(text, result.text).map((edit) => ({
            range: monaco.Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end)),
            text: edit.text,
          }));
        } catch (error) {
          toast.error(error instanceof ApiError ? `Couldn't format: ${error.detail}` : "Couldn't format: the sandbox didn't answer.");
          return [];
        }
      },
    });
  }
}
