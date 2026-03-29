import { useState } from "react";
import { Tldraw, useEditor, exportAs } from "tldraw";
import { DefaultColorStyle, DefaultSizeStyle } from "@tldraw/tlschema";
import "tldraw/tldraw.css";
import {
  ArrowLeft, Download, Pen, Eraser, Undo, Redo, Trash2,
  MousePointer2, Hand, ArrowUpRight, Type, Square,
  Save, FolderOpen, ZoomIn, ZoomOut, Minus,
} from "lucide-react";

const COLORS = [
  { hex: "#ef4444", tldraw: "red",    label: "Red" },
  { hex: "#f97316", tldraw: "orange", label: "Orange" },
  { hex: "#eab308", tldraw: "yellow", label: "Yellow" },
  { hex: "#10b981", tldraw: "green",  label: "Green" },
  { hex: "#3b82f6", tldraw: "blue",   label: "Blue" },
  { hex: "#8b5cf6", tldraw: "violet", label: "Violet" },
  { hex: "#6b7280", tldraw: "grey",   label: "Grey" },
  { hex: "#000000", tldraw: "black",  label: "Black" },
];

const TOOLS = [
  { id: "select", icon: MousePointer2, label: "Select (V)" },
  { id: "hand",   icon: Hand,          label: "Pan (H)"    },
  { id: "draw",   icon: Pen,           label: "Draw (D)"   },
  { id: "eraser", icon: Eraser,        label: "Eraser (E)" },
  { id: "arrow",  icon: ArrowUpRight,  label: "Arrow (A)"  },
  { id: "line",   icon: Minus,         label: "Line"       },
  { id: "geo",    icon: Square,        label: "Shapes (R)" },
  { id: "text",   icon: Type,          label: "Text (T)"   },
];

const SIZES = [
  { val: "s",  label: "S" },
  { val: "m",  label: "M" },
  { val: "l",  label: "L" },
  { val: "xl", label: "XL" },
];

function Divider() {
  return <div className="w-8 h-px bg-white/[0.06] my-0.5 self-center" />;
}

function Toolbar({ onBack }) {
  const editor = useEditor();
  const [activeTool, setActiveTool] = useState("draw");
  const [activeSize, setActiveSize]  = useState("m");
  const [activeColor, setActiveColor] = useState("#8b5cf6");

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

  const saveBoard = () => {
    const data = editor.getSnapshot();
    localStorage.setItem("cc-wb-snapshot", JSON.stringify(data));
  };

  const loadBoard = () => {
    const raw = localStorage.getItem("cc-wb-snapshot");
    if (raw) editor.loadSnapshot(JSON.parse(raw));
  };

  const download = async () => {
    const ids = editor.getCurrentPageShapeIds();
    if (ids.size === 0) return;
    await exportAs(editor, [...ids], { format: "png" });
  };

  const clear = () => {
    editor.selectAll();
    editor.deleteShapes(editor.getSelectedShapeIds());
  };

  const toolBtn = (active) =>
    `flex items-center justify-center w-9 h-9 rounded-lg transition-all ${
      active
        ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    }`;

  const iconBtn =
    "flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all";
  const dangerBtn =
    "flex items-center justify-center w-9 h-9 rounded-lg text-red-500/60 hover:bg-red-500/10 hover:text-red-400 transition-all";

  return (
    <div className="pointer-events-auto absolute left-0 top-0 bottom-0 z-[300] flex flex-col items-center w-[52px] bg-zinc-950/96 backdrop-blur-sm border-r border-white/[0.06] py-2 gap-0.5 overflow-y-auto scrollbar-none">

      {/* Back */}
      <button onClick={onBack} className={iconBtn} title="Back to room">
        <ArrowLeft size={15} />
      </button>

      <Divider />

      {/* Tools */}
      {TOOLS.map((t) => (
        <button
          key={t.id}
          onClick={() => setTool(t.id)}
          className={toolBtn(activeTool === t.id)}
          title={t.label}
        >
          <t.icon size={15} />
        </button>
      ))}

      <Divider />

      {/* Stroke Size */}
      <div className="flex flex-col gap-0.5 w-full px-1.5">
        <p className="text-[8px] text-zinc-600 text-center mb-0.5 tracking-wider">SIZE</p>
        {SIZES.map(({ val, label }) => (
          <button
            key={val}
            onClick={() => setSize(val)}
            className={`text-[10px] font-bold h-6 rounded transition-all ${
              activeSize === val
                ? "bg-violet-500/20 text-violet-300"
                : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Divider />

      {/* Colors */}
      <div className="flex flex-col items-center w-full px-2">
        <p className="text-[8px] text-zinc-600 mb-1.5 tracking-wider">COLOR</p>
        <div className="grid grid-cols-2 gap-[5px]">
          {COLORS.map((c) => (
            <button
              key={c.hex}
              onClick={() => setColor(c)}
              title={c.label}
              style={{ backgroundColor: c.hex, width: 18, height: 18 }}
              className={`rounded-full border-2 transition-transform hover:scale-125 ${
                activeColor === c.hex
                  ? "border-white scale-125 shadow-sm"
                  : "border-zinc-700 hover:border-zinc-500"
              }`}
            />
          ))}
        </div>
      </div>

      <Divider />

      {/* Zoom */}
      <button onClick={() => editor.zoomIn()} className={iconBtn} title="Zoom In (+)">
        <ZoomIn size={14} />
      </button>
      <button onClick={() => editor.zoomOut()} className={iconBtn} title="Zoom Out (-)">
        <ZoomOut size={14} />
      </button>

      {/* Actions — push to bottom */}
      <div className="mt-auto flex flex-col items-center gap-0.5 w-full px-1.5">
        <Divider />
        <button onClick={() => editor.undo()} className={iconBtn} title="Undo (Ctrl+Z)">
          <Undo size={14} />
        </button>
        <button onClick={() => editor.redo()} className={iconBtn} title="Redo (Ctrl+Y)">
          <Redo size={14} />
        </button>
        <button onClick={saveBoard} className={iconBtn} title="Save snapshot">
          <Save size={14} />
        </button>
        <button onClick={loadBoard} className={iconBtn} title="Load snapshot">
          <FolderOpen size={14} />
        </button>
        <button onClick={download} className={iconBtn} title="Export PNG">
          <Download size={14} />
        </button>
        <button onClick={clear} className={dangerBtn} title="Clear board">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Whiteboard({ onBack }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950">
      <Tldraw persistenceKey="cc-whiteboard" hideUi>
        <Toolbar onBack={onBack} />
      </Tldraw>
    </div>
  );
}
