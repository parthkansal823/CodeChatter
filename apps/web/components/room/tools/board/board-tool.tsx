"use client";

import { roomDocName } from "@codechatter/workspace-model";
import { Presentation } from "lucide-react";
import { useState } from "react";

import { useRoom } from "@/components/room/room-context";
import type { RoomToolProps } from "@/components/room/tools/registry";

import { ItemList } from "../canvas/item-list";
import { useLiveDoc } from "../canvas/live-doc";
import { useListItems } from "../canvas/use-canvas";
import { BoardEditor } from "./board-editor";

/** Which whiteboard each room had open, so closing and reopening the tool returns to it. */
const lastOpened = new Map<string, string>();

/** Whiteboards for the room: a shared list, and one live board each. */
export default function BoardTool({ close }: RoomToolProps) {
  const { room, me, can } = useRoom();
  const list = useLiveDoc(roomDocName(room.id, "boards"));
  const items = useListItems(list);
  const [openId, setOpenId] = useState<string | null>(() => lastOpened.get(room.id) ?? null);
  const editable = can("files.edit");

  const open = (id: string | null) => {
    if (id) lastOpened.set(room.id, id);
    else lastOpened.delete(room.id);
    setOpenId(id);
  };

  const current = openId ? items.find((item) => item.id === openId && !item.trashedAt) : undefined;
  if (list?.synced && current) {
    return (
      <BoardEditor
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
      noun={{ one: "whiteboard", many: "Whiteboards", untitled: "Untitled whiteboard" }}
      icon={Presentation}
      description="Brainstorm with sticky notes, sketches and arrows. Everyone in the room draws on the same board at once."
      editable={editable}
      userId={me.user.id}
      onOpen={open}
      onClose={close}
    />
  );
}
