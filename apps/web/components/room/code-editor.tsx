"use client";

import { isNotebookName, type TreeNode } from "@codechatter/workspace-model";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { useTabs } from "@/components/room/editor-store";
import type { PaneRole } from "@/components/room/editor/active-editor";
import { Breadcrumbs } from "@/components/room/editor/breadcrumbs";
import { editorThemeId } from "@/components/room/editor/themes";
import { attachVim } from "@/components/room/editor/vim-mode";
import { acquireModel, restoreViewState, saveViewState } from "@/components/room/editor/file-models";
import { RemoteCursorStyles } from "@/components/room/editor/remote-cursors";
import { monacoOptions } from "@/components/room/editor/settings";
import { currentSettings, useSettingsValues } from "@/components/room/editor/settings-store";
import { useEditorUi } from "@/components/room/editor/ui-store";
import { wireEditor } from "@/components/room/editor/wire-editor";
import { ensureMonaco, monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";

const READ_ONLY_ROOM = "You can view this room but not edit it. Ask the owner for editor access.";
const READ_ONLY_NOTEBOOK = "This is the notebook's saved form, kept in step with its cells. Open the file on its own to edit the cells.";

/** Which grid slot (ui-store.ts) each split editor shows. */
const SLOT_OF_ROLE = { split: "right", "split-below": "below", "split-below-right": "belowRight" } as const;

type Props = {
  file: TreeNode | null;
  /** "primary" is the main editor under the tabs; "split" is the second one on its right. */
  role: Exclude<PaneRole, "diff">;
};

/**
 * One Monaco editor showing one file. The file's model is shared with every
 * other editor showing it and bound to its Y.Text with y-monaco (file-models.ts);
 * everyone else's carets are drawn from awareness (remote-cursors.tsx).
 */
export function CodeEditor({ file, role }: Props) {
  const { room, doc, provider, can } = useRoom();
  const { resolvedTheme } = useTheme();
  const settings = useSettingsValues();
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const wired = useRef<ReturnType<typeof wireEditor> | null>(null);
  const [ready, setReady] = useState(false);
  // The same editor as editorRef, as state: the breadcrumbs follow it.
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const open = useTabs((state) => state.open);
  const { id, path, name } = file ?? { id: null, path: null, name: null };
  // A notebook's text follows its cells (the runner writes it): edit the cells instead.
  const notebook = Boolean(name && isNotebookName(name));
  const readOnly = !can("files.edit") || notebook;

  // Create the editor once.
  useEffect(() => {
    let disposed = false;
    void ensureMonaco().then(() => {
      if (disposed || !host.current) return;
      const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-neon").trim();
      const editor = monaco.editor.create(host.current, {
        automaticLayout: true,
        fontFamily: `${fontFamily}, ui-monospace, monospace`,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        padding: { top: 12, bottom: 12 },
        readOnly,
        readOnlyMessage: { value: READ_ONLY_ROOM },
        theme: editorThemeId(document.documentElement.classList.contains("dark")),
        ...monacoOptions(currentSettings()),
      });
      editorRef.current = editor;
      wired.current = wireEditor(editor, role, provider);
      setEditor(editor);
      setReady(true);
    });
    return () => {
      disposed = true;
      wired.current?.dispose();
      wired.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
      setEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The editor theme (Settings): the room's own follows the app's light or dark.
  const themeSetting = settings.editorTheme;
  useEffect(() => {
    if (!ready) return;
    monaco.editor.setTheme(editorThemeId(resolvedTheme === "dark", themeSetting));
    wired.current?.refreshMarks();
  }, [ready, resolvedTheme, themeSetting]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, readOnlyMessage: { value: notebook && can("files.edit") ? READ_ONLY_NOTEBOOK : READ_ONLY_ROOM } });
  }, [readOnly, ready, notebook, can]);

  // Settings apply to every open editor as soon as they change.
  useEffect(() => {
    editorRef.current?.updateOptions(monacoOptions(settings));
  }, [settings, ready]);

  // Show the file.
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor) return;
    if (!id || !path || !name) {
      editor.setModel(null);
      return;
    }
    // Content that hasn't synced yet has no Y.Text; this re-runs when the tree changes.
    const handle = acquireModel(doc, { id, path, name }, useEditorUi.getState().languageOverrides[id]);
    if (!handle) return;
    editor.setModel(handle.model);
    restoreViewState(role, id, editor);
    focusUnlessTyping(editor);
    return () => {
      saveViewState(role, id, editor);
      // After the next file is set, so the model isn't torn down and rebuilt in between.
      queueMicrotask(handle.release);
    };
  }, [ready, id, path, name, doc, role]);

  // "Change language mode" applies to the open file at once, in every editor showing it.
  const override = useEditorUi((state) => (id ? state.languageOverrides[id] : undefined));
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (ready && model && override && model.getLanguageId() !== override) monaco.editor.setModelLanguage(model, override);
  }, [override, ready, id]);

  // Vim key bindings, for people who turn them on (Settings, Key bindings).
  const vimStatus = useRef<HTMLDivElement>(null);
  const vim = settings.keymap === "vim";
  useEffect(() => {
    const status = vimStatus.current;
    if (!editor || !vim || !status) return;
    let live = true;
    let off: (() => void) | null = null;
    void attachVim(editor, status).then((dispose) => {
      if (live) off = dispose;
      else dispose();
    });
    return () => {
      live = false;
      off?.();
      status.replaceChildren();
    };
  }, [editor, vim]);

  // A file picked from a breadcrumb opens in this pane: a tab in the main editor, or the split's file.
  const openHere = (fileId: string) =>
    role === "primary" ? open(room.id, fileId) : useEditorUi.getState().setSplitSlot(SLOT_OF_ROLE[role], fileId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {file && settings.breadcrumbs && <Breadcrumbs editor={editor} file={file} onOpen={openHere} />}
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {role === "primary" && <RemoteCursorStyles />}
        {!ready && <div className="absolute inset-0 animate-pulse bg-background" />}
      </div>
      {vim && (
        <div
          ref={vimStatus}
          aria-label="Vim"
          className="flex h-5 shrink-0 items-center gap-2 border-t bg-chrome px-2 font-mono text-xs text-muted-foreground [&_input]:bg-transparent [&_input]:text-foreground [&_input]:outline-none"
        />
      )}
    </div>
  );
}

/** Opening a file puts the cursor in it, unless you are typing in chat or another field. */
function focusUnlessTyping(editor: monaco.editor.IStandaloneCodeEditor) {
  const el = document.activeElement;
  const typingElsewhere =
    el instanceof HTMLElement && !editor.getContainerDomNode().contains(el) && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  if (!typingElsewhere) editor.focus();
}
