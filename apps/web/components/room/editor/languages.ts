"use client";

import { monaco } from "@/components/room/monaco-setup";

/** The name people know a language by ("TypeScript", "Plain Text") from Monaco's registry. */
export function languageLabel(id: string): string {
  const language = monaco.languages.getLanguages().find((l) => l.id === id);
  return language?.aliases?.[0] ?? id;
}

/** Every language mode Monaco can highlight, by display name. */
export function languageOptions(): { id: string; label: string }[] {
  return monaco.languages
    .getLanguages()
    .map((l) => ({ id: l.id, label: l.aliases?.[0] ?? l.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
