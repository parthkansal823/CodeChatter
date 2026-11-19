/**
 * A flowchart of boxes and arrows, laid out by itself from left to right, with what's running, done and failed lit up on it. Each thing on it is a button.
 * Built on React Flow and dagre; the Flow tool and Automations use it. What can be edited is opt-in: labels and a + on arrows, + points, a right-click menu,
 * keys on a focused box, and notes placed freely beside the boxes (n8n's sticky notes), moved by their top and sized from their corners.
 */
"use client";

import "@xyflow/react/dist/base.css";

import dagre from "@dagrejs/dagre";
import { Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, NodeResizer, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Loader2, Maximize, Minus, Plus, SkipForward, StickyNote, Trash2, X, type LucideIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

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
/** A note placed freely on the chart, in its own coordinates (where the boxes are laid out), as n8n's sticky notes. */
export type FlowchartSticky = { id: string; text: string; x: number; y: number; width: number; height: number };
/** What the chart's owner does with notes; left out, they're shown and can't be changed. */
export type FlowchartStickyActions = { add: (at: { x: number; y: number }) => void; change: (id: string, patch: Partial<Omit<FlowchartSticky, "id">>) => void; remove: (id: string) => void };
export type FlowchartMenuItem = { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; destructive?: boolean } | "separator";

const BOX = { width: 176, height: 48 };
const CIRCLE = { width: 44, height: 44 };
const ADD = { width: 28, height: 28 };
const sizeOf = (shape: FlowchartNode["shape"]) => (shape === "circle" ? CIRCLE : shape === "add" ? ADD : BOX);
// At first, and as it changes, it fits as much as stays readable: a big chart can be moved around. "Show everything" goes as small as it takes.
const FIT = { padding: 0.1, maxZoom: 1, minZoom: 0.75 };
const EVERYTHING = { padding: 0.1, maxZoom: 1, minZoom: 0.2 };
const STATUS: Record<Exclude<FlowchartStatus, "idle">, { icon: LucideIcon; className: string; border: string }> = {
  running: { icon: Loader2, className: "animate-spin text-brand-text", border: "border-brand" },
  ok: { icon: Check, className: "text-success", border: "border-success" },
  warning: { icon: AlertTriangle, className: "text-warning", border: "border-warning" },
  failed: { icon: X, className: "text-destructive", border: "border-destructive" },
  skipped: { icon: SkipForward, className: "text-muted-foreground", border: "border-border" },
};

type ChartData = FlowchartNode & { selected: boolean; onSelect: (id: string, adding?: boolean) => void; onFocused: (id: string) => void; menu?: FlowchartMenuItem[]; onKey?: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void };
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
  const common = { type: "button" as const, "data-chart-id": data.id, "aria-label": data.description, title: data.description, onClick: (event: MouseEvent<HTMLButtonElement>) => data.onSelect(data.id, event.shiftKey || event.ctrlKey || event.metaKey), onFocus: () => data.onFocused(data.id), onKeyDown: data.onKey ? (event: KeyboardEvent<HTMLButtonElement>) => data.onKey!(data.id, event) : undefined };
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

/**
 * An arrow. A router's branch name sits at its end, just before the branch's first box, where branches fanning out from one router don't overlap. A + in its
 * middle puts a step there: faint until pointed at or focused, as one on every arrow would crowd the chart.
 */
function ChartArrow({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data }: EdgeProps<Edge<ArrowData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {(data?.label || data?.onAdd) && (
        <EdgeLabelRenderer>
          {data.label && (
            <span aria-hidden title={data.label} className="absolute max-w-12 truncate text-[11px] leading-none text-muted-foreground" style={{ transform: `translate(-100%, -100%) translate(${targetX - 8}px, ${targetY - 3}px)` }}>
              {data.label}
            </span>
          )}
          {data.onAdd && (
            <button
              type="button"
              aria-label={data.addLabel ?? "Add a step here"}
              title={data.addLabel ?? "Add a step here"}
              className="nodrag nopan pointer-events-auto absolute grid size-6 place-items-center rounded-full border bg-background text-muted-foreground opacity-50 outline-none hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
              onClick={data.onAdd}
            >
              <Plus className="size-3" aria-hidden />
            </button>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

type StickyData = FlowchartSticky & { editable: boolean; selected: boolean; onText?: (text: string) => void; onRemove?: () => void };
const without = <T,>(record: Record<string, T>, id: string) => {
  const next = { ...record };
  delete next[id];
  return next;
};

/** A note on the chart: moved by its top bar, sized from its corners when chosen, its text typed in place. */
const StickyNode = memo(function StickyNode({ data, selected }: NodeProps<Node<StickyData>>) {
  return (
    <div role="note" aria-label={`Note: ${data.text.split("\n")[0] || "empty"}`} className="pointer-events-auto flex size-full flex-col overflow-hidden rounded-md border border-brand/40 bg-brand/10 text-xs shadow-sm">
      {data.editable && <NodeResizer isVisible={selected} minWidth={140} minHeight={72} lineClassName="!border-brand" handleClassName="!size-2 !border-brand !bg-background" />}
      <div className={cn("cc-sticky-handle flex h-6 shrink-0 items-center gap-1 px-2 text-muted-foreground", data.editable && "cursor-move")}>
        <StickyNote className="size-3" aria-hidden />
        <span className="flex-1">Note</span>
        {data.onRemove && (
          <button type="button" aria-label="Remove this note" title="Remove this note" className="nodrag grid size-5 place-items-center rounded-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={data.onRemove}>
            <Trash2 className="size-3" aria-hidden />
          </button>
        )}
      </div>
      {data.onText ? (
        <textarea
          aria-label="The note's text"
          className="nodrag nowheel min-h-0 flex-1 resize-none bg-transparent px-2 pb-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Write something for whoever reads this flow next."
          value={data.text}
          onChange={(event) => data.onText!(event.target.value)}
        />
      ) : (
        <p className="min-h-0 flex-1 overflow-auto px-2 pb-2 whitespace-pre-wrap text-foreground">{data.text}</p>
      )}
    </div>
  );
});

/** "Add a note": under the boxes, clear of them (each new one a little further along), and the chart fits to show it. */
function AddSticky({ onAdd }: { onAdd: (at: { x: number; y: number }) => void }) {
  const flow = useReactFlow();
  return (
    <Button
      size="xs"
      variant="outline"
      title="A note placed freely on the chart, for whoever reads this flow next"
      onClick={() => {
        const nodes = flow.getNodes();
        const boxes = nodes.filter((node) => node.type !== "sticky");
        const notes = nodes.length - boxes.length;
        const left = boxes.length ? Math.min(...boxes.map((node) => node.position.x)) : 0;
        const bottom = boxes.length ? Math.max(...boxes.map((node) => node.position.y + (node.height ?? BOX.height))) : 0;
        onAdd({ x: Math.round(left + notes * 24), y: Math.round(bottom + 32 + notes * 24) });
        setTimeout(() => void flow.fitView(FIT), 100);
      }}
    >
      <StickyNote /> Add a note
    </Button>
  );
}

const NODE_TYPES = { chart: ChartNode, sticky: StickyNode };
const NONE: readonly string[] = [];
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

/** Brings a box into view when it's selected or focused off the edge of the chart, as after adding a step, or moving between boxes with the keys. */
function Follow({ id }: { id: string | null }) {
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (!id) return;
    // After the chart has fitted itself to what changed.
    const timer = setTimeout(() => {
      const node = flow.getNode(id);
      if (!node) return;
      const { x, y, zoom } = flow.getViewport();
      const size = { width: node.width ?? BOX.width, height: node.height ?? BOX.height };
      const left = node.position.x * zoom + x;
      const top = node.position.y * zoom + y;
      const margin = 24;
      if (left >= margin && top >= margin && left + size.width * zoom <= width - margin && top + size.height * zoom <= height - margin) return;
      void flow.setCenter(node.position.x + size.width / 2, node.position.y + size.height / 2, { zoom, duration: 150 });
    }, 120);
    return () => clearTimeout(timer);
  }, [id, flow, width, height]);
  return null;
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
      <Button size="icon-xs" variant="outline" aria-label="Show everything" title="Show everything" onClick={() => void flow.fitView(EVERYTHING)}>
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
  chosen = NONE,
  menuFor,
  onNodeKey,
  toolbar,
  stickies = [],
  stickyActions = null,
}: {
  label: string;
  nodes: readonly FlowchartNode[];
  edges: readonly FlowchartEdge[];
  selected: string | null;
  /** A click on a box; `adding` when Shift, Ctrl or Cmd was held, to choose it with others. */
  onSelect: (id: string, adding?: boolean) => void;
  /** Boxes chosen together, drawn as the one selected is. */
  chosen?: readonly string[];
  /** A box's right-click menu (the keyboard's menu key opens it too). */
  menuFor?: (id: string) => FlowchartMenuItem[];
  /** Keys pressed on a focused box. */
  onNodeKey?: (id: string, event: KeyboardEvent<HTMLButtonElement>) => void;
  /** More buttons beside the zoom ones. */
  toolbar?: ReactNode;
  /** Notes placed freely on the chart, and what can be done with them. */
  stickies?: readonly FlowchartSticky[];
  stickyActions?: FlowchartStickyActions | null;
}) {
  const gap = edges.some((edge) => edge.label || edge.onAdd) ? 56 : 28;
  const [focused, setFocused] = useState<string | null>(null);
  const shape = JSON.stringify([gap, nodes.map((node) => [node.id, node.shape]), edges.map((edge) => [edge.from, edge.to])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `shape` says when these change in a way that moves anything.
  const places = useMemo(() => layoutOf(nodes, edges, gap), [shape]);
  const statusOf = useMemo(() => new Map(nodes.map((node) => [node.id, node.status])), [nodes]);
  const chartNodes = useMemo<Array<Node<ChartData>>>(
    () =>
      nodes.map((node) => {
        const size = sizeOf(node.shape);
        return { id: node.id, type: "chart", position: places.get(node.id) ?? { x: 0, y: 0 }, width: size.width, height: size.height, data: { ...node, selected: node.id === selected || chosen.includes(node.id), onSelect, onFocused: setFocused, ...(menuFor && node.shape !== "add" ? { menu: menuFor(node.id) } : {}), ...(onNodeKey && node.shape !== "add" ? { onKey: onNodeKey } : {}) } };
      }),
    [nodes, places, selected, chosen, onSelect, menuFor, onNodeKey],
  );
  // A note being moved or sized goes where the pointer is until it's let go, when its place is kept (stickyActions.change).
  const [moving, setMoving] = useState<Record<string, Partial<Omit<FlowchartSticky, "id" | "text">>>>({});
  const [chosenSticky, setChosenSticky] = useState<string | null>(null);
  const stickyNodes = useMemo<Array<Node<StickyData>>>(
    () =>
      stickies.map((sticky) => {
        const box = { ...sticky, ...moving[sticky.id] };
        return {
          id: sticky.id,
          type: "sticky",
          position: { x: box.x, y: box.y },
          width: box.width,
          height: box.height,
          zIndex: -1,
          draggable: Boolean(stickyActions),
          selectable: Boolean(stickyActions),
          selected: chosenSticky === sticky.id,
          dragHandle: ".cc-sticky-handle",
          data: { ...sticky, editable: Boolean(stickyActions), selected: chosenSticky === sticky.id, ...(stickyActions && { onText: (text: string) => stickyActions.change(sticky.id, { text }), onRemove: () => stickyActions.remove(sticky.id) }) },
        };
      }),
    [stickies, moving, chosenSticky, stickyActions],
  );
  const allNodes = useMemo(() => (stickyNodes.length ? ([...stickyNodes, ...chartNodes] as Node[]) : chartNodes), [stickyNodes, chartNodes]);
  const onNodesChange = (changes: NodeChange[]) => {
    if (!stickyActions) return;
    for (const change of changes) {
      if (change.type === "select" && stickies.some((sticky) => sticky.id === change.id)) {
        if (change.selected) setChosenSticky(change.id);
        else setChosenSticky((current) => (current === change.id ? null : current));
      }
      if (change.type === "position" && change.position && stickies.some((sticky) => sticky.id === change.id)) {
        const place = { x: Math.round(change.position.x), y: Math.round(change.position.y) };
        if (change.dragging === false) {
          stickyActions.change(change.id, place);
          setMoving((current) => without(current, change.id));
        } else setMoving((current) => ({ ...current, [change.id]: { ...current[change.id], ...place } }));
      }
      if (change.type === "dimensions" && change.dimensions && stickies.some((sticky) => sticky.id === change.id) && change.resizing !== undefined) {
        const size = { width: Math.round(change.dimensions.width), height: Math.round(change.dimensions.height) };
        if (change.resizing === false) {
          const sized = moving[change.id] ?? {};
          stickyActions.change(change.id, { ...size, ...(sized.x !== undefined && { x: sized.x, y: sized.y }) });
          setMoving((current) => without(current, change.id));
        } else setMoving((current) => ({ ...current, [change.id]: { ...current[change.id], ...size } }));
      }
    }
  };
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
        <ReactFlow nodes={allNodes} edges={chartEdges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} onNodesChange={stickyActions ? onNodesChange : undefined} onPaneClick={stickyActions ? () => setChosenSticky(null) : undefined} fitView fitViewOptions={FIT} minZoom={0.2} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable={false} edgesFocusable={false} disableKeyboardA11y deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}>
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
          <Zoom shape={shape} />
          <Follow id={selected} />
          <Follow id={focused} />
          {(toolbar || stickyActions) && (
            <Panel position="top-right" className="flex gap-1">
              {stickyActions && <AddSticky onAdd={stickyActions.add} />}
              {toolbar}
            </Panel>
          )}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
