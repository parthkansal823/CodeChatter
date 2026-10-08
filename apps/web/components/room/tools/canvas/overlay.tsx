"use client";

import { presenceSoftVar, presenceVar } from "@/components/presence/presence";

import { freehandPath, linearEnds, shapeBounds } from "./draw";
import type { Camera } from "./editor";
import { HANDLES, unionRects, type Handle, type Rect } from "./geometry";
import { useAllShapes, useAtom, useEditor, useSession } from "./hooks";
import { measureAtom } from "./measure";
import { isLinear, type Shape } from "./shape";

const BRAND = "var(--brand)";
const HANDLE = 8;

const CURSORS: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

const toScreen = (r: Rect, cam: Camera): Rect => ({ x: r.x * cam.zoom + cam.x, y: r.y * cam.zoom + cam.y, w: r.w * cam.zoom, h: r.h * cam.zoom });

/** One shape's outline in screen space: its line for lines, its (rotated) box for everything else. */
function Outline({ shape, all, cam, color, width = 1.5 }: { shape: Shape; all: ReadonlyMap<string, Shape>; cam: Camera; color: string; width?: number }) {
  const lookup = (id: string) => all.get(id);
  if (isLinear(shape.type)) {
    const [a, b] = linearEnds(shape, lookup);
    return (
      <line
        x1={a.x * cam.zoom + cam.x}
        y1={a.y * cam.zoom + cam.y}
        x2={b.x * cam.zoom + cam.x}
        y2={b.y * cam.zoom + cam.y}
        style={{ stroke: color, strokeWidth: width }}
      />
    );
  }
  const r = toScreen(shapeBounds(shape, lookup), cam);
  const transform = shape.rotation ? `rotate(${shape.rotation} ${r.x + r.w / 2} ${r.y + r.h / 2})` : undefined;
  return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" transform={transform} style={{ stroke: color, strokeWidth: width }} />;
}

/** Your selection: outlines, the bounding box with resize handles, and its size. */
export function SelectionOverlay() {
  const editor = useEditor();
  const ids = useAtom(editor.selection);
  const cam = useAtom(editor.camera);
  const all = useAllShapes(editor);
  const tool = useAtom(editor.tool);
  const editing = useAtom(editor.editingId);
  const readOnly = useAtom(editor.readOnly);
  const hoverId = useAtom(editor.hoverId);
  const target = useAtom(editor.target);
  const hover = hoverId && !ids.includes(hoverId) ? all.get(hoverId) : undefined;
  const targetShape = target ? all.get(target) : undefined;
  const shapes = ids.map((id) => all.get(id)).filter((s): s is Shape => Boolean(s));
  const lookup = (id: string) => all.get(id);
  const bounds = unionRects(shapes.map((s) => toScreen(shapeBounds(s, lookup), cam)));
  const editable = !readOnly && tool === "select" && !editing && shapes.some((s) => !s.locked);
  const single = shapes.length === 1 ? shapes[0]! : null;
  const linear = single && isLinear(single.type) ? linearEnds(single, lookup) : null;
  const world = shapes.length ? unionRects(shapes.map((s) => shapeBounds(s, lookup))) : null;

  return (
    <g pointerEvents="none">
      {hover && !hover.hidden && tool === "select" && <Outline shape={hover} all={all} cam={cam} color={BRAND} width={1} />}
      {targetShape && <Outline shape={targetShape} all={all} cam={cam} color={BRAND} width={2} />}
      {shapes.map((shape) => (
        <Outline key={shape.id} shape={shape} all={all} cam={cam} color={BRAND} />
      ))}
      {bounds && shapes.length > 1 && (
        <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} fill="none" style={{ stroke: BRAND, strokeWidth: 1 }} />
      )}
      {bounds && editable && !linear &&
        HANDLES.map((handle) => {
          const x = handle.includes("w") ? bounds.x : handle.includes("e") ? bounds.x + bounds.w : bounds.x + bounds.w / 2;
          const y = handle.includes("n") ? bounds.y : handle.includes("s") ? bounds.y + bounds.h : bounds.y + bounds.h / 2;
          // Edge handles on a thin box would sit on top of the corners.
          if ((handle === "n" || handle === "s") && bounds.w < HANDLE * 3) return null;
          if ((handle === "e" || handle === "w") && bounds.h < HANDLE * 3) return null;
          return (
            <rect
              key={handle}
              data-handle={handle}
              x={x - HANDLE / 2}
              y={y - HANDLE / 2}
              width={HANDLE}
              height={HANDLE}
              rx={1.5}
              pointerEvents="all"
              style={{ fill: "var(--background)", stroke: BRAND, strokeWidth: 1.5, cursor: CURSORS[handle] }}
            />
          );
        })}
      {linear && editable &&
        (["start", "end"] as const).map((which, i) => {
          const p = linear[i]!;
          return (
            <circle
              key={which}
              data-handle={which}
              cx={p.x * cam.zoom + cam.x}
              cy={p.y * cam.zoom + cam.y}
              r={5}
              pointerEvents="all"
              style={{ fill: "var(--background)", stroke: BRAND, strokeWidth: 1.5, cursor: "crosshair" }}
            />
          );
        })}
      {bounds && world && editor.kind === "design" && !editing && <SizeLabel bounds={bounds} w={world.w} h={world.h} />}
    </g>
  );
}

