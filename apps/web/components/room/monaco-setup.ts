"use client";
/* eslint-disable no-restricted-syntax -- Monaco themes only accept hex colours.
   Every value here mirrors a token in app/globals.css (see the comments). */

import {
  registerFileSystemOverlay,
  RegisteredFileSystemProvider,
  RegisteredMemoryFile,
} from "@codingame/monaco-vscode-files-service-override";
import { emmetCSS, emmetHTML } from "emmet-monaco-es";
import * as monaco from "monaco-editor";
import "@codingame/monaco-vscode-standalone-languages";
import { typescriptDefaults } from "@codingame/monaco-vscode-standalone-typescript-language-features";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";

import { openFromWorkbench, registerEditorOpenerOnce } from "@/components/room/editor/editor-opener";
import { registerInlineCompletions } from "@/components/room/editor/inline-completions";
import { registerSandboxFormatters } from "@/components/room/editor/sandbox-format";
import { registerSnippets } from "@/components/room/editor/snippet-provider";

export { monaco };

let ready: Promise<void> | null = null;
let workspaceFiles: RegisteredFileSystemProvider | null = null;

/**
 * Make an open file readable at its file:///workspace URI. The VS Code
 * services behind Monaco read the resource when an editor opens it and
 * throw "Unable to resolve nonexistent file" otherwise. This is an
 * in-memory mirror only: the Yjs document stays the source of truth.
 */
export function registerWorkspaceFile(uri: monaco.Uri, content: string): { dispose(): void } {
  if (!workspaceFiles) {
    workspaceFiles = new RegisteredFileSystemProvider(false);
    registerFileSystemOverlay(1, workspaceFiles);
  }
  return workspaceFiles.registerFile(new RegisteredMemoryFile(uri, content));
}

/**
 * The VS Code services can start only once per page (ADR 0001). Workers use
 * MonacoEnvironment.getWorker with the global Worker constructor — the form
 * Turbopack bundles (spike S1b).
 */
export function ensureMonaco(): Promise<void> {
  ready ??= (async () => {
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_moduleId: string, label: string) {
        if (label === "typescript" || label === "javascript") {
          return new Worker(new URL("@codingame/monaco-vscode-standalone-typescript-language-features/worker", import.meta.url), {
            type: "module",
          });
        }
        return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
          type: "module",
        });
      },
    };
    await new MonacoVscodeApiWrapper({
      $type: "classic",
      // Another file's definition (the language client) opens as the room's own tab.
      viewsConfig: { $type: "EditorService", openEditorFunc: openFromWorkbench },
      monacoWorkerFactory: () => {},
    }).start();

    typescriptDefaults.setCompilerOptions({
      target: 99,
      module: 99,
      moduleResolution: 2, // NodeJs: the only non-classic mode this Monaco build types
      jsx: 4,
      strict: true,
      allowJs: true,
      allowNonTsExtensions: true,
    });
    defineThemes();
    registerInlineCompletions();
    registerSnippets();
    registerSandboxFormatters();
    // Emmet abbreviations (ul>li*3, .card>h2+p) among the completions of HTML and CSS.
    emmetHTML(monaco, ["html"]);
    emmetCSS(monaco, ["css", "scss", "less"]);
    registerEditorOpenerOnce();
    // VS Code's own code leaves a cancelled wait unhandled now and then (Tab accepting an inline
    // suggestion cancels one). VS Code ignores its CancellationError ("Canceled"); so do we.
    // Every other unhandled rejection still reaches the console.
    window.addEventListener("unhandledrejection", (event) => {
      const reason: unknown = event.reason;
      if (reason instanceof Error && reason.name === "Canceled" && reason.message === "Canceled") event.preventDefault();
    });
  })();
  return ready;
}

