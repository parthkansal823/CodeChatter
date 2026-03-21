import { useState, useCallback, useEffect } from "react";
import {
  Bot,
  ChevronRight,
  MessageCircleMore,
  PencilRuler,
  Video,
  X,
} from "lucide-react";
import RoomChat from "./RoomChat";
import AIHelper from "./AIHelper";

const TOOL_CARDS = [
  {
    id: "chat",
    name: "Room Chat",
    description: "Keep conversation tied to the active workspace and files.",
    icon: MessageCircleMore,
    accent: "text-emerald-500",
  },
  {
    id: "video",
    name: "Video Call",
    description: "Jump into a quick call when text is not enough.",
    icon: Video,
    accent: "text-sky-500",
  },
  {
    id: "ai",
    name: "AI Help",
    description: "Explain code, break down logic, and help understand the current file.",
    icon: Bot,
    accent: "text-violet-500",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    description: "Sketch flows, system ideas, and architecture beside the editor.",
    icon: PencilRuler,
    accent: "text-amber-500",
  },
];

export default function RightSidebar({
  isOpen = true,
  onToggle,
  mobile = false,
  onClose,
  onFeatureSelect,
}) {
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [activeFeature, setActiveFeature] = useState(null);

  const startResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent) => {
      if (isResizing) {
        let newWidth = document.body.clientWidth - mouseMoveEvent.clientX;
        if (newWidth < 64) newWidth = 64; // Collapsed minimum
        if (newWidth > 800) newWidth = 800; // Expanded maximum
        setSidebarWidth(newWidth);
      }
    },
    [isResizing]
  );

  useEffect(() => {
    if (isResizing) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resize, stopResizing, isResizing]);

  if (mobile && !isOpen) {
    return null;
  }

  const isCollapsed = (!mobile && !isOpen) || sidebarWidth < 120;
  
  const widthStyle = mobile 
    ? {} 
    : isCollapsed 
      ? { width: "64px" } 
      : { width: `${sidebarWidth}px` };

  const panel = (
    <div
      style={widthStyle}
      className={`relative flex h-full flex-col shrink-0 border-l border-zinc-200/80 bg-white/70 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-[#09090b]/80 transition-[width] duration-0 ease-none ${
        mobile ? "w-[82vw] max-w-[340px] shadow-2xl shadow-zinc-950/20" : ""
      }`}
    >
      {/* Premium Drag handle */}
      {!mobile && !isCollapsed && (
        <div
          onMouseDown={startResizing}
          className="absolute left-0 top-0 bottom-0 w-4 cursor-col-resize group z-50 flex items-center justify-center -translate-x-2"
        >
          <div 
            className={`h-full w-[2px] transition-colors duration-200 ${
              isResizing 
                ? "bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" 
                : "bg-transparent group-hover:bg-zinc-300 dark:group-hover:bg-zinc-700"
            }`} 
          />
        </div>
      )}
      {/* Active Feature Overlays */}
      {!isCollapsed && activeFeature === "chat" ? (
        <RoomChat onBack={() => setActiveFeature(null)} />
      ) : !isCollapsed && activeFeature === "ai" ? (
        <AIHelper onBack={() => setActiveFeature(null)} />
      ) : (
        <>
          {/* Dock Header */}
          <div className="flex items-center justify-between border-b border-zinc-200/80 px-3 py-3 dark:border-zinc-800 shrink-0">
            <div className="flex min-w-0 items-center gap-2">
              {!mobile && (
                <button
                  onClick={onToggle}
                  className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                  title={isCollapsed ? "Expand tools" : "Collapse tools"}
                >
                  <ChevronRight size={16} className={`transition-transform ${isCollapsed ? "rotate-180" : ""}`} />
                </button>
              )}

              {!isCollapsed && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                    Workspace
                  </p>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                    Tools
                  </p>
                </div>
              )}
            </div>

            {mobile && (
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                title="Close tools"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Dock Body */}
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {isCollapsed ? (
              <div className="space-y-2">
                {TOOL_CARDS.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => {
                      if (tool.id === "chat" || tool.id === "ai") setActiveFeature(tool.id);
                      onFeatureSelect?.(tool.id);
                    }}
                    className="flex h-11 w-full items-center justify-center rounded-2xl text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                    title={tool.name}
                  >
                <tool.icon size={18} className={tool.accent} />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                Feature Dock
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Keep this panel for collaboration and helper tools around the editor.
              </p>
            </div>

            <div className="space-y-3">
              {TOOL_CARDS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    if (tool.id === "chat" || tool.id === "ai") setActiveFeature(tool.id);
                    onFeatureSelect?.(tool.id);
                  }}
                  className="group w-full rounded-2xl border border-zinc-200 bg-white/50 p-4 text-left shadow-sm backdrop-blur-md transition-all hover:border-brand-500 hover:bg-white hover:shadow-md dark:border-zinc-800/60 dark:bg-zinc-900/40 dark:hover:border-brand-500/50 dark:hover:bg-zinc-900/80"
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100/50 dark:bg-zinc-950/50 transition-transform group-hover:scale-110 ${tool.accent}`}>
                      <tool.icon size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {tool.name}
                        </p>
                        {(tool.id !== "chat" && tool.id !== "ai") && (
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                            Coming soon
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                        {tool.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
        <button
          className="flex-1 bg-zinc-950/40 backdrop-blur-sm"
          onClick={onClose}
          aria-label="Close tools"
        />
        {panel}
      </div>
    );
  }

  return (
    <>
      <div className={isResizing ? "pointer-events-none select-none" : ""}>
        {panel}
      </div>
    </>
  );
}
