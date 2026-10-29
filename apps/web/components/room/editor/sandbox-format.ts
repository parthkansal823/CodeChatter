"use client";

import { toast } from "sonner";

import type { TreeNode } from "@codechatter/workspace-model";
import { FormattingConflicts } from "@codingame/monaco-vscode-api/vscode/vs/editor/contrib/format/browser/format";

import { monaco } from "@/components/room/monaco-setup";
import { api, ApiError } from "@/lib/api";

import { modelOwner } from "./file-models";
import { lineEdits } from "./line-edits";

/** Languages formatted in the room's sandbox (apps/runner/src/format.ts); the browser formats the web ones itself, unless the project uses Prettier. */
export const SANDBOX_FORMATTED = ["python", "c", "cpp", "shell", "go", "rust", "java"] as const;
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
 * Go, Rust and Java: the file's text goes to its formatter in the sandbox, and comes back as
 * small edits (one per changed run of lines), so others' cursors in untouched lines stay put.
 */
export function registerSandboxFormatters(): void {
  if (registered) return;
  registered = true;
  for (const language of SANDBOX_FORMATTED) {
    monaco.languages.registerDocumentFormattingEditProvider(language, sandboxFormatter(language, "Room sandbox"));
  }
}

/** Monaco's languages Prettier formats, for a project with a Prettier config. */
const PRETTIER_LANGUAGES = ["javascript", "typescript", "css", "scss", "less", "json", "html", "markdown", "yaml", "graphql", "vue"];
/** Prettier's config files (package.json's "prettier" key isn't looked for). */
const PRETTIER_CONFIG = /^(\.prettierrc(\.(json|json5|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/;
const PRETTIER_NAME = "The project's Prettier";
let prettier: monaco.IDisposable[] = [];

/** Whether the room's files have a Prettier config, at any depth. */
export function hasPrettierConfig(tree: TreeNode[]): boolean {
  return tree.some((node) => (node.kind === "file" ? PRETTIER_CONFIG.test(node.name) : hasPrettierConfig(node.children)));
}

/**
 * With a Prettier config in the room, its JavaScript, TypeScript, CSS, JSON, HTML, Markdown
 * and YAML format with the project's own Prettier (its node_modules, in the sandbox) and its
 * settings, in place of the browser's formatter. With two formatters for a file, VS Code's
 * own choice asks which should be the default and formats nothing; while Prettier is on, a
 * choice of ours (asked first, as the newest) takes Prettier's, or the only one there is.
 */
export function setPrettier(on: boolean): void {
  if (on === prettier.length > 0) return;
  for (const registration of prettier) registration.dispose();
  prettier = on
    ? [
        ...PRETTIER_LANGUAGES.map((language) =>
          monaco.languages.registerDocumentFormattingEditProvider(language, sandboxFormatter("prettier", PRETTIER_NAME)),
        ),
        FormattingConflicts.setFormatterSelector(async (formatters) =>
          formatters.find((formatter) => formatter.displayName === PRETTIER_NAME) ?? (formatters.length === 1 ? formatters[0] : undefined),
        ),
      ]
    : [];
}

/** A formatter that sends the file to the sandbox's `formatter` (format.ts) and applies what comes back. */
function sandboxFormatter(formatter: string, displayName: string): monaco.languages.DocumentFormattingEditProvider {
  return {
    displayName,
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
          json: { path, language: formatter, text, tabSize: options.tabSize, insertSpaces: options.insertSpaces },
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
  };
}