function defineThemes() {
  // Monochrome syntax: structure through weight and tone, orange only for
  // literals worth noticing — the same language as the landing preview.
  monaco.editor.defineTheme("cc-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "0a0a0a" },
      { token: "comment", foreground: "8a8a8a", fontStyle: "italic" },
      { token: "keyword", foreground: "6b6b6b" }, // --muted-foreground
      { token: "string", foreground: "4a4a4a" },
      { token: "number", foreground: "e8540f" }, // --brand (darker for white)
      { token: "type", foreground: "0a0a0a", fontStyle: "italic" },
      { token: "type.identifier", foreground: "0a0a0a", fontStyle: "italic" },
      { token: "delimiter", foreground: "6b6b6b" },
    ],
    colors: {
      "editor.background": "#ffffff", // --background
      "editor.foreground": "#0a0a0a", // --foreground
      "editorLineNumber.foreground": "#b5b5b5",
      "editorLineNumber.activeForeground": "#0a0a0a",
      "editor.lineHighlightBackground": "#f7f7f7", // --chrome
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#ff5e1a", // --brand (you)
      "editor.selectionBackground": "#ff5e1a33",
      "editor.inactiveSelectionBackground": "#ff5e1a1f",
      "editorIndentGuide.background1": "#ececec",
      "editorWhitespace.foreground": "#dcdcdc",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e8e8e8", // --border
      // Suggestions, hovers and lists: dark text on light, matches in orange. Without the
      // foregrounds, VS Code's white-on-blue text shows white on our grey.
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "#e8e8e8",
      "editorSuggestWidget.foreground": "#0a0a0a",
      "editorSuggestWidget.selectedBackground": "#f2f2f2",
      "editorSuggestWidget.selectedForeground": "#0a0a0a",
      "editorSuggestWidget.selectedIconForeground": "#0a0a0a",
      "editorSuggestWidget.highlightForeground": "#e8540f",
      "editorSuggestWidget.focusHighlightForeground": "#e8540f",
      "editorHoverWidget.background": "#ffffff",
      "editorHoverWidget.border": "#e8e8e8",
      "editorHoverWidget.foreground": "#0a0a0a",
      "list.activeSelectionBackground": "#f2f2f2",
      "list.activeSelectionForeground": "#0a0a0a",
      "list.activeSelectionIconForeground": "#0a0a0a",
      "list.inactiveSelectionBackground": "#f2f2f2",
      "list.inactiveSelectionForeground": "#0a0a0a",
      "list.focusBackground": "#f2f2f2",
      "list.focusForeground": "#0a0a0a",
      "list.hoverBackground": "#f7f7f7",
      "list.hoverForeground": "#0a0a0a",
      "list.highlightForeground": "#e8540f",
      "list.focusHighlightForeground": "#e8540f",
      "quickInputList.focusBackground": "#f2f2f2",
      "quickInputList.focusForeground": "#0a0a0a",
      "scrollbarSlider.background": "#0000001a",
      "scrollbarSlider.hoverBackground": "#00000030",
      // Bracket pairs stay in the palette: orange, ink and grey in turn.
      "editorBracketHighlight.foreground1": "#e8540f", // --brand
      "editorBracketHighlight.foreground2": "#0a0a0a",
      "editorBracketHighlight.foreground3": "#6b6b6b",
      "editorBracketHighlight.foreground4": "#e8540f",
      "editorBracketHighlight.foreground5": "#0a0a0a",
      "editorBracketHighlight.foreground6": "#6b6b6b",
      "editorBracketPairGuide.background1": "#0000001a",
      "editorBracketPairGuide.background2": "#0000001a",
      "editorBracketPairGuide.background3": "#0000001a",
      "editorBracketPairGuide.background4": "#0000001a",
      "editorBracketPairGuide.background5": "#0000001a",
      "editorBracketPairGuide.background6": "#0000001a",
      "editorBracketPairGuide.activeBackground1": "#e8540f99",
      "editorBracketPairGuide.activeBackground2": "#0a0a0a99",
      "editorBracketPairGuide.activeBackground3": "#6b6b6b99",
      "editorBracketPairGuide.activeBackground4": "#e8540f99",
      "editorBracketPairGuide.activeBackground5": "#0a0a0a99",
      "editorBracketPairGuide.activeBackground6": "#6b6b6b99",
    },
  });
  monaco.editor.defineTheme("cc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "f5f5f5" },
      { token: "comment", foreground: "6e6e6e", fontStyle: "italic" },
      { token: "keyword", foreground: "a3a3a3" }, // --muted-foreground
      { token: "string", foreground: "c9c9c9" },
      { token: "number", foreground: "ff7a33" }, // --brand (dark)
      { token: "type", foreground: "f5f5f5", fontStyle: "italic" },
      { token: "type.identifier", foreground: "f5f5f5", fontStyle: "italic" },
      { token: "delimiter", foreground: "8a8a8a" },
    ],
    colors: {
      "editor.background": "#000000", // --background (true black)
      "editor.foreground": "#f5f5f5",
      "editorLineNumber.foreground": "#4a4a4a",
      "editorLineNumber.activeForeground": "#f5f5f5",
      "editor.lineHighlightBackground": "#0a0a0a", // --panel
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#ff7a33",
      "editor.selectionBackground": "#ff7a3340",
      "editor.inactiveSelectionBackground": "#ff7a3326",
      "editorIndentGuide.background1": "#1a1a1a",
      "editorWhitespace.foreground": "#2a2a2a",
      "editorWidget.background": "#161616", // --popover
      "editorWidget.border": "#ffffff1a",
      "editorSuggestWidget.background": "#161616",
      "editorSuggestWidget.border": "#ffffff1a",
      "editorSuggestWidget.foreground": "#f5f5f5",
      "editorSuggestWidget.selectedBackground": "#262626",
      "editorSuggestWidget.selectedForeground": "#f5f5f5",
      "editorSuggestWidget.selectedIconForeground": "#f5f5f5",
      "editorSuggestWidget.highlightForeground": "#ff7a33",
      "editorSuggestWidget.focusHighlightForeground": "#ff7a33",
      "editorHoverWidget.background": "#161616",
      "editorHoverWidget.border": "#ffffff1a",
      "editorHoverWidget.foreground": "#f5f5f5",
      "list.activeSelectionBackground": "#262626",
      "list.activeSelectionForeground": "#f5f5f5",
      "list.activeSelectionIconForeground": "#f5f5f5",
      "list.inactiveSelectionBackground": "#262626",
      "list.inactiveSelectionForeground": "#f5f5f5",
      "list.focusBackground": "#262626",
      "list.focusForeground": "#f5f5f5",
      "list.hoverBackground": "#1f1f1f",
      "list.hoverForeground": "#f5f5f5",
      "list.highlightForeground": "#ff7a33",
      "list.focusHighlightForeground": "#ff7a33",
      "quickInputList.focusBackground": "#262626",
      "quickInputList.focusForeground": "#f5f5f5",
      "scrollbarSlider.background": "#ffffff1a",
      "scrollbarSlider.hoverBackground": "#ffffff30",
      "editorBracketHighlight.foreground1": "#ff7a33", // --brand
      "editorBracketHighlight.foreground2": "#f5f5f5",
      "editorBracketHighlight.foreground3": "#a3a3a3",
      "editorBracketHighlight.foreground4": "#ff7a33",
      "editorBracketHighlight.foreground5": "#f5f5f5",
      "editorBracketHighlight.foreground6": "#a3a3a3",
      "editorBracketPairGuide.background1": "#ffffff1a",
      "editorBracketPairGuide.background2": "#ffffff1a",
      "editorBracketPairGuide.background3": "#ffffff1a",
      "editorBracketPairGuide.background4": "#ffffff1a",
      "editorBracketPairGuide.background5": "#ffffff1a",
      "editorBracketPairGuide.background6": "#ffffff1a",
      "editorBracketPairGuide.activeBackground1": "#ff7a3399",
      "editorBracketPairGuide.activeBackground2": "#f5f5f599",
      "editorBracketPairGuide.activeBackground3": "#a3a3a399",
      "editorBracketPairGuide.activeBackground4": "#ff7a3399",
      "editorBracketPairGuide.activeBackground5": "#f5f5f599",
      "editorBracketPairGuide.activeBackground6": "#a3a3a399",
    },
  });
}
