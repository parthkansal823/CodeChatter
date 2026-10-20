"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { formatDocument } from "./format";
import { currentSettings, useEditorSettings } from "./settings-store";
import {
  openPalette,
  openQuickOpen,
  openSettings,
  toggleFilePreview,
  toggleSplit,
  toggleZen,
  useEditorUi,
} from "./ui-store";

/**
 * Editor shortcuts that must work wherever focus is, so they listen on the
 * window in the capture phase (before Monaco, and before the browser's own
 * Print and Save). Inside Monaco, Ctrl+K Z is registered on the editor
 * itself, because Monaco owns the Ctrl+K chord there.
 */
export function useEditorShortcuts(activeFileId: string | null) {
  const latest = useRef(activeFileId);
  useEffect(() => {
    latest.current = activeFileId;
  });

  useEffect(() => {
    let chordUntil = 0;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const inMonaco = Boolean(target?.closest?.(".monaco-editor"));
      const inField =
        !inMonaco &&
        Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      if (chordUntil > Date.now()) {
        chordUntil = 0;
        if (!mod && !event.altKey && key === "v") {
          take();
          toggleFilePreview("side");
          return;
        }
        if (!mod && !event.altKey && key === "z") {
          take();
          toggleZen();
          return;
        }
      }
      // F1 opens the command palette too: Edge keeps Ctrl+Shift+P for InPrivate windows, as VS Code for the web knows.
      if (event.key === "F1" && !mod && !event.altKey && !event.shiftKey) {
        take();
        openPalette();
        return;
      }
      if (event.shiftKey && event.altKey && !mod && key === "f") {
        take();
        void formatDocument();
        return;
      }
      if (!mod) return;

      if (key === "k" && !event.shiftKey && !event.altKey && !inMonaco && !inField) {
        take();
        chordUntil = Date.now() + 1500;
      } else if (key === "p" && !event.altKey) {
        take();
        if (event.shiftKey) openPalette();
        else openQuickOpen();
      } else if (key === "v" && event.shiftKey && !event.altKey && !inMonaco && !inField) {
        take();
        toggleFilePreview("full");
      } else if (key === "o" && event.shiftKey && !event.altKey) {
        take();
        openPalette("symbols");
      } else if (key === "," && !event.shiftKey && !event.altKey) {
        take();
        openSettings();
      } else if (key === "g" && !event.shiftKey && !event.altKey && !inField) {
        take();
        openPalette("line");
      } else if (key === "\\" && !event.shiftKey && !event.altKey) {
        take();
        toggleSplit(latest.current);
      } else if (key === "s" && !event.altKey && !event.shiftKey) {
        // Everything saves as you type; Ctrl+S would otherwise open the browser's Save Page dialog.
        take();
        void (async () => {
          const formatted = currentSettings().formatOnSave && (await formatDocument({ quiet: true }));
          toast.message(
            formatted ? "Formatted. Changes sync as you type." : "Saved. Changes sync as you type.",
            { id: "saved" },
          );
        })();
      } else if (inMonaco && !event.altKey) {
        const step =
          key === "=" || key === "+" ? 1 : key === "-" || key === "_" ? -1 : key === "0" ? "reset" : null;
        if (step !== null) {
          take();
          useEditorSettings.getState().zoom(step);
        }
      }
    };

    // Esc leaves zen mode unless something else (a dialog, Monaco's find box) used it first.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && useEditorUi.getState().zen)
        useEditorUi.getState().setZen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keydown", onEscape);
    };
  }, []);
}
