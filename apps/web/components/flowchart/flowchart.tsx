/**
 * A flowchart of boxes and arrows, laid out by itself from left to right, with what's running, done and failed lit up on it. Each thing on it is a button.
 * Built on React Flow and dagre; the Flow tool and Automations use it. What can be edited is opt-in: labels and a + on arrows, + points, a right-click menu,
 * and keys on a focused box.
 */
"use client";

import "@xyflow/react/dist/base.css";

import dagre from "@dagrejs/dagre";
import { Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Loader2, Maximize, Minus, Plus, SkipForward, X, type LucideIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, type ComponentType, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export type FlowchartStatus = "idle" | "running" | "ok" | "warning" | "failed" | "skipped";

export type FlowchartNode = {
  id: string;
  label: string;
  detail?: string;
  /** "box" for things, "circle" for what's done to them, "add" for a + where something can go. A circle shows `label` as its text, so keep it short. */
  shape: "box" | "circle" | "add";
  icon?: ComponentType<{ className?: string }>;
  status: FlowchartStatus;
  /** What a screen reader hears: the whole of what this says, as colours and positions don't reach it. */
  description: string;
  /** Drawn with a dashed border: it's there, but passed over (a step turned off). */
  muted?: boolean;
  /** A line of text under the box. */
  note?: string;
};
export type FlowchartEdge = { from: string; to: string; label?: string; onAdd?: () => void; addLabel?: string };
export type FlowchartMenuItem = { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; destructive?: boolean } | "separator";

const BOX = { width: 176, height: 48 };
const CIRCLE = { width: 44, height: 44 };
const ADD = { width: 28, height: 28 };
const sizeOf = (shape: FlowchartNode["shape"]) => (shape === "circle" ? CIRCLE : shape === "add" ? ADD : BOX);
// Showing everything stops short of making it too small to read: a big chart can be moved around, or zoomed out by hand.
const FIT = { padding: 0.1, maxZoom: 1, minZoom: 0.6 };
const STATUS: Record<Exclude<FlowchartStatus, "idle">, { icon: LucideIcon; className: string; border: string }> = {
  running: { icon: Loader2, className: "animate-spin text-brand-text", border: "border-brand" },
  ok: { icon: Check, className: "text-success", border: "border-success" },
  warning: { icon: AlertTriangle, className: "text-warning", border: "border-warning" },
  failed: { icon: X, className: "text-destructive", border: "border-destructive" },
  skipped: { icon: SkipForward, className: "text-muted-foreground", border: "border-border" },
};

type ChartData = FlowchartNode & { selected: boolean; onSelect: (id: string) => void; menu?: FlowchartMenuItem[]; onKey?: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void };
type ArrowData = { label?: string; onAdd?: () => void; addLabel?: string };

const CONNECTOR = "pointer-events-none !size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

function WithMenu({ items, children }: { items: FlowchartMenuItem[] | undefined; children: ReactNode }) {
  if (!items?.length) return children;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {items.map((item, index) =>
          item === "separator" ? (
            <ContextMenuSeparator key={`separator-${index}`} />
          ) : (
            <ContextMenuItem key={item.label} disabled={item.disabled} variant={item.destructive ? "destructive" : "default"} onSelect={item.onSelect}>
              {item.label}
              {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const ChartNode = memo(function ChartNode({ data }: NodeProps<Node<ChartData>>) {
  const status = data.status === "idle" ? null : STATUS[data.status];
  const Icon = data.icon;
  const StatusIcon = status?.icon;
  // React Flow turns clicks off for a node that can't be selected or dragged, and this button is how it's selected.
  const look = cn("pointer-events-auto relative bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", status?.border, data.selected && "ring-2 ring-ring", data.muted && "border-dashed");
  const common = { type: "button" as const, "data-chart-id": data.id, "aria-label": data.description, title: data.description, onClick: () => data.onSelect(data.id), onKeyDown: data.onKey ? (event: KeyboardEvent<HTMLButtonElement>) => data.onKey!(data.id, event) : undefined };
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={CONNECTOR} />
      {data.shape === "add" ? (
        <button {...common} style={ADD} className={cn(look, "grid place-items-center rounded-full border border-dashed text-muted-foreground hover:text-foreground")}>
          <Plus className="size-3.5" aria-hidden />
        </button>
      ) : data.shape === "circle" ? (
        <WithMenu items={data.menu}>
          <button {...common} aria-pressed={data.selected} style={CIRCLE} className={cn(look, "grid place-items-center rounded-full border-2 text-[11px] font-medium")}>
            {data.label}
            {StatusIcon && (
              <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full border bg-background">
                <StatusIcon className={cn("size-2.5", status.className)} aria-hidden />
              </span>
            )}
          </button>
        </WithMenu>
      ) : (
        <WithMenu items={data.menu}>
          <button {...common} aria-pressed={data.selected} style={BOX} className={cn(look, "flex items-center gap-2 rounded-md border-2 px-2 text-left")}>
            {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-mono text-xs font-medium">{data.label}</span>
              {data.detail && <span className="truncate text-[11px] text-muted-foreground">{data.detail}</span>}
            </span>
            {StatusIcon && <StatusIcon className={cn("size-3.5 shrink-0", status.className)} aria-hidden />}
          </button>
        </WithMenu>
      )}
      {data.note && (
        <span aria-hidden className="absolute top-full left-0 mt-0.5 w-full truncate text-[11px] text-muted-foreground">
          {data.note}
        </span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className={CONNECTOR} />
    </>
  );
});

/** An arrow, with a router's branch name on it, and a + to put a step there. */
function ChartArrow({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<Edge<ArrowData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {(data?.label || data?.onAdd) && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-0.5" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {data.label && <span className="max-w-24 truncate rounded-sm border bg-background px-1 text-[11px] text-muted-foreground">{data.label}</span>}
            {data.onAdd && (
              <button type="button" aria-label={data.addLabel ?? "Add a step here"} title={data.addLabel ?? "Add a step here"} className="grid size-6 place-items-center rounded-full border bg-background text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={data.onAdd}>
                <Plus className="size-3" aria-hidden />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { chart: ChartNode };
const EDGE_TYPES = { chart: ChartArrow };

/** Where everything goes. Only what's connected to what changes this, not a thing's status. Labels and + on arrows need room between the columns. */
function layoutOf(nodes: readonly FlowchartNode[], edges: readonly FlowchartEdge[], gap: number): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 20, ranksep: gap, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  // A copy for each: dagre writes where each thing goes onto what it was given.
  for (const node of nodes) graph.setNode(node.id, { ...sizeOf(node.shape) });
  for (const edge of edges) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);
  const places = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const size = sizeOf(node.shape);
    const place = graph.node(node.id);
    places.set(node.id, { x: place.x - size.width / 2, y: place.y - size.height / 2 });
  }
  return places;
}

function Zoom({ shape }: { shape: string }) {
  const flow = useReactFlow();
  const first = useRef(true);
  // When things are added or removed, everything is shown again.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => void flow.fitView(FIT), 50);
    return () => clearTimeout(timer);
  }, [shape, flow]);
  return (
    <Panel position="top-left" className="flex gap-1">
      <Button size="icon-xs" variant="outline" aria-label="Zoom in" title="Zoom in" onClick={() => void flow.zoomIn()}>
        <Plus />
      </Button>
      <Button size="icon-xs" variant="outline" aria-label="Zoom out" title="Zoom out" onClick={() => void flow.zoomOut()}>
        <Minus />
      </Button>
      <Button size="icon-xs" variant="outline" aria-label="Show everything" title="Show everything" onClick={() => void flow.fitView(FIT)}>
        <Maximize />
      </Button>
    </Panel>
  );
}

export function Flowchart({
  label,
  nodes,
  edges,
  selected,
  onSelect,
  menuFor,
  onNodeKey,
  toolbar,
}: {
  label: string;
  nodes: readonly FlowchartNode[];
  edges: readonly FlowchartEdge[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** A box's right-click menu (the keyboard's menu key opens it too). */
  menuFor?: (id: string) => FlowchartMenuItem[];
  /** Keys pressed on a focused box. */
  onNodeKey?: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  /** More buttons beside the zoom ones. */
  toolbar?: ReactNode;
}) {
  const gap = edges.some((edge) => edge.label) ? 88 : edges.some((edge) => edge.onAdd) ? 56 : 28;
  const shape = JSON.stringify([gap, nodes.map((node) => [node.id, node.shape]), edges.map((edge) => [edge.from, edge.to])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `shape` says when these change in a way that moves anything.
  const places = useMemo(() => layoutOf(nodes, edges, gap), [shape]);
  const statusOf = useMemo(() => new Map(nodes.map((node) => [node.id, node.status])), [nodes]);
  const chartNodes = useMemo<Array<Node<ChartData>>>(
    () =>
      nodes.map((node) => {
        const size = sizeOf(node.shape);
        return { id: node.id, type: "chart", position: places.get(node.id) ?? { x: 0, y: 0 }, width: size.width, height: size.height, data: { ...node, selected: node.id === selected, onSelect, ...(menuFor && node.shape !== "add" ? { menu: menuFor(node.id) } : {}), ...(onNodeKey && node.shape !== "add" ? { onKey: onNodeKey } : {}) } };
      }),
    [nodes, places, selected, onSelect, menuFor, onNodeKey],
  );
  const chartEdges = useMemo<Array<Edge<ArrowData>>>(
    () =>
      edges.map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "chart",
        animated: statusOf.get(edge.to) === "running",
        style: { stroke: "var(--muted-foreground)" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)", width: 16, height: 16 },
        data: { ...(edge.label ? { label: edge.label } : {}), ...(edge.onAdd ? { onAdd: edge.onAdd, addLabel: edge.addLabel } : {}) },
      })),
    [edges, statusOf],
  );
  return (
    <div role="group" aria-label={label} className="cc-flowchart size-full">
      <ReactFlowProvider>
        <ReactFlow nodes={chartNodes} edges={chartEdges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} fitView fitViewOptions={FIT} minZoom={0.2} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}>
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
          <Zoom shape={shape} />
          {toolbar && (
            <Panel position="top-right" className="flex gap-1">
              {toolbar}
            </Panel>
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
