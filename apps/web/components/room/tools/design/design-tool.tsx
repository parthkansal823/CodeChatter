"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { PenTool } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";

import { ItemList } from "../canvas/item-list";
import { useLiveDoc } from "../canvas/live-doc";
import { useListItems } from "../canvas/use-canvas";
import { DesignEditor } from "./design-editor";

/** Which design each room had open, so closing and reopening the tool returns to it. */
const lastOpened = new Map<string, string>();

/** Design canvases for the room: a shared list, and one live canvas per design. */
export default function DesignTool({ close }: RoomToolProps) {
  const { room, me, can } = useRoom();
  const list = useLiveDoc(roomDocName(room.id, "designs"));
  const items = useListItems(list);
  const [openId, setOpenId] = useState<string | null>(() => lastOpened.get(room.id) ?? null);
  const editable = can("files.edit");

  const open = (id: string | null) => {
    if (id) lastOpened.set(room.id, id);
    else lastOpened.delete(room.id);
    setOpenId(id);
  };

  // A design someone trashed closes for everyone; one that isn't in the list yet waits for it to sync.
  const current = openId ? items.find((item) => item.id === openId && !item.trashedAt) : undefined;
  if (list?.synced && current) {
    return (
      <DesignEditor
        key={current.id}
        roomId={room.id}
        item={current}
        list={list}
        me={{ id: me.user.id, name: me.user.name, image: me.user.image ?? null }}
        editable={editable}
        onBack={() => open(null)}
        onClose={close}
      />
    );
  }
  return (
    <ItemList
      live={list}
      noun={{ one: "design", many: "Designs", untitled: "Untitled design" }}
      icon={PenTool}
      description="Draw screens, diagrams and graphics together on an infinite canvas. Export to SVG or PNG, and copy CSS or HTML for handoff."
      editable={editable}
      userId={me.user.id}
      onOpen={open}
      onClose={close}
    />
  );
}