function SizeLabel({ bounds, w, h }: { bounds: Rect; w: number; h: number }) {
  const measure = useAtom(measureAtom);
  const text = `${Math.round(w)} × ${Math.round(h)}`;
  const width = measure(text, { size: 11, weight: 500, family: "sans" }) + 10;
  const x = bounds.x + bounds.w / 2 - width / 2;
  const y = bounds.y + bounds.h + 8;
  return (
    <g>
      <rect x={x} y={y} width={width} height={18} rx={4} style={{ fill: BRAND }} />
      <text x={x + width / 2} y={y + 9} fontSize={11} fontWeight={500} textAnchor="middle" dominantBaseline="central" className="font-sans" style={{ fill: "var(--brand-foreground)" }}>
        {text}
      </text>
    </g>
  );
}

/** The marquee, snap guides and a pen stroke in progress. */
export function GestureOverlay() {
  const editor = useEditor();
  const cam = useAtom(editor.camera);
  const marquee = useAtom(editor.marquee);
  const guides = useAtom(editor.guides);
  const m = marquee ? toScreen(marquee, cam) : null;
  return (
    <g pointerEvents="none">
      {m && <rect x={m.x} y={m.y} width={m.w} height={m.h} style={{ fill: "var(--brand-muted)", stroke: BRAND, strokeWidth: 1 }} />}
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <line key={i} x1={g.at * cam.zoom + cam.x} x2={g.at * cam.zoom + cam.x} y1={g.from * cam.zoom + cam.y} y2={g.to * cam.zoom + cam.y} style={{ stroke: BRAND, strokeWidth: 1 }} />
        ) : (
          <line key={i} y1={g.at * cam.zoom + cam.y} y2={g.at * cam.zoom + cam.y} x1={g.from * cam.zoom + cam.x} x2={g.to * cam.zoom + cam.x} style={{ stroke: BRAND, strokeWidth: 1 }} />
        ),
      )}
    </g>
  );
}

/** The pen stroke being drawn, in canvas coordinates (inside the camera group). */
export function DraftStroke() {
  const editor = useEditor();
  const draft = useAtom(editor.draft);
  if (!draft) return null;
  return <path d={freehandPath(draft.points, draft.strokeWidth)} pointerEvents="none" style={{ fill: draft.stroke }} />;
}

/** Everyone else: their selections and cursors with name flags, in their presence colour. */
export function PresenceLayer() {
  const session = useSession();
  const editor = session.editor;
  const peers = useAtom(session.peers);
  const cam = useAtom(editor.camera);
  const all = useAllShapes(editor);
  const measure = useAtom(measureAtom);
  return (
    <g pointerEvents="none">
      {peers.map((peer) => {
        const color = presenceVar(peer.user.slot);
        const cursor = peer.cursor ? { x: peer.cursor.x * cam.zoom + cam.x, y: peer.cursor.y * cam.zoom + cam.y } : null;
        const name = peer.user.name;
        const flagWidth = measure(name, { size: 11, weight: 500, family: "sans" }) + 12;
        return (
          <g key={peer.clientId} data-peer={peer.user.name}>
            {peer.selection.map((id) => {
              const shape = all.get(id);
              return shape && !shape.hidden ? <Outline key={id} shape={shape} all={all} cam={cam} color={color} /> : null;
            })}
            {cursor && (
              <g transform={`translate(${cursor.x} ${cursor.y})`} data-cursor={peer.user.name}>
                <path d="M0 0 L0 16 L4.5 12 L7.5 18.5 L10 17.4 L7.1 11 L13 11 Z" style={{ fill: color, stroke: "var(--background)", strokeWidth: 1.2 }} />
                <rect x={12} y={18} width={flagWidth} height={18} rx={4} style={{ fill: presenceSoftVar(peer.user.slot) }} />
                <text x={18} y={27} fontSize={11} fontWeight={500} dominantBaseline="central" className="font-sans" style={{ fill: "var(--brand-foreground)" }}>
                  {name}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
