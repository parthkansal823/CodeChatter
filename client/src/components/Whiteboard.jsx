import { useState } from "react";
import { Tldraw, useEditor, useValue, exportAs } from "tldraw";
import { DefaultColorStyle, DefaultSizeStyle, DefaultFillStyle } from "@tldraw/tlschema";
import "tldraw/tldraw.css";
import {
  ArrowLeft, Download, Pen, Eraser, Undo2, Redo2, Trash2,
  MousePointer2, Hand, ArrowUpRight, Type, Square, Minus,
  Save, FolderOpen, ZoomIn, ZoomOut, Grid3x3, Maximize2, StickyNote,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  { hex: "#ef4444", tldraw: "red",    label: "Red"    },
  { hex: "#f97316", tldraw: "orange", label: "Orange" },
  { hex: "#eab308", tldraw: "yellow", label: "Yellow" },
  { hex: "#22c55e", tldraw: "green",  label: "Green"  },
  { hex: "#3b82f6", tldraw: "blue",   label: "Blue"   },
  { hex: "#8b5cf6", tldraw: "violet", label: "Violet" },
  { hex: "#6b7280", tldraw: "grey",   label: "Grey"   },
  { hex: "#000000", tldraw: "black",  label: "Black"  },
];

const TOOL_GROUPS = [
  [
    { id: "select", icon: MousePointer2, label: "Select (V)" },
    { id: "hand",   icon: Hand,          label: "Pan (H)"    },
  ],
  [
    { id: "draw",   icon: Pen,           label: "Draw (D)"   },
    { id: "eraser", icon: Eraser,        label: "Eraser (E)" },
  ],
  [
    { id: "arrow",  icon: ArrowUpRight,  label: "Arrow (A)"  },
    { id: "line",   icon: Minus,         label: "Line"       },
    { id: "geo",    icon: Square,        label: "Shape (R)"  },
    { id: "text",   icon: Type,          label: "Text (T)"   },
    { id: "note",   icon: StickyNote,    label: "Note (N)"   },
  ],
];

const SIZES = [
  { val: "s",  px: 3  },
  { val: "m",  px: 5  },
  { val: "l",  px: 8  },
  { val: "xl", px: 11 },
];

// ─── WhiteboardUI (must be inside <Tldraw>) ───────────────────────────────────

