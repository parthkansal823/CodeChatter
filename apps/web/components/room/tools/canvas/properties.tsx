"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Code2,
  Copy,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { copyCss, copyHtml } from "./export-actions";
import { ColorField, Field, NumberField, Section, TextField } from "./fields";
import { useAtom, useEditor, usePick } from "./hooks";
import { ToolButton } from "./chrome";
import { isLinear, TYPE_LABEL, type Shape, type ShapePatch } from "./shape";

/** The value every shape agrees on, or null when they differ. */
function common<T>(shapes: Shape[], get: (s: Shape) => T): T | null {
  const first = get(shapes[0]!);
  return shapes.every((s) => get(s) === first) ? first : null;
}

const supportsFill = (s: Shape) => s.type === "frame" || s.type === "rect" || s.type === "ellipse" || s.type === "sticky" || s.type === "text";
const supportsStroke = (s: Shape) => s.type === "frame" || s.type === "rect" || s.type === "ellipse" || isLinear(s.type) || s.type === "path";
const supportsRadius = (s: Shape) => s.type === "frame" || s.type === "rect" || s.type === "sticky" || s.type === "image";
const hasText = (s: Shape) => s.type === "text" || s.type === "sticky";

const WEIGHTS = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
];

/** The right panel: what the selection looks like, and the handoff actions. */
export function PropertiesPanel() {
  const editor = useEditor();
  const ids = useAtom(editor.selection);
  const readOnly = useAtom(editor.readOnly);
  const shapes = usePick(editor, ids);
  return (
    <aside aria-label="Properties" className="flex w-64 shrink-0 flex-col border-l bg-panel">
      <div className="flex h-9 shrink-0 items-center border-b px-3">
        <h2 className="text-xs font-medium">{shapes.length === 0 ? "Design" : shapes.length === 1 ? TYPE_LABEL[shapes[0]!.type] : `${shapes.length} shapes`}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shapes.length === 0 ? <NothingSelected readOnly={readOnly} /> : <Inspector shapes={shapes} readOnly={readOnly} />}
      </div>
    </aside>
  );
}

function NothingSelected({ readOnly }: { readOnly: boolean }) {
  return (
    <p className="px-3 py-4 text-sm text-muted-foreground">
      {readOnly ? "Select a shape to see its size, colours and CSS." : "Select a shape to edit its size, colours and text. Press F to draw a frame, then R, O or T to fill it."}
    </p>
  );
}

