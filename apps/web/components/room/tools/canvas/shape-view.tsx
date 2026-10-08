"use client";

import { useSyncExternalStore } from "react";

import { fontOf, freehandPath, linearPaths, rotationTransform, STICKY_TEXT, textFrame } from "./draw";
import type { Editor } from "./editor";
import { useAtom, useChildIds, useEditor, useShape } from "./hooks";
import { measureAtom } from "./measure";
import type { Shape } from "./shape";
import { alignX, layoutText, lineHeight } from "./text-layout";

const paint = (color: string) => (color === "none" || !color ? "none" : color);

/**
 * The shapes of one parent (null: the canvas), in stacking order. Each child
 * subscribes to its own shape, so a change to one shape re-renders one
 * component, and panning doesn't re-render shapes at all.
 */
export function ShapeLayer({ parentId, locked = false }: { parentId: string | null; locked?: boolean }) {
  const editor = useEditor();
  const ids = useChildIds(editor, parentId);
  return (
    <>
      {ids.map((id) => (
        <ShapeNode key={id} id={id} parentLocked={locked} />
      ))}
    </>
  );
}

function useIsEditing(editor: Editor, id: string) {
  const get = () => editor.editingId.get() === id;
  return useSyncExternalStore(editor.editingId.subscribe, get, get);
}

function ShapeNode({ id, parentLocked }: { id: string; parentLocked: boolean }) {
  const editor = useEditor();
  const shape = useShape(editor, id);
  if (!shape || shape.hidden) return null;
  const locked = parentLocked || shape.locked;
  return (
    <g
      data-shape-id={shape.id}
      opacity={shape.opacity < 1 ? shape.opacity : undefined}
      transform={rotationTransform(shape)}
    >
      <ShapeBody shape={shape} locked={locked} />
    </g>
  );
}

function ShapeBody({ shape, locked }: { shape: Shape; locked: boolean }) {
  const { x, y, w, h } = shape;
  // Locked shapes let clicks through to whatever is under them.
  const pe = locked ? "none" : "all";
  const radius = Math.min(shape.radius, w / 2, h / 2);
  const stroke = shape.stroke !== "none" && shape.strokeWidth > 0 ? { stroke: shape.stroke, strokeWidth: shape.strokeWidth } : {};
  switch (shape.type) {
    case "frame":
      return <FrameBody shape={shape} locked={locked} />;
    case "rect":
      return <rect x={x} y={y} width={w} height={h} rx={radius || undefined} pointerEvents={pe} style={{ fill: paint(shape.fill), ...stroke }} />;
    case "ellipse":
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} pointerEvents={pe} style={{ fill: paint(shape.fill), ...stroke }} />;
    case "sticky":
      return (
        <>
          <rect x={x} y={y} width={w} height={h} rx={radius || 2} pointerEvents={pe} style={{ fill: paint(shape.fill), ...stroke }} />
          <ShapeText shape={shape} />
        </>
      );
    case "text":
      return (
        <>
          <rect x={x} y={y} width={Math.max(w, 4)} height={Math.max(h, 4)} fill="none" pointerEvents={pe} />
          <ShapeText shape={shape} />
        </>
      );
    case "line":
    case "arrow":
      return <LinearBody shape={shape} locked={locked} />;
    case "path":
      return (
        <path
          transform={`translate(${x} ${y})`}
          d={freehandPath(shape.points, shape.strokeWidth)}
          pointerEvents={pe}
          style={{ fill: paint(shape.stroke), stroke: "transparent", strokeWidth: 6 }}
        />
      );
    case "image":
      return shape.src ? (
        <image href={shape.src} x={x} y={y} width={w} height={h} preserveAspectRatio="none" pointerEvents={pe} />
      ) : (
        <rect x={x} y={y} width={w} height={h} pointerEvents={pe} style={{ fill: "var(--muted)" }} />
      );
  }
}

function FrameBody({ shape, locked }: { shape: Shape; locked: boolean }) {
  const editor = useEditor();
  const zoom = useSyncExternalStore(editor.camera.subscribe, () => editor.camera.get().zoom, () => 1);
  const { id, x, y, w, h } = shape;
  const radius = Math.min(shape.radius, w / 2, h / 2) || undefined;
  const clipId = `cc-clip-${id}`;
  const stroke = shape.stroke !== "none" && shape.strokeWidth > 0 ? { stroke: shape.stroke, strokeWidth: shape.strokeWidth } : {};
  return (
    <>
      {!shape.parentId && (
        <text
          x={x}
          y={y - 6 / zoom}
          fontSize={11 / zoom}
          className="fill-muted-foreground font-sans select-none"
          pointerEvents={locked ? "none" : "all"}
          style={{ cursor: "default" }}
        >
          {shape.name}
        </text>
      )}
      <rect data-frame-body="" x={x} y={y} width={w} height={h} rx={radius} pointerEvents={locked ? "none" : "all"} style={{ fill: paint(shape.fill), ...stroke }} />
      <defs>
        <clipPath id={clipId}>
          <rect x={x} y={y} width={w} height={h} rx={radius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <ShapeLayer parentId={id} locked={locked} />
      </g>
    </>
  );
}

function LinearBody({ shape, locked }: { shape: Shape; locked: boolean }) {
  const editor = useEditor();
  const start = useShape(editor, shape.startId);
  const end = useShape(editor, shape.endId);
  const lookup = (id: string) => (id === start?.id ? start : id === end?.id ? end : undefined);
  const { line, head } = linearPaths(shape, lookup);
  const width = shape.strokeWidth;
  return (
    <>
      <path d={line} fill="none" stroke="transparent" strokeWidth={Math.max(12, width + 8)} pointerEvents={locked ? "none" : "stroke"} />
      <path d={line} fill="none" strokeLinecap="round" pointerEvents="none" style={{ stroke: paint(shape.stroke), strokeWidth: width }} />
      {head && (
        <path d={head} strokeLinejoin="round" pointerEvents="none" style={{ fill: paint(shape.stroke), stroke: paint(shape.stroke), strokeWidth: width }} />
      )}
    </>
  );
}

function ShapeText({ shape }: { shape: Shape }) {
  const editor = useEditor();
  const measure = useAtom(measureAtom);
  const editing = useIsEditing(editor, shape.id);
  if (editing || !shape.text) return null;
  const font = fontOf(shape);
  const frame = textFrame(shape);
  const layout = layoutText(shape.text, frame.width, font, measure);
  const { x, anchor } = alignX(shape.textAlign, frame.x, frame.width ?? layout.width);
  const lh = lineHeight(font.size);
  return (
    <text
      fontSize={font.size}
      fontWeight={font.weight}
      textAnchor={anchor}
      dominantBaseline="central"
      pointerEvents="none"
      className={font.family === "note" ? "font-note" : "font-sans"}
      style={{ fill: paint(shape.type === "sticky" ? STICKY_TEXT : shape.fill), whiteSpace: "pre" }}
    >
      {layout.lines.map((line, i) => (
        <tspan key={i} x={x} y={frame.y + i * lh + lh / 2}>
          {line || " "}
        </tspan>
      ))}
    </text>
  );
}
