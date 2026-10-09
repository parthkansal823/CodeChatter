"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Eye } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

import { Canvas } from "../canvas/canvas";
import { CanvasHeader, EmptyCanvas, HistoryButtons, NameField, PeerAvatars, ShortcutHint, ZoomMenu } from "../canvas/chrome";
import type { ToolId } from "../canvas/editor";
import { ExportDialog } from "../canvas/export-dialog";
import { renameItem, type ListItem } from "../canvas/list";
import { useLiveDoc, type LiveDoc } from "../canvas/live-doc";
import { CanvasShell } from "../canvas/shell";
import { shortcutMap, ToolRow } from "../canvas/tool-row";
import { useCanvasSession } from "../canvas/use-canvas";
import { BoardInspector } from "./board-inspector";

const TOOLS: ToolId[] = ["select", "hand", "sticky", "pen", "eraser", "text", "rect", "ellipse", "arrow", "line"];
const KEYS = shortcutMap(TOOLS);

type Props = {
  roomId: string;
  item: ListItem;
  list: LiveDoc;
  me: { id: string; name: string; image: string | null };
  editable: boolean;
  onBack: () => void;
  onClose: () => void;
};

/** One open whiteboard: a tool rail on the left, the canvas, and a bar for the selection. */
export function BoardEditor({ roomId, item, list, me, editable, onBack, onClose }: Props) {
  const live = useLiveDoc(roomDocName(roomId, "board", item.id));
  const session = useCanvasSession(live, "board", me, editable);

  if (!session) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <CanvasHeader backLabel="Whiteboards" onBack={onBack} onClose={onClose} name={<span className="px-1 text-sm font-medium">{item.name}</span>} />
        <div className="grid gap-2 p-6" aria-label="Opening whiteboard">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <CanvasShell session={session} keys={KEYS}>
      <CanvasHeader
        backLabel="Whiteboards"
        onBack={onBack}
        onClose={onClose}
        name={<NameField name={item.name} editable={editable} label="whiteboard" onRename={(name) => renameItem(list.doc, item.id, name)} />}
        actions={
          <>
            {!editable && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="size-3.5" /> View only
              </span>
            )}
            <PeerAvatars />
            <HistoryButtons />
            <ZoomMenu />
            <ExportDialog name={item.name} />
          </>
        }
      />
      <div className="relative min-h-0 flex-1">
        <Canvas
          label={`Whiteboard: ${item.name}`}
          empty={
            <EmptyCanvas title={editable ? "This whiteboard is empty" : "Nothing on this whiteboard yet"}>
              {editable ? (
                <>
                  <li>Double-click anywhere to add a sticky note.</li>
                  <ShortcutHint keys={["S"]}>Sticky note</ShortcutHint>
                  <ShortcutHint keys={["P"]}>Pen</ShortcutHint>
                  <ShortcutHint keys={["A"]}>Arrow between shapes</ShortcutHint>
                  <ShortcutHint keys={["R"]}>Rectangle</ShortcutHint>
                  <ShortcutHint keys={["T"]}>Text</ShortcutHint>
                </>
              ) : (
                <li>Editors will add notes here. You can pan and zoom, and see their cursors live.</li>
              )}
              <ShortcutHint keys={["Space", "drag"]}>Pan</ShortcutHint>
              <ShortcutHint keys={["Ctrl", "scroll"]}>Zoom</ShortcutHint>
            </EmptyCanvas>
          }
        />
        <div className="pointer-events-none absolute top-3 left-3 flex">
          <div className="pointer-events-auto rounded-lg border bg-background p-1">
            <ToolRow tools={TOOLS} images vertical />
          </div>
        </div>
        <BoardInspector />
      </div>
    </CanvasShell>
  );
}
