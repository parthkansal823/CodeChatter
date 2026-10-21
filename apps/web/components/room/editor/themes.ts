"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { monaco } from "@/components/room/monaco-setup";

import { currentSettings } from "./settings-store";
import { convertVsCodeTheme, type MonacoThemeData } from "./vscode-theme";

/** Themes everyone has: the room's own (following light and dark) and Monaco's. */
export const BUILT_IN_THEMES: ReadonlyArray<readonly [id: string, label: string]> = [
  ["auto", "CodeChatter (follows the app)"],
  ["vs", "Visual Studio Light"],
  ["vs-dark", "Visual Studio Dark"],
  ["hc-light", "High contrast light"],
  ["hc-black", "High contrast dark"],
];

export type ImportedTheme = { id: string; name: string; data: MonacoThemeData };

/** VS Code themes you imported, kept in this browser (like the other editor settings). */
export const useImportedThemes = create<{
  themes: ImportedTheme[];
  add: (theme: ImportedTheme) => void;
  remove: (id: string) => void;
}>()(
  persist(
    (set) => ({
      themes: [],
      add: (theme) => set((s) => ({ themes: [...s.themes.filter((t) => t.id !== theme.id), theme] })),
      remove: (id) => set((s) => ({ themes: s.themes.filter((t) => t.id !== id) })),
    }),
    { name: "cc-editor-themes", version: 1 },
  ),
);

const defined = new Set<string>();

/** Monaco knows an imported theme by its id once it's been defined. */
function define(theme: ImportedTheme): void {
  if (defined.has(theme.id)) return;
  monaco.editor.defineTheme(theme.id, theme.data);
  defined.add(theme.id);
}

/** The Monaco theme for the editor setting, with the app in dark or light. */
export function editorThemeId(appDark: boolean, setting = currentSettings().editorTheme): string {
  if (setting === "auto") return appDark ? "cc-dark" : "cc-light";
  if (setting.startsWith("custom-")) {
    const theme = useImportedThemes.getState().themes.find((t) => t.id === setting);
    if (!theme) return appDark ? "cc-dark" : "cc-light";
    define(theme);
    return theme.id;
  }
  return setting;
}

/** Every editor on the page in the chosen theme (Monaco's theme is one for the page). */
export function applyEditorTheme(appDark = document.documentElement.classList.contains("dark")): void {
  monaco.editor.setTheme(editorThemeId(appDark));
}

/** A VS Code theme file's text, kept and returned as an imported theme (or a ThemeError saying why not). */
export function importVsCodeTheme(text: string): ImportedTheme {
  const converted = convertVsCodeTheme(text);
  const slug = converted.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "theme";
  const theme: ImportedTheme = { id: `custom-${slug}${Date.now().toString(36).slice(-4)}`, name: converted.name, data: converted.data };
  useImportedThemes.getState().add(theme);
  return theme;
}
