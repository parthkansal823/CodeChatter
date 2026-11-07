/** A flowchart of boxes and arrows, laid out by itself from left to right, with what's running, done and failed lit up on it. Each thing on it is a button. Built on React Flow and dagre; the Flow tool uses it, and Pipelines and Automations are to. */
"use client";

import "@xyflow/react/dist/base.css";

import dagre from "@dagrejs/dagre";
import { Background, BackgroundVariant, Handle, MarkerType, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Loader2, Maximize, Minus, Plus, SkipForward, X, type LucideIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, type ComponentType } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FlowchartStatus = "idle" | "running" | "ok" | "warning" | "failed" | "skipped";

export type FlowchartNode = {
  id: string;
  label: string;
  detail?: string;
  /** "box" for things, "circle" for what's done to them. A circle shows `label` as its text, so keep it short. */
  shape: "box" | "circle";
  icon?: ComponentType<{ className?: string }>;
  status: FlowchartStatus;
  /** What a screen reader hears: the whole of what this says, as colours and positions don't reach it. */
  description: string;
};
export type FlowchartEdge = { from: string; to: string };

const BOX = { width: 176, height: 48 };
const CIRCLE = { width: 44, height: 44 };
// Showing everything stops short of making it too small to read: a big chart can be moved around, or zoomed out by hand.
const FIT = { padding: 0.1, maxZoom: 1, minZoom: 0.6 };
const STATUS: Record<Exclude<FlowchartStatus, "idle">, { icon: LucideIcon; className: string; border: string }> = {
  running: { icon: Loader2, className: "animate-spin text-brand-text", border: "border-brand" },
  ok: { icon: Check, className: "text-success", border: "border-success" },
  warning: { icon: AlertTriangle, className: "text-warning", border: "border-warning" },
  failed: { icon: X, className: "text-destructive", border: "border-destructive" },
  skipped: { icon: SkipForward, className: "text-muted-foreground", border: "border-border" },
};

type ChartData = FlowchartNode & { selected: boolean; onSelect: (id: string) => void };

const CONNECTOR = "pointer-events-none !size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

const ChartNode = memo(function ChartNode({ data }: NodeProps<Node<ChartData>>) {
  const status = data.status === "idle" ? null : STATUS[data.status];
  const Icon = data.icon;
  const StatusIcon = status?.icon;
  // React Flow turns clicks off for a node that can't be selected or dragged, and this button is how it's selected.
  const look = cn("pointer-events-auto relative bg-background outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", status?.border, data.selected && "ring-2 ring-ring");
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className={CONNECTOR} />
      {data.shape === "circle" ? (
        <button type="button" aria-pressed={data.selected} aria-label={data.description} title={data.description} style={CIRCLE} className={cn(look, "grid place-items-center rounded-full border-2 text-[11px] font-medium")} onClick={() => data.onSelect(data.id)}>
          {data.label}
          {StatusIcon && (
            <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full border bg-background">
              <StatusIcon className={cn("size-2.5", status.className)} aria-hidden />
            </span>
          )}
        </button>
      ) : (
        <button type="button" aria-pressed={data.selected} aria-label={data.description} title={data.description} style={BOX} className={cn(look, "flex items-center gap-2 rounded-md border-2 px-2 text-left")} onClick={() => data.onSelect(data.id)}>
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-mono text-xs font-medium">{data.label}</span>
            {data.detail && <span className="truncate text-[11px] text-muted-foreground">{data.detail}</span>}
          </span>
          {StatusIcon && <StatusIcon className={cn("size-3.5 shrink-0", status.className)} aria-hidden />}
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} className={CONNECTOR} />
    </>
  );
});

const NODE_TYPES = { chart: ChartNode };

/** Where everything goes. Only what's connected to what changes this, not a thing's status. */
function layoutOf(nodes: readonly FlowchartNode[], edges: readonly FlowchartEdge[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 20, ranksep: 28, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  // A copy for each: dagre writes where each thing goes onto what it was given.
  for (const node of nodes) graph.setNode(node.id, { ...(node.shape === "circle" ? CIRCLE : BOX) });
  for (const edge of edges) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);
  const places = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const size = node.shape === "circle" ? CIRCLE : BOX;
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

export function Flowchart({ label, nodes, edges, selected, onSelect }: { label: string; nodes: readonly FlowchartNode[]; edges: readonly FlowchartEdge[]; selected: string | null; onSelect: (id: string) => void }) {
  const shape = JSON.stringify([nodes.map((node) => [node.id, node.shape]), edges.map((edge) => [edge.from, edge.to])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `shape` says when these change in a way that moves anything.
  const places = useMemo(() => layoutOf(nodes, edges), [shape]);
  const statusOf = useMemo(() => new Map(nodes.map((node) => [node.id, node.status])), [nodes]);
  const chartNodes = useMemo<Array<Node<ChartData>>>(
    () =>
      nodes.map((node) => {
        const size = node.shape === "circle" ? CIRCLE : BOX;
        return { id: node.id, type: "chart", position: places.get(node.id) ?? { x: 0, y: 0 }, width: size.width, height: size.height, data: { ...node, selected: node.id === selected, onSelect } };
      }),
    [nodes, places, selected, onSelect],
  );
  const chartEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        animated: statusOf.get(edge.to) === "running",
        style: { stroke: "var(--muted-foreground)" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)", width: 16, height: 16 },
      })),
    [edges, statusOf],
  );
  return (
    <div role="group" aria-label={label} className="cc-flowchart size-full">
      <ReactFlowProvider>
        <ReactFlow nodes={chartNodes} edges={chartEdges} nodeTypes={NODE_TYPES} fitView fitViewOptions={FIT} minZoom={0.2} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}>
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
          <Zoom shape={shape} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
