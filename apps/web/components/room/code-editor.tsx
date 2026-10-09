"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import type { PaneRole } from "@/components/room/editor/active-editor";
import { acquireModel, restoreViewState, saveViewState } from "@/components/room/editor/file-models";
import { RemoteCursorStyles } from "@/components/room/editor/remote-cursors";
import { monacoOptions } from "@/components/room/editor/settings";
import { currentSettings, useSettingsValues } from "@/components/room/editor/settings-store";
import { useEditorUi } from "@/components/room/editor/ui-store";
import { wireEditor } from "@/components/room/editor/wire-editor";
import { ensureMonaco, monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";

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
  const { doc, provider, can } = useRoom();
  const { resolvedTheme } = useTheme();
  const settings = useSettingsValues();
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const wired = useRef<ReturnType<typeof wireEditor> | null>(null);
  const [ready, setReady] = useState(false);
  const readOnly = !can("files.edit");
  const { id, path, name } = file ?? { id: null, path: null, name: null };

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
        readOnlyMessage: { value: "You can view this room but not edit it. Ask the owner for editor access." },
        theme: document.documentElement.classList.contains("dark") ? "cc-dark" : "cc-light",
        ...monacoOptions(currentSettings()),
      });
      editorRef.current = editor;
      wired.current = wireEditor(editor, role, provider);
      setReady(true);
    });
    return () => {
      disposed = true;
      wired.current?.dispose();
      wired.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    monaco.editor.setTheme(resolvedTheme === "dark" ? "cc-dark" : "cc-light");
    wired.current?.refreshMarks();
  }, [ready, resolvedTheme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly, ready]);

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

  return (
    <div className="relative h-full min-h-0">
      <div ref={host} className="absolute inset-0" />
      {role === "primary" && <RemoteCursorStyles />}
      {!ready && <div className="absolute inset-0 animate-pulse bg-background" />}
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