function WhiteboardUI({ onBack }) {
  const editor = useEditor();

  const [activeTool,  setActiveTool]  = useState("draw");
  const [activeSize,  setActiveSize]  = useState("m");
  const [activeColor, setActiveColor] = useState("#8b5cf6");
  const [activeFill,  setActiveFill]  = useState("none");
  const [showExport,  setShowExport]  = useState(false);

  // Reactive values from the tldraw store
  const zoom    = useValue("zoom",    () => Math.round(editor.getZoomLevel() * 100), [editor]);
  const canUndo = useValue("canUndo", () => editor.getCanUndo(),                      [editor]);
  const canRedo = useValue("canRedo", () => editor.getCanRedo(),                      [editor]);
  const isGrid  = useValue("grid",   () => editor.getInstanceState().isGridMode,      [editor]);

  // ── Tool / style setters ──────────────────────────────────────────────────

  const setTool = (id) => {
    editor.setCurrentTool(id);
    setActiveTool(id);
  };

  const setColor = (c) => {
    setActiveColor(c.hex);
    editor.setStyleForNextShapes(DefaultColorStyle, c.tldraw);
  };

  const setSize = (val) => {
    setActiveSize(val);
    editor.setStyleForNextShapes(DefaultSizeStyle, val);
  };

  const setFill = (val) => {
    setActiveFill(val);
    try { editor.setStyleForNextShapes(DefaultFillStyle, val); } catch { /* not all tools support fill */ }
  };

  // ── Canvas actions ────────────────────────────────────────────────────────

  const toggleGrid = () => editor.updateInstanceState({ isGridMode: !isGrid });

  const fitView = () => {
    const ids = editor.getCurrentPageShapeIds();
    if (ids.size > 0) editor.zoomToFit();
    else editor.resetZoom();
  };

  const handleExport = async (format) => {
    const ids = editor.getCurrentPageShapeIds();
    if (ids.size === 0) return;
    await exportAs(editor, [...ids], { format });
    setShowExport(false);
  };

  const saveBoard = () => {
    const data = editor.getSnapshot();
    localStorage.setItem("cc-wb-snapshot", JSON.stringify(data));
  };

  const loadBoard = () => {
    const raw = localStorage.getItem("cc-wb-snapshot");
    if (raw) try { editor.loadSnapshot(JSON.parse(raw)); } catch { /* ignore */ }
  };

  const clearBoard = () => {
    editor.selectAll();
    editor.deleteShapes(editor.getSelectedShapeIds());
  };

  // ── Style helpers ─────────────────────────────────────────────────────────

  const topBtn = (active = false) =>
    `flex items-center justify-center rounded-md transition-all ${
      active
        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    }`;

  const sideBtn = (active = false) =>
    `flex w-9 items-center justify-center rounded-lg transition-all ${
      active
        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    }`;

  return (
    <>
      {/* ═══ Top Bar ═══════════════════════════════════════════════════════ */}
      <div className="pointer-events-auto absolute left-0 right-0 top-0 z-[300] flex h-10 items-center gap-0.5 border-b border-white/[0.07] bg-zinc-950/96 px-1.5 backdrop-blur-sm">

        {/* Back + title */}
        <button onClick={onBack} className={`${topBtn()} h-8 w-8`} title="Back to room">
          <ArrowLeft size={14} />
        </button>
        <span className="mr-1.5 select-none text-[11px] font-semibold text-zinc-300">Board</span>

        <div className="mx-1 h-4 w-px bg-white/[0.08]" />

        {/* Undo / Redo */}
        <button
          onClick={() => editor.undo()}
          disabled={!canUndo}
          className={`${topBtn()} h-8 w-8 disabled:cursor-not-allowed disabled:opacity-30`}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>
        <button
          onClick={() => editor.redo()}
          disabled={!canRedo}
          className={`${topBtn()} h-8 w-8 disabled:cursor-not-allowed disabled:opacity-30`}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 size={13} />
        </button>

        <div className="mx-1 h-4 w-px bg-white/[0.08]" />

        {/* Grid toggle */}
        <button
          onClick={toggleGrid}
          className={`${topBtn(isGrid)} h-8 w-8`}
          title={isGrid ? "Hide grid" : "Show grid"}
        >
          <Grid3x3 size={13} />
        </button>

        {/* Fit to content */}
        <button onClick={fitView} className={`${topBtn()} h-8 w-8`} title="Fit to content">
          <Maximize2 size={13} />
        </button>

        <div className="mx-1 h-4 w-px bg-white/[0.08]" />

        {/* Zoom controls */}
        <button onClick={() => editor.zoomOut()} className={`${topBtn()} h-7 w-7`} title="Zoom out">
          <ZoomOut size={12} />
        </button>
        <button
          onClick={() => editor.resetZoom()}
          className="w-10 rounded px-1 text-center font-mono text-[10px] font-semibold text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Reset zoom (100%)"
        >
          {zoom}%
        </button>
        <button onClick={() => editor.zoomIn()} className={`${topBtn()} h-7 w-7`} title="Zoom in">
          <ZoomIn size={12} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Save / Load */}
        <button onClick={saveBoard} className={`${topBtn()} h-8 w-8`} title="Save snapshot to browser">
          <Save size={13} />
        </button>
        <button onClick={loadBoard} className={`${topBtn()} h-8 w-8`} title="Load snapshot from browser">
          <FolderOpen size={13} />
        </button>

        {/* Export dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowExport((v) => !v)}
            className={`${topBtn(showExport)} h-8 w-8`}
            title="Export"
          >
            <Download size={13} />
          </button>
          {showExport && (
            <div
              className="absolute right-0 top-full z-10 mt-1 min-w-[120px] overflow-hidden rounded-xl border border-white/[0.08] bg-zinc-900 shadow-2xl shadow-black/50"
              onMouseLeave={() => setShowExport(false)}
            >
              <button
                onClick={() => handleExport("png")}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <Download size={11} />
                Export PNG
              </button>
              <button
                onClick={() => handleExport("svg")}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <Download size={11} />
                Export SVG
              </button>
            </div>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-white/[0.08]" />

        {/* Clear */}
        <button
          onClick={clearBoard}
          className="flex h-8 w-8 items-center justify-center rounded-md text-red-500/60 transition-all hover:bg-red-500/10 hover:text-red-400"
          title="Clear board"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* ═══ Left Toolbar ══════════════════════════════════════════════════ */}
      <div className="pointer-events-auto absolute bottom-0 left-0 top-10 z-[300] flex w-[52px] flex-col items-center gap-0.5 overflow-y-auto border-r border-white/[0.07] bg-zinc-950/96 py-2 scrollbar-none backdrop-blur-sm">

        {/* Tool groups */}
        {TOOL_GROUPS.map((group, gi) => (
          <div key={gi} className="flex w-full flex-col items-center gap-0.5">
            {gi > 0 && <div className="my-1 h-px w-8 bg-white/[0.06]" />}
            {group.map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                className={`${sideBtn(activeTool === t.id)} h-9`}
                title={t.label}
              >
                <t.icon size={15} />
              </button>
            ))}
          </div>
        ))}

        <div className="my-1 h-px w-8 bg-white/[0.06]" />

        {/* Size — visual dots */}
        <p className="mb-0.5 text-[8px] tracking-widest text-zinc-600">SIZE</p>
        {SIZES.map(({ val, px }) => (
          <button
            key={val}
            onClick={() => setSize(val)}
            className={`${sideBtn(activeSize === val)} h-8`}
            title={`Size ${val.toUpperCase()}`}
          >
            <span
              className="rounded-full bg-current"
              style={{ width: px, height: px, display: "block" }}
            />
          </button>
        ))}

        <div className="my-1 h-px w-8 bg-white/[0.06]" />

        {/* Fill toggle */}
        <p className="mb-0.5 text-[8px] tracking-widest text-zinc-600">FILL</p>
        <button
          onClick={() => setFill(activeFill === "none" ? "solid" : "none")}
          className={`${sideBtn(activeFill === "solid")} h-9 text-base`}
          title={activeFill === "solid" ? "Filled — click for outline" : "Outline — click for filled"}
        >
          <span className="leading-none">{activeFill === "solid" ? "■" : "□"}</span>
        </button>

        <div className="my-1 h-px w-8 bg-white/[0.06]" />

        {/* Color swatches */}
        <p className="mb-1 text-[8px] tracking-widest text-zinc-600">COLOR</p>
        <div className="grid grid-cols-2 gap-[5px] px-2">
          {COLORS.map((c) => (
            <button
              key={c.hex}
              onClick={() => setColor(c)}
              title={c.label}
              style={{ backgroundColor: c.hex, width: 18, height: 18 }}
              className={`rounded-full border-2 transition-all hover:scale-125 ${
                activeColor === c.hex
                  ? "scale-125 border-white shadow-sm"
                  : "border-zinc-700 hover:border-zinc-400"
              }`}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function Whiteboard({ onBack }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <Tldraw persistenceKey="cc-whiteboard" hideUi>
        <WhiteboardUI onBack={onBack} />
      </Tldraw>
    </div>
  );
}
