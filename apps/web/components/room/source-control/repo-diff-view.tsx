"use client";

import { findByPath, languageFor } from "@codechatter/workspace-model";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { acquireModel } from "@/components/room/editor/file-models";
import { currentSettings } from "@/components/room/editor/settings-store";
import { ensureMonaco, monaco, registerWorkspaceFile } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { useBaseFiles, useRoomRepo } from "./use-repo";

/**
 * A file as it is on GitHub (at the commit the room last synced with, read-only) beside
 * the room's live file, which can be edited here. An added file has nothing on the left,
 * a deleted one nothing on the right.
 */
export function RepoDiffView({ path, onClose }: { path: string; onClose: () => void }) {
  const { doc } = useRoom();
  const repo = useRoomRepo();
  const base = useBaseFiles(repo?.commit);
  const host = useRef<HTMLDivElement>(null);
  const before = base?.get(path);
  const loaded = Boolean(base);

  useEffect(() => {
    if (!loaded) return;
    let disposed = false;
    let cleanup = () => {};
    void ensureMonaco().then(() => {
      if (disposed || !host.current) return;
      const language = languageFor(path.slice(path.lastIndexOf("/") + 1));
      // Registered file:// addresses, as the room's files have (see notebook/cell-editor.tsx).
      const leftUri = monaco.Uri.parse(
        `file:///github-base/${path.split("/").map(encodeURIComponent).join("/")}`,
      );
      monaco.editor.getModel(leftUri)?.dispose();
      const leftMirror = registerWorkspaceFile(leftUri, before ?? "");
      const left = monaco.editor.createModel(before ?? "", language, leftUri);
      const node = findByPath(doc, path);
      const live = node?.kind === "file" ? acquireModel(doc, node) : null;
      let empty: ReturnType<typeof monaco.editor.createModel> | null = null;
      let emptyMirror: { dispose(): void } | null = null;
      if (!live) {
        const uri = monaco.Uri.parse(
          `file:///github-deleted/${path.split("/").map(encodeURIComponent).join("/")}`,
        );
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
  }, [doc, path, before, loaded]);

  return (
    <section aria-label={`Changes to ${path}`} className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate text-muted-foreground">
          {path} on GitHub
          {repo && (
            <>
              {" "}
              ({repo.branch}, {repo.commit.slice(0, 7)})
            </>
          )}
        </span>
        <span aria-hidden className="text-muted-foreground">
          ↔
        </span>
        <span className="truncate">in the room</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close the comparison"
          className="ml-auto"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div ref={host} className="min-h-0 flex-1" />
    </section>
  );
}
