"use client";

import { findByPath, languageFor } from "@codechatter/workspace-model";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { acquireModel } from "@/components/room/editor/file-models";
import { currentSettings } from "@/components/room/editor/settings-store";
import { ensureMonaco, monaco, registerWorkspaceFile } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

/**
 * A file as it was somewhere else (GitHub's copy, a checkpoint: read-only, on the left)
 * beside the room's live file, which can be edited here. A file that wasn't there has
 * nothing on the left; one the room no longer has, nothing on the right.
 */
export function TextDiffView({
  path,
  before,
  loaded,
  scheme,
  title,
  onClose,
}: {
  path: string;
  /** The text on the left; undefined when the file wasn't there. */
  before: string | undefined;
  /** Whether `before` has been read yet. */
  loaded: boolean;
  /** Where the left side's addresses live, unique to the kind of comparison ("github-base"). */
  scheme: string;
  /** What the left side is, for the header. */
  title: ReactNode;
  onClose: () => void;
}) {
  const { doc } = useRoom();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    let cleanup = () => {};
    void ensureMonaco().then(() => {
      if (disposed || !host.current) return;
      const language = languageFor(path.slice(path.lastIndexOf("/") + 1));
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      // Registered file:// addresses, as the room's files have (see notebook/cell-editor.tsx).
      const leftUri = monaco.Uri.parse(`file:///${scheme}/${encoded}`);
      monaco.editor.getModel(leftUri)?.dispose();
      const leftMirror = registerWorkspaceFile(leftUri, before ?? "");
      const left = monaco.editor.createModel(before ?? "", language, leftUri);
      const node = findByPath(doc, path);
      const live = node?.kind === "file" ? acquireModel(doc, node) : null;
      let empty: ReturnType<typeof monaco.editor.createModel> | null = null;
      let emptyMirror: { dispose(): void } | null = null;
      if (!live) {
        const uri = monaco.Uri.parse(`file:///${scheme}-deleted/${encoded}`);
        monaco.editor.getModel(uri)?.dispose();
        emptyMirror = registerWorkspaceFile(uri, "");
        empty = monaco.editor.createModel("", language, uri);
      }
      const editor = monaco.editor.createDiffEditor(host.current, {
        automaticLayout: true,
        renderSideBySide: true,
        originalEditable: false,
        readOnly: !live,
        fontSize: currentSettings().fontSize,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });
      editor.setModel({ original: left, modified: live?.model ?? empty! });
      cleanup = () => {
        editor.dispose();
        left.dispose();
        leftMirror.dispose();
        empty?.dispose();
        emptyMirror?.dispose();
        live?.release();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [doc, path, before, loaded, scheme]);

  return (
    <section aria-label={`Changes to ${path}`} className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate text-muted-foreground">{title}</span>
        <span aria-hidden className="text-muted-foreground">
          ↔
        </span>
        <span className="truncate">in the room</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close the comparison" className="ml-auto" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div ref={host} className="min-h-0 flex-1" />
    </section>
  );
}
