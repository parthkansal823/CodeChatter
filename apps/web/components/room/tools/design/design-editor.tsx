"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Eye, PanelLeft, PanelRight } from "lucide-react";
import { useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { Canvas } from "../canvas/canvas";
import { CanvasHeader, EmptyCanvas, HistoryButtons, NameField, PeerAvatars, ShortcutHint, ToolButton, ZoomMenu } from "../canvas/chrome";
import { ExportMenu } from "../canvas/export-menu";
import { LayersPanel } from "../canvas/layers";
import { renameItem, type ListItem } from "../canvas/list";
import { useLiveDoc, type LiveDoc } from "../canvas/live-doc";
import { PropertiesPanel } from "../canvas/properties";
import { CanvasShell } from "../canvas/shell";
import { shortcutMap, ToolRow } from "../canvas/tool-row";
import type { ToolId } from "../canvas/editor";
import { useCanvasSession } from "../canvas/use-canvas";

const TOOLS: ToolId[] = ["select", "frame", "rect", "ellipse", "line", "arrow", "text", "pen", "hand"];
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

/** One open design: layers on the left, the canvas, properties on the right. */
export function DesignEditor({ roomId, item, list, me, editable, onBack, onClose }: Props) {
  const live = useLiveDoc(roomDocName(roomId, "design", item.id));
  const session = useCanvasSession(live, "design", me, editable);
  const [layers, setLayers] = useState(true);
  const [properties, setProperties] = useState(true);

  if (!session) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <CanvasHeader backLabel="Designs" onBack={onBack} onClose={onClose} name={<span className="px-1 text-sm font-medium">{item.name}</span>} />
        <div className="grid gap-2 p-6" aria-label="Opening design">
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
        backLabel="Designs"
        onBack={onBack}
        onClose={onClose}
        name={<NameField name={item.name} editable={editable} label="design" onRename={(name) => renameItem(list.doc, item.id, name)} />}
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
            <ToolButton label={layers ? "Hide layers" : "Show layers"} active={layers} onClick={() => setLayers((v) => !v)}>
              <PanelLeft />
            </ToolButton>
            <ToolButton label={properties ? "Hide properties" : "Show properties"} active={properties} onClick={() => setProperties((v) => !v)}>
              <PanelRight />
            </ToolButton>
            <ExportMenu name={item.name} />
          </>
        }
      >
        <ToolRow tools={TOOLS} images />
      </CanvasHeader>
      <div className="flex min-h-0 flex-1">
        {layers && <LayersPanel />}
        <div className="relative min-w-0 flex-1">
          <Canvas
            label={`Design canvas: ${item.name}`}
            empty={
              <EmptyCanvas title={editable ? "This design is empty" : "Nothing on this design yet"}>
                {editable ? (
                  <>
                    <ShortcutHint keys={["F"]}>Draw a frame to start a screen</ShortcutHint>
                    <ShortcutHint keys={["R"]}>Rectangle</ShortcutHint>
                    <ShortcutHint keys={["O"]}>Ellipse</ShortcutHint>
                    <ShortcutHint keys={["T"]}>Text</ShortcutHint>
                    <ShortcutHint keys={["P"]}>Pen</ShortcutHint>
                    <ShortcutHint keys={["Ctrl", "V"]}>Paste an image or text</ShortcutHint>
                  </>
                ) : (
                  <li>Editors will add shapes here. You can pan and zoom, and see their cursors live.</li>
                )}
                <ShortcutHint keys={["Space", "drag"]}>Pan</ShortcutHint>
                <ShortcutHint keys={["Ctrl", "scroll"]}>Zoom</ShortcutHint>
                <ShortcutHint keys={["Shift", "1"]}>Zoom to fit</ShortcutHint>
              </EmptyCanvas>
            }
          />
        </div>
        {properties && <PropertiesPanel />}
      </div>
    </CanvasShell>
  );
}
