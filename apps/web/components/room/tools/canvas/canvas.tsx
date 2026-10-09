"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { insertImage } from "./clipboard-io";
import { useAtom, useChildIds, useSession } from "./hooks";
import type { Hit, HandleId, PointerInfo } from "./interaction";
import { DraftStroke, GestureOverlay, PresenceLayer, SelectionOverlay } from "./overlay";
import { hasText } from "./shape";
import { ShapeLayer } from "./shape-view";
import { TextEditor } from "./text-editor";

type Touch = { x: number; y: number };

/** Where the eraser looks around the pointer: its centre and four points 5px out. */
const ERASER_RING = [
  [0, 0],
  [5, 0],
  [-5, 0],
  [0, 5],
  [0, -5],
] as const;

function hitOf(target: EventTarget | null): Hit {
  const el = target instanceof Element ? target : null;
  const handle = el?.closest("[data-handle]")?.getAttribute("data-handle") as HandleId | null | undefined;
  const shapeEl = el?.closest("[data-shape-id]");
  return {
    shapeId: shapeEl?.getAttribute("data-shape-id") ?? null,
    frameBody: !!el?.hasAttribute("data-frame-body"),
    handle: handle ?? null,
  };
}

/**
 * The infinite canvas: an SVG whose one camera transform holds every shape,
 * with overlays (selection, guides, other people) drawn in screen space on
 * top. Pan with Space or the middle button or a two-finger scroll, zoom with
 * Ctrl/⌘ + scroll or a pinch.
 */
export function Canvas({ empty, label }: { empty?: ReactNode; label: string }) {
  const session = useSession();
  const { editor, interaction } = session;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const touches = useRef(new Map<number, Touch>());
  const pinch = useRef<{ distance: number; mid: Touch; zoom: number } | null>(null);
  const cam = useAtom(editor.camera);
  const tool = useAtom(editor.tool);
  const spacePan = useAtom(editor.spacePan);
  const readOnly = useAtom(editor.readOnly);
  const empty0 = useChildIds(editor, null).length === 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      editor.viewport.set({ w: el.clientWidth, h: el.clientHeight });
      session.placeCamera();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [editor, session]);

  // The eraser asks what lies under points the pointer passed between events, a few pixels around each.
  useEffect(() => {
    interaction.setProbe((screen) => {
      const svg = svgRef.current;
      if (!svg) return [];
      const rect = svg.getBoundingClientRect();
      const ids = new Set<string>();
      for (const [dx, dy] of ERASER_RING) {
        for (const el of document.elementsFromPoint(rect.left + screen.x + dx, rect.top + screen.y + dy)) {
          if (!svg.contains(el)) continue;
          const id = el.closest("[data-shape-id]")?.getAttribute("data-shape-id");
          if (id) ids.add(id);
        }
      }
      return [...ids];
    });
    return () => interaction.setProbe(null);
  }, [interaction]);

  // React's wheel listener is passive; zooming must stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const rect = el.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(Math.max(-1, Math.min(1, -e.deltaY * unit * 0.01)));
        editor.zoomAt(at, editor.camera.get().zoom * factor);
      } else if (e.shiftKey && !e.deltaX) editor.panBy(-e.deltaY * unit, 0);
      else editor.panBy(-e.deltaX * unit, -e.deltaY * unit);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [editor]);

  const info = (e: ReactPointerEvent | PointerEvent): PointerInfo => {
    const rect = svgRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return {
      screen,
      world: editor.screenToWorld(screen),
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      pressure: e.pointerType === "pen" ? e.pressure : 0.5,
      hit: hitOf(e.target),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    containerRef.current?.focus({ preventScroll: true });
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        interaction.cancel();
        const [a, b] = [...touches.current.values()] as [Touch, Touch];
        pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom: editor.camera.get().zoom };
        return;
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1) e.preventDefault();
    interaction.down(info(e), spacePan);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const p = pinch.current;
      if (p && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()] as [Touch, Touch];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = svgRef.current!.getBoundingClientRect();
        editor.panBy(mid.x - p.mid.x, mid.y - p.mid.y);
        editor.zoomAt({ x: mid.x - rect.left, y: mid.y - rect.top }, (p.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, p.distance));
        p.mid = mid;
        return;
      }
    }
    const pointer = info(e);
    session.setCursor(pointer.world);
    if (!interaction.busy) editor.hoverId.set(tool === "select" ? pointer.hit.shapeId : null);
    interaction.move(pointer);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) pinch.current = null;
        return;
      }
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    interaction.up(info(e));
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const hit = hitOf(e.target);
    const shape = hit.shapeId ? editor.get(hit.shapeId) : undefined;
    if (shape && hasText(shape.type)) return editor.startEditing(shape.id);
    // On a whiteboard, double-clicking empty space starts typing there, in the chosen ink (notes have their own tool).
    if (!shape && editor.kind === "board") {
      const rect = svgRef.current!.getBoundingClientRect();
      const at = editor.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      let id = "";
      editor.beginGesture();
      editor.write(() => {
        id = editor.create("text", { x: at.x, y: at.y, fill: editor.style.get().ink });
      });
      editor.selection.set([id]);
      editor.editingId.set(id);
    }
  };

  const cursor = spacePan || tool === "hand" ? "grab" : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";
  const grid = 24 * cam.zoom;
  const showGrid = grid >= 8;

  return (
    <div
      ref={containerRef}
      data-canvas=""
      tabIndex={0}
      aria-label={label}
      className="relative h-full w-full overflow-hidden bg-chrome outline-none focus-visible:outline-none"
      onDragOver={(e) => {
        if (!readOnly && [...e.dataTransfer.items].some((item) => item.type.startsWith("image/"))) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (!file || readOnly) return;
        e.preventDefault();
        const rect = svgRef.current!.getBoundingClientRect();
        void insertImage(editor, file, editor.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
      }}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 size-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          pinch.current = null;
          interaction.cancel();
        }}
        onPointerLeave={() => {
          session.setCursor(null);
          editor.hoverId.set(null);
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {showGrid && (
          <>
            <defs>
              <pattern id="cc-canvas-grid" width={grid} height={grid} patternUnits="userSpaceOnUse" x={cam.x % grid} y={cam.y % grid}>
                <circle cx={1} cy={1} r={1} className="fill-border" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cc-canvas-grid)" pointerEvents="none" />
          </>
        )}
        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.zoom})`}>
          <ShapeLayer parentId={null} />
          <DraftStroke />
        </g>
        <SelectionOverlay />
        <GestureOverlay />
        <PresenceLayer />
      </svg>
      <TextEditor />
      {empty0 && empty}
    </div>
  );
}
