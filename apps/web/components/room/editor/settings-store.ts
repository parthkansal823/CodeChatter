"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import {
  clampFontSize,
  DEFAULT_SETTINGS,
  FONT_SIZE,
  sanitizeSettings,
  type EditorSettings,
} from "@/components/room/editor/settings";

type State = EditorSettings & {
  update: (patch: Partial<EditorSettings>) => void;
  /** Ctrl/Cmd + = and Ctrl/Cmd + -; 0 puts the size back. */
  zoom: (delta: number | "reset") => void;
  reset: () => void;
};

const pick = (state: State): EditorSettings => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = state[key as keyof EditorSettings];
  return out as EditorSettings;
};

export const useEditorSettings = create<State>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(sanitizeSettings({ ...pick(get()), ...patch })),
      zoom: (delta) =>
        set({ fontSize: delta === "reset" ? FONT_SIZE.default : clampFontSize(get().fontSize + delta) }),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: "cc-editor-settings",
      version: 1,
      partialize: pick,
      // New settings keep their defaults for people who saved an older set.
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);

/** The current settings as one stable object (re-renders only when a value changes). */
export const useSettingsValues = (): EditorSettings => useEditorSettings(useShallow(pick));

export const currentSettings = (): EditorSettings => pick(useEditorSettings.getState());
