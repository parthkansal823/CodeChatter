"use client";

import { Circle, Frame, Hand, ImagePlus, Minus, MousePointer2, MoveUpRight, Pencil, Square, StickyNote, Type, type LucideIcon } from "lucide-react";
import { useRef } from "react";

import { insertImage } from "./clipboard-io";
import type { ToolId } from "./editor";
import { useAtom, useEditor } from "./hooks";
import { ToolButton } from "./chrome";

export const TOOLS: Record<ToolId, { label: string; key: string; icon: LucideIcon }> = {
  select: { label: "Select", key: "V", icon: MousePointer2 },
  hand: { label: "Hand", key: "H", icon: Hand },
  frame: { label: "Frame", key: "F", icon: Frame },
  rect: { label: "Rectangle", key: "R", icon: Square },
  ellipse: { label: "Ellipse", key: "O", icon: Circle },
  line: { label: "Line", key: "L", icon: Minus },
  arrow: { label: "Arrow", key: "A", icon: MoveUpRight },
  text: { label: "Text", key: "T", icon: Type },
  pen: { label: "Pen", key: "P", icon: Pencil },
  sticky: { label: "Sticky note", key: "S", icon: StickyNote },
};

/** Single-key shortcuts for a toolbar's tools, as the keyboard handler wants them. */
export const shortcutMap = (ids: ToolId[]): Record<string, ToolId> =>
  Object.fromEntries(ids.map((id) => [TOOLS[id].key.toLowerCase(), id]));

/** The tool buttons, in order; the active one is pressed. Viewers only get Select and Hand. */
export function ToolRow({ tools, images = false, vertical = false }: { tools: ToolId[]; images?: boolean; vertical?: boolean }) {
  const editor = useEditor();
  const active = useAtom(editor.tool);
  const readOnly = useAtom(editor.readOnly);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = readOnly ? tools.filter((id) => id === "select" || id === "hand") : tools;
  return (
    <div role="toolbar" aria-label="Tools" aria-orientation={vertical ? "vertical" : "horizontal"} className={vertical ? "flex flex-col gap-0.5" : "flex items-center gap-0.5"}>
      {shown.map((id) => {
        const { label, key, icon: Icon } = TOOLS[id];
        return (
          <ToolButton key={id} label={label} shortcut={key} active={active === id} onClick={() => editor.tool.set(id)}>
            <Icon />
          </ToolButton>
        );
      })}
      {images && !readOnly && (
        <>
          <ToolButton label="Add image" onClick={() => fileRef.current?.click()}>
            <ImagePlus />
          </ToolButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void insertImage(editor, file, editor.viewCenter());
            }}
          />
        </>
      )}
    </div>
  );
}
