"use client";

import { BringToFront, Copy, SendToBack, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { ToolButton } from "../canvas/chrome";
import { useAtom, useEditor, usePick } from "../canvas/hooks";
import { INK_SWATCHES, NOTE_SWATCHES, type Swatch } from "../canvas/palette";
import type { Shape } from "../canvas/shape";

const SIZES = [12, 14, 16, 18, 20, 24, 32, 48, 64];
const WEIGHTS = [
  { label: "Thin", width: 2 },
  { label: "Medium", width: 4 },
  { label: "Thick", width: 8 },
];
const DRAWING = new Set(["pen", "rect", "ellipse", "arrow", "line", "text"]);

const isNote = (s: Shape) => s.type === "sticky";
const takesInk = (s: Shape) => s.type !== "sticky" && s.type !== "image";
const hasStroke = (s: Shape) => s.type === "rect" || s.type === "ellipse" || s.type === "line" || s.type === "arrow" || s.type === "path";

function Dots({ label, swatches, value, onPick }: { label: string; swatches: Swatch[]; value: string | null; onPick: (value: string) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1 px-1">
      {swatches.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          aria-label={swatch.label}
          aria-pressed={value === swatch.value}
          title={swatch.label}
          onClick={() => onPick(swatch.value)}
          className={cn("size-5 rounded-full border border-input hover:border-foreground", value === swatch.value && "ring-2 ring-ring ring-offset-1 ring-offset-background")}
          style={{ backgroundColor: swatch.value }}
        />
      ))}
    </div>
  );
}

/**
 * Colours and quick actions for whatever you're drawing or have selected:
 * note colours for sticky notes, ink for everything else. Choosing a colour
 * also sets what the next note or stroke starts with.
 */
export function BoardInspector() {
  const editor = useEditor();
  const ids = useAtom(editor.selection);
  const tool = useAtom(editor.tool);
  const readOnly = useAtom(editor.readOnly);
  const style = useAtom(editor.style);
  const shapes = usePick(editor, ids);
  if (readOnly) return null;

  const notes = shapes.filter(isNote);
  const inked = shapes.filter(takesInk);
  const showNotes = tool === "sticky" || notes.length > 0;
  const showInk = DRAWING.has(tool) || inked.length > 0;
  const texty = shapes.filter((s) => s.type === "sticky" || s.type === "text");
  const stroked = shapes.filter(hasStroke);
  if (!showNotes && !showInk && shapes.length === 0) return null;

  const noteValue = notes.length ? (notes.every((s) => s.fill === notes[0]!.fill) ? notes[0]!.fill : null) : style.note;
  const pickNote = (note: string) => {
    editor.style.set({ ...style, note });
    if (notes.length) editor.updateMany(notes.map((s) => [s.id, { fill: note }]));
  };
  const pickInk = (ink: string) => {
    editor.style.set({ ...style, ink });
    if (inked.length) editor.updateMany(inked.map((s) => [s.id, s.type === "text" ? { fill: ink } : { stroke: ink }]));
  };
  const inkOf = (s: Shape) => (s.type === "text" ? s.fill : s.stroke);
  const inkValue = inked.length ? (inked.every((s) => inkOf(s) === inkOf(inked[0]!)) ? inkOf(inked[0]!) : null) : style.ink;
  const resize = (direction: 1 | -1) =>
    editor.updateMany(
      texty.map((s) => {
        const next = direction === 1 ? SIZES.find((size) => size > s.fontSize) : [...SIZES].reverse().find((size) => size < s.fontSize);
        return [s.id, { fontSize: next ?? s.fontSize }];
      }),
    );
  const weightValue = stroked.length ? (stroked.every((s) => s.strokeWidth === stroked[0]!.strokeWidth) ? stroked[0]!.strokeWidth : null) : style.width;
  const pickWeight = (width: number) => {
    editor.style.set({ ...style, width });
    if (stroked.length) editor.updateMany(stroked.map((s) => [s.id, { strokeWidth: width }]));
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div role="toolbar" aria-label="Selection" className="pointer-events-auto flex items-center gap-1 rounded-lg border bg-background p-1">
        {showNotes && <Dots label="Note colour" swatches={NOTE_SWATCHES} value={noteValue} onPick={pickNote} />}
        {showNotes && showInk && <Separator orientation="vertical" className="mx-1 h-5" />}
        {showInk && <Dots label="Ink colour" swatches={INK_SWATCHES} value={inkValue} onPick={pickInk} />}
        {(stroked.length > 0 || tool === "pen") && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <div role="group" aria-label="Line weight" className="flex items-center gap-0.5">
              {WEIGHTS.map((w) => (
                <Button key={w.label} variant={weightValue === w.width ? "secondary" : "ghost"} size="xs" aria-pressed={weightValue === w.width} onClick={() => pickWeight(w.width)}>
                  {w.label}
                </Button>
              ))}
            </div>
          </>
        )}
        {texty.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button variant="ghost" size="xs" aria-label="Smaller text" onClick={() => resize(-1)}>
              A-
            </Button>
            <Button variant="ghost" size="xs" aria-label="Larger text" onClick={() => resize(1)}>
              A+
            </Button>
          </>
        )}
        {shapes.length > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton label="Bring to front" size="icon-xs" onClick={() => editor.reorder(ids, "front")}>
              <BringToFront />
            </ToolButton>
            <ToolButton label="Send to back" size="icon-xs" onClick={() => editor.reorder(ids, "back")}>
              <SendToBack />
            </ToolButton>
            <ToolButton label="Duplicate" shortcut="Ctrl D" size="icon-xs" onClick={() => editor.duplicate(ids)}>
              <Copy />
            </ToolButton>
            <ToolButton label="Delete" shortcut="Del" size="icon-xs" onClick={() => editor.deleteShapes(ids)}>
              <Trash2 />
            </ToolButton>
          </>
        )}
      </div>
    </div>
  );
}
