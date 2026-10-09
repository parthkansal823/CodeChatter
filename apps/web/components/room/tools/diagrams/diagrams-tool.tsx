"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Workflow } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";

import { ItemList } from "../canvas/item-list";
import { useLiveDoc } from "../canvas/live-doc";
import { useListItems } from "../canvas/use-canvas";
import { DiagramEditor } from "./diagram-editor";

/** Which diagram each room had open, so closing and reopening the tool returns to it. */
const lastOpened = new Map<string, string>();

/** draw.io diagrams for the room: a shared list, and each diagram edited by everyone at once. */
export default function DiagramsTool({ close }: RoomToolProps) {
  const { room, can } = useRoom();
  const list = useLiveDoc(roomDocName(room.id, "diagrams"));
  const items = useListItems(list);
  const [openId, setOpenId] = useState<string | null>(() => lastOpened.get(room.id) ?? null);
  const { me } = useRoom();
  const editable = can("files.edit");

  const open = (id: string | null) => {
    if (id) lastOpened.set(room.id, id);
    else lastOpened.delete(room.id);
    setOpenId(id);
  };

  const current = openId ? items.find((item) => item.id === openId && !item.trashedAt) : undefined;
  if (list?.synced && current) {
    return <DiagramEditor key={current.id} roomId={room.id} item={current} list={list} editable={editable} onBack={() => open(null)} onClose={close} />;
  }
  return (
    <ItemList
      live={list}
      noun={{ one: "diagram", many: "Diagrams", untitled: "Untitled diagram" }}
      icon={Workflow}
      description="Flowcharts, UML, ER, network and architecture diagrams with draw.io and all its shapes, edited together live. Export to PNG, SVG, PDF and more."
      editable={editable}
      userId={me.user.id}
      onOpen={open}
      onClose={close}
    />
  );
}
