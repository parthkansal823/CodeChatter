"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cssVar } from "@/lib/css-color";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

import { useDocs } from "./docs-context";
import { DocsHeader } from "./docs-header";
import { buildGraph, fitView, zoomAt, type GraphNode, type View } from "./graph-model";

type SimNode = SimulationNodeDatum & { id: string };
type Point = { x: number; y: number };

// Colours are read from the design tokens and re-read when the theme class changes.
type Palette = { brand: string; foreground: string; muted: string; edge: string; background: string };
let palette: { key: string; value: Palette } | null = null;
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  return () => observer.disconnect();
}
function readPalette(): Palette {
  const key = document.documentElement.className;
  if (palette?.key !== key) {
    palette = {
      key,
      value: { brand: cssVar("--brand"), foreground: cssVar("--foreground"), muted: cssVar("--muted-foreground"), edge: cssVar("--input"), background: cssVar("--background") },
    };
  }
  return palette.value;
}
const SERVER_PALETTE: Palette = { brand: "currentColor", foreground: "currentColor", muted: "currentColor", edge: "currentColor", background: "transparent" };

function useSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

const radius = (node: GraphNode) => 4 + Math.min(6, Math.sqrt(node.degree) * 1.8);

/** Pages and the files they link to, laid out with d3-force. Drag to pan, scroll to zoom, click to open. */
export function GraphView() {
  const docs = useDocs();
  const colors = useSyncExternalStore(subscribeTheme, readPalette, () => SERVER_PALETTE);
  const reduced = usePrefersReducedMotion();
  const graph = useMemo(() => buildGraph(docs.live, docs.files), [docs.live, docs.files]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const { width, height } = useSize(container);
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);

  const simulation = useRef<Simulation<SimNode, undefined> | null>(null);
  const last = useRef<Map<string, Point>>(new Map());
  const size = useRef({ width: 0, height: 0 });
  const touched = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ kind: "pan" | "node"; id?: string; startX: number; startY: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    size.current = { width, height };
  }, [width, height]);

  // Restart the layout only when the graph's shape changes; nodes keep their places.
  useEffect(() => {
    const [ids, pairs] = JSON.parse(graph.key) as [string[], string[]];
    const nodes: SimNode[] = ids.map((id) => ({ id, ...last.current.get(id) }));
    const links = pairs.map((pair) => {
      const [source, target] = pair.split(">");
      return { source: source!, target: target! };
    });
    const sim = forceSimulation(nodes)
      .force("link", forceLink<SimNode, { source: string; target: string }>(links).id((d) => d.id).distance(70).strength(0.5))
      .force("charge", forceManyBody().strength(-240))
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.05))
      .force("collide", forceCollide(20))
      .stop();
    // Settle most of the way up front so the first frame is already readable.
    sim.tick(last.current.size ? 20 : 120);
    let first = true;
    const publish = () => {
      const next = new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
      last.current = next;
      setPositions(next);
      if (first && !touched.current && size.current.width > 0) setView(fitView([...next.values()], size.current.width, size.current.height));
      first = false;
    };
    sim.on("tick", publish);
    const frame = requestAnimationFrame(() => {
      publish();
      if (!reduced) sim.alpha(0.3).restart();
    });
    simulation.current = sim;
    return () => {
      cancelAnimationFrame(frame);
      sim.stop();
      sim.on("tick", null);
    };
  }, [graph.key, reduced]);

  // Fit once the panel has a size, unless the view was already moved by hand.
  useEffect(() => {
    if (touched.current || width === 0 || last.current.size === 0) return;
    const frame = requestAnimationFrame(() => setView(fitView([...last.current.values()], width, height)));
    return () => cancelAnimationFrame(frame);
  }, [width, height]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const rect = element.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [container]);

  const open = (node: GraphNode) => {
    if (node.kind === "file") {
      if (node.fileId) docs.openFile(node.fileId);
    } else docs.openPage(node.id);
  };

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGElement>, id?: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    svg.current?.setPointerCapture(event.pointerId);
    gesture.current = { kind: id ? "node" : "pan", id, startX: event.clientX, startY: event.clientY, view, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    touched.current = true;
    if (g.kind === "pan") return setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    const node = simulation.current?.nodes().find((n) => n.id === g.id);
    if (!node) return;
    const point = toWorld(event.clientX, event.clientY);
    node.fx = point.x;
    node.fy = point.y;
    simulation.current?.alphaTarget(0.3).restart();
  };
  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "node") {
      const node = simulation.current?.nodes().find((n) => n.id === g.id);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      simulation.current?.alphaTarget(0);
      const target = g.id ? byId.get(g.id) : undefined;
      if (!g.moved && target) open(target);
    }
  };

  const zoomBy = (factor: number) => {
    touched.current = true;
    setView((v) => zoomAt(v, factor, width / 2, height / 2));
  };
  const fit = () => {
    touched.current = false;
    setView(fitView([...positions.values()], width, height));
  };

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const edge of graph.edges) {
      if (edge.source === hover) set.add(edge.target);
      if (edge.target === hover) set.add(edge.source);
    }
    return set;
  }, [hover, graph.edges]);

  const pageCount = graph.nodes.filter((n) => n.kind === "page").length;
  const fileCount = graph.nodes.length - pageCount;
  const k = view.k;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DocsHeader>
        <span className="px-1 text-sm font-medium">Graph</span>
        <span className="truncate px-1 text-xs text-muted-foreground">
          {pageCount} {pageCount === 1 ? "page" : "pages"}, {fileCount} linked {fileCount === 1 ? "file" : "files"}
        </span>
      </DocsHeader>
      <div ref={setContainer} className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <svg
          ref={svg}
          width={width}
          height={height}
          role="group"
          aria-label="Graph of pages and the files they link to"
          className="block cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(e) => onPointerDown(e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${k})`}>
            <g>
              {graph.edges.map((edge) => {
                const a = positions.get(edge.source);
                const b = positions.get(edge.target);
                if (!a || !b) return null;
                const lit = hover !== null && (edge.source === hover || edge.target === hover);
                return (
                  <line
                    key={`${edge.source}>${edge.target}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={lit ? colors.foreground : colors.edge}
                    strokeWidth={(lit ? 1.5 : 1) / k}
                    opacity={neighbours && !lit ? 0.35 : 1}
                  />
                );
              })}
            </g>
            {graph.nodes.map((node) => {
              const p = positions.get(node.id);
              if (!p) return null;
              const r = radius(node);
              const current = node.id === docs.currentId;
              const dim = neighbours !== null && !neighbours.has(node.id);
              const fill = current ? colors.brand : node.kind === "page" ? colors.muted : colors.background;
              const stroke = current ? colors.brand : hover === node.id ? colors.foreground : colors.muted;
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x},${p.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${node.kind === "file" ? "file" : "page"} ${node.label}${current ? " (open now)" : ""}`}
                  aria-current={current ? "page" : undefined}
                  opacity={dim ? 0.3 : 1}
                  className="cursor-pointer outline-none"
                  onPointerDown={(e) => onPointerDown(e, node.id)}
                  onPointerEnter={() => setHover(node.id)}
                  onPointerLeave={() => setHover((h) => (h === node.id ? null : h))}
                  onFocus={() => setHover(node.id)}
                  onBlur={() => setHover((h) => (h === node.id ? null : h))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(node);
                    }
                  }}
                >
                  {hover === node.id && <circle r={r + 4 / k} fill="none" stroke={colors.foreground} strokeWidth={1.5 / k} />}
                  {node.kind === "page" ? (
                    <circle r={r} fill={fill} stroke={stroke} strokeWidth={1.5 / k} />
                  ) : (
                    <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2 / k} fill={fill} stroke={stroke} strokeWidth={1.5 / k} />
                  )}
                  <text
                    x={r + 5 / k}
                    dy="0.32em"
                    fontSize={11.5 / k}
                    fontWeight={current ? 600 : 400}
                    fill={dim ? colors.muted : colors.foreground}
                    stroke={colors.background}
                    strokeWidth={3 / k}
                    paintOrder="stroke"
                    className={node.kind === "file" ? "font-mono" : "font-sans"}
                  >
                    {node.icon ? `${node.icon} ${node.label}` : node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            <div className="max-w-xs">
              <p className="font-medium">Nothing to draw yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Create pages and link them with [[ to see how they connect.</p>
            </div>
          </div>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-brand" /> Open page
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-muted-foreground" /> Page
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] border border-muted-foreground" /> File
          </span>
        </div>
        <div className="absolute right-3 bottom-3 flex gap-0.5 rounded-md border bg-background p-0.5">
          <Button variant="ghost" size="icon-xs" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
            <Minus />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Fit graph to view" onClick={fit}>
            <Maximize />
          </Button>
        </div>
      </div>
    </div>
  );
}
