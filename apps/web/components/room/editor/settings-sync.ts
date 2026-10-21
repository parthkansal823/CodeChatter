"use client";

import { useEffect } from "react";

import { api } from "@/lib/api";

import { sanitizeSettings } from "./settings";
import { currentSettings, useEditorSettings } from "./settings-store";
import { useImportedThemes, type ImportedTheme } from "./themes";

/** Changes settle this long before they're saved (Ctrl+= pressed five times is one save). */
const SAVE_DELAY_MS = 1500;

type Saved = { settings: { editor: Record<string, unknown>; themes: unknown[]; updatedAt: string } | null };

/** Set while this browser has a change the account hasn't got (a reload came before the save, say). */
const DIRTY_KEY = "cc-editor-settings-unsaved";
const markDirty = (dirty: boolean) => {
  try {
    if (dirty) localStorage.setItem(DIRTY_KEY, "1");
    else localStorage.removeItem(DIRTY_KEY);
  } catch {
    // Storage blocked: the account copy is all there is.
  }
};
const isDirty = () => {
  try {
    return localStorage.getItem(DIRTY_KEY) === "1";
  } catch {
    return false;
  }
};

/** Themes as saved, keeping only well-formed ones. */
const validThemes = (themes: unknown[]): ImportedTheme[] =>
  themes.filter(
    (t): t is ImportedTheme =>
      Boolean(t) && typeof (t as ImportedTheme).id === "string" && /^custom-[a-z0-9]{1,40}$/.test((t as ImportedTheme).id) && typeof (t as ImportedTheme).name === "string" && typeof (t as ImportedTheme).data === "object",
  );

/**
 * Your editor settings and imported themes follow you (GET and PUT /api/me/settings):
 * your account's are loaded when a room opens, and a change is saved a moment after
 * you make it. The first time, this browser's become your account's, and so does a
 * change it didn't get to save (a reload right after it). Without the network, the
 * browser's own copy (localStorage) still works.
 */
export function useSettingsSync(): void {
  useEffect(() => {
    let live = true;
    let loaded = false;
    let applying = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () =>
      api("/api/me/settings", { method: "PUT", json: { editor: currentSettings(), themes: useImportedThemes.getState().themes } })
        .then(() => markDirty(false))
        .catch(() => {});
    const save = () => {
      if (applying) return;
      markDirty(true);
      if (!loaded) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void push(), SAVE_DELAY_MS);
    };
    void api<Saved>("/api/me/settings")
      .then(({ settings }) => {
        if (!live) return;
        loaded = true;
        // Nothing saved yet, or this browser changed something it didn't get to save: this browser's win.
        if (!settings || isDirty()) return void push();
        applying = true;
        useEditorSettings.setState(sanitizeSettings(settings.editor));
        useImportedThemes.setState({ themes: validThemes(settings.themes) });
        applying = false;
      })
      .catch(() => {
        loaded = true;
      });
    const stopSettings = useEditorSettings.subscribe(save);
    const stopThemes = useImportedThemes.subscribe(save);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      stopSettings();
      stopThemes();
    };
  }, []);
}
