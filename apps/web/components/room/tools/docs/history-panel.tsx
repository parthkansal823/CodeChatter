"use client";

import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { History, RotateCcw, Save, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { baseExtensions } from "./base-extensions";
import { useDocConnection } from "./connection";
import { useDocs } from "./docs-context";
import { historyDocName } from "./headless";
import { saveSnapshot, snapshotsOf, type Snapshot } from "./history";

type Props = {
  pageId: string;
  /** The live page's current content, for "Save version" and the safety copy before a restore. */
  current: () => { title: string; content: JSONContent } | null;
  viewing: Snapshot | null;
  onView: (snapshot: Snapshot | null) => void;
  onRestore: (snapshot: Snapshot) => void;
  onClose: () => void;
};

function useSnapshots(doc: Y.Doc | null): Snapshot[] {
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {};
      const list = doc.getArray("snapshots");
      const handler = () => {
        version.current += 1;
        onChange();
      };
      list.observe(handler);
      return () => list.unobserve(handler);
    },
    [doc],
  );
  const tick = useSyncExternalStore(subscribe, () => version.current, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (doc ? snapshotsOf(doc) : []), [doc, tick]);
}

const when = (at: number) => `${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

/** Saved versions of the page. Pick one to read it; restoring is a new change to the live page. */
export function HistoryPanel({ pageId, current, viewing, onView, onRestore, onClose }: Props) {
  const { roomId, me, editable } = useDocs();
  const connection = useDocConnection(historyDocName(roomId, pageId));
  const snapshots = useSnapshots(connection?.synced ? connection.doc : null);
  const [saving, setSaving] = useState(false);

  const saveNow = async () => {
    const now = current();
    if (!now) return;
    setSaving(true);
    try {
      const saved = await saveSnapshot(roomId, pageId, { by: { id: me.id, name: me.name }, ...now }, { label: "Saved by hand" });
      toast[saved ? "success" : "message"](saved ? "Version saved" : "Nothing new to save");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the version.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside aria-label="Version history" className="flex w-80 shrink-0 flex-col border-l bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Version history</span>
        {editable && (
          <Button variant="ghost" size="xs" className="ml-auto" disabled={saving || !connection?.synced} onClick={saveNow}>
            <Save /> Save version
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Close version history" className={cn(!editable && "ml-auto")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!connection?.synced ? (
          <div className="grid gap-2 p-2" aria-label="Loading versions">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : snapshots.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No versions yet. A version is saved every few minutes while people edit, and you can save one by hand.</p>
        ) : (
          <ul aria-label="Versions" className="grid gap-1">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id}>
                <button
                  type="button"
                  aria-pressed={viewing?.id === snapshot.id}
                  onClick={() => onView(viewing?.id === snapshot.id ? null : snapshot)}
                  className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent", viewing?.id === snapshot.id && "bg-accent")}
                >
                  <History aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{when(snapshot.at)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {snapshot.label ? `${snapshot.label}, ` : ""}
                      {snapshot.by.name}, {snapshot.words} {snapshot.words === 1 ? "word" : "words"}, {formatRelativeTime(new Date(snapshot.at))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {viewing && editable && (
        <div className="shrink-0 border-t p-2">
          <Button size="sm" className="w-full" onClick={() => onRestore(viewing)}>
            <RotateCcw /> Restore this version
          </Button>
        </div>
      )}
    </aside>
  );
}

/** A saved version, read-only, in place of the live page. */
export function SnapshotPreview({ snapshot }: { snapshot: Snapshot }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      extensions: baseExtensions(),
      content: snapshot.content,
      editorProps: { attributes: { class: "cc-doc-content", "aria-label": "Saved version" } },
    },
    [snapshot.id],
  );
  return (
    <div>
      <h1 className="mb-4 text-[1.9rem] leading-tight font-semibold tracking-tight">{snapshot.title.trim() || "Untitled"}</h1>
      <EditorContent editor={editor} />
    </div>
  );
}
