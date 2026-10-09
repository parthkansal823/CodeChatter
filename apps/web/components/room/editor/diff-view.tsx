"use client";

import type { TreeNode } from "@codechatter/workspace-model";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { monaco } from "@/components/room/monaco-setup";
import { useRoom } from "@/components/room/room-context";
import { Button } from "@/components/ui/button";

import { acquireModel } from "./file-models";
import { currentSettings } from "./settings-store";

/**
 * Two room files side by side with their differences marked. Both sides are
 * the live files: edits on either side reach everyone, and others' edits show
 * up here as they type.
 */
export function DiffView({ left, right, onClose }: { left: TreeNode; right: TreeNode; onClose: () => void }) {
  const { doc } = useRoom();
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = acquireModel(doc, left);
    const b = acquireModel(doc, right);
    if (!host.current || !a || !b) {
      a?.release();
      b?.release();
      return;
    }
    const { fontSize } = currentSettings();
    const editor = monaco.editor.createDiffEditor(host.current, {
      automaticLayout: true,
      renderSideBySide: true,
      originalEditable: true,
      fontSize,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    editor.setModel({ original: a.model, modified: b.model });
    return () => {
      editor.dispose();
      a.release();
      b.release();
    };
  }, [doc, left, right]);

  return (
    <section
      aria-label={`Comparing ${left.path} with ${right.path}`}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-chrome pr-1 pl-3 text-xs">
        <span className="truncate text-muted-foreground">{left.path}</span>
        <span aria-hidden className="text-muted-foreground">
          ↔
        </span>
        <span className="truncate">{right.path}</span>
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