function Inspector({ shapes, readOnly }: { shapes: Shape[]; readOnly: boolean }) {
  const editor = useEditor();
  const single = shapes.length === 1 ? shapes[0]! : null;
  const apply = (patch: ShapePatch, only: (s: Shape) => boolean = () => true) =>
    editor.updateMany(shapes.filter(only).map((s) => [s.id, patch] as [string, ShapePatch]));
  const bounds = editor.selectionBounds(shapes.map((s) => s.id));
  const fillable = shapes.filter(supportsFill);
  const strokable = shapes.filter(supportsStroke);
  const roundable = shapes.filter(supportsRadius);
  const texty = shapes.filter(hasText);
  const attached = !!single && isLinear(single.type) && (!!single.startId || !!single.endId);
  const free = shapes.filter((s) => !s.locked);

  // A move carries what's inside frames, so X and Y go through nudge, not a plain patch.
  const moveTo = (axis: "x" | "y", value: number) => {
    if (!bounds) return;
    const d = value - bounds[axis];
    editor.nudge(shapes.map((s) => s.id), axis === "x" ? d : 0, axis === "y" ? d : 0);
  };

  return (
    <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {shapes.length > 1 && <AlignRow count={shapes.length} />}
      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={bounds ? bounds.x : null} onCommit={(v) => moveTo("x", v)} disabled={free.length === 0} />
          <NumberField label="Y" value={bounds ? bounds.y : null} onCommit={(v) => moveTo("y", v)} disabled={free.length === 0} />
          <NumberField
            label="Width"
            value={single ? single.w : null}
            min={1}
            onCommit={(w) => single && editor.setBox(single.id, { w })}
            disabled={!single || single.locked || attached}
          />
          <NumberField
            label="Height"
            value={single ? single.h : null}
            min={1}
            onCommit={(h) => single && editor.setBox(single.id, { h })}
            disabled={!single || single.locked || attached || single.type === "text"}
          />
          <NumberField
            label="Rotation"
            value={common(shapes, (s) => s.rotation)}
            suffix="deg"
            min={-360}
            max={360}
            onCommit={(rotation) => apply({ rotation })}
            disabled={free.length === 0 || shapes.some((s) => isLinear(s.type))}
          />
          {roundable.length > 0 && (
            <NumberField label="Radius" value={common(roundable, (s) => s.radius)} min={0} onCommit={(radius) => apply({ radius }, supportsRadius)} />
          )}
        </div>
      </Section>

      <Section title="Appearance">
        <Field label="Opacity">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Opacity"
              value={Math.round((common(shapes, (s) => s.opacity) ?? 1) * 100)}
              onChange={(e) => apply({ opacity: Number(e.target.value) / 100 })}
              className="h-1 min-w-0 flex-1 accent-brand"
            />
            <NumberField
              label="Opacity percent"
              value={common(shapes, (s) => Math.round(s.opacity * 100))}
              min={0}
              max={100}
              suffix="%"
              onCommit={(v) => apply({ opacity: v / 100 })}
              className="w-16 shrink-0"
            />
          </div>
        </Field>
      </Section>

      {fillable.length > 0 && (
        <Section title={fillable.every((s) => s.type === "text") ? "Text colour" : "Fill"}>
          <ColorField label="Fill" value={common(fillable, (s) => s.fill)} onChange={(fill) => apply({ fill }, supportsFill)} allowNone={!fillable.every((s) => s.type === "text")} />
        </Section>
      )}

      {strokable.length > 0 && (
        <Section title="Stroke">
          <ColorField label="Stroke" value={common(strokable, (s) => s.stroke)} onChange={(stroke) => apply({ stroke }, supportsStroke)} />
          <NumberField label="Weight" value={common(strokable, (s) => s.strokeWidth)} min={0} max={100} onCommit={(strokeWidth) => apply({ strokeWidth }, supportsStroke)} />
        </Section>
      )}

      {texty.length > 0 && (
        <Section title="Text">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Size" value={common(texty, (s) => s.fontSize)} min={4} max={400} onCommit={(fontSize) => apply({ fontSize }, hasText)} />
            <Select value={String(common(texty, (s) => s.fontWeight) ?? "")} onValueChange={(v) => apply({ fontWeight: Number(v) }, hasText)}>
              <SelectTrigger size="sm" aria-label="Weight" className="h-7 w-full">
                <SelectValue placeholder="Mixed" />
              </SelectTrigger>
              <SelectContent>
                {WEIGHTS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div role="group" aria-label="Text alignment" className="flex gap-0.5">
            {(
              [
                ["left", "Align left", AlignLeft],
                ["center", "Align centre", AlignCenter],
                ["right", "Align right", AlignRight],
              ] as const
            ).map(([align, label, Icon]) => (
              <ToolButton key={align} label={label} active={common(texty, (s) => s.textAlign) === align} onClick={() => apply({ textAlign: align }, hasText)}>
                <Icon />
              </ToolButton>
            ))}
          </div>
        </Section>
      )}

      {single && (
        <Section title="Name">
          <TextField label="Layer name" value={single.name} onCommit={(name) => editor.update(single.id, { name })} disabled={readOnly} />
        </Section>
      )}

      <Handoff shapes={shapes} />
    </fieldset>
  );
}

function Handoff({ shapes }: { shapes: Shape[] }) {
  const editor = useEditor();
  const single = shapes.length === 1 ? shapes[0]! : null;
  return (
    <Section title="Handoff">
      <div className="grid gap-1.5">
        <Button variant="outline" size="sm" disabled={!single} onClick={() => void copyCss(editor)}>
          <Copy /> Copy CSS
        </Button>
        <Button variant="outline" size="sm" disabled={single?.type !== "frame"} onClick={() => void copyHtml(editor)}>
          <Code2 /> Copy as HTML and CSS
        </Button>
        {!single && <p className="text-xs text-muted-foreground">Select one shape for CSS, or one frame for HTML.</p>}
        {single && single.type !== "frame" && <p className="text-xs text-muted-foreground">HTML works on frames, with everything inside them.</p>}
      </div>
    </Section>
  );
}

/** Align and distribute for several shapes. */
function AlignRow({ count }: { count: number }) {
  const editor = useEditor();
  const items: Array<[string, ReactNode, () => void, boolean?]> = [
    ["Align left", <AlignStartVertical key="l" />, () => editor.align("left")],
    ["Align horizontal centres", <AlignCenterVertical key="c" />, () => editor.align("hcenter")],
    ["Align right", <AlignEndVertical key="r" />, () => editor.align("right")],
    ["Align top", <AlignStartHorizontal key="t" />, () => editor.align("top")],
    ["Align vertical centres", <AlignCenterHorizontal key="m" />, () => editor.align("vcenter")],
    ["Align bottom", <AlignEndHorizontal key="b" />, () => editor.align("bottom")],
    ["Distribute horizontally", <AlignHorizontalSpaceBetween key="dh" />, () => editor.distribute("x"), count < 3],
    ["Distribute vertically", <AlignVerticalSpaceBetween key="dv" />, () => editor.distribute("y"), count < 3],
  ];
  return (
    <div role="group" aria-label="Align and distribute" className={cn("flex flex-wrap gap-0.5 border-b px-2 py-2")}>
      {items.map(([label, icon, run, disabled]) => (
        <ToolButton key={label} label={label} disabled={disabled} onClick={run}>
          {icon}
        </ToolButton>
      ))}
    </div>
  );
}
