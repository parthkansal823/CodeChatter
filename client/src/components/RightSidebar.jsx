import { useState, useCallback, useEffect } from "react";
import {
  Bot,
  MessageCircleMore,
  PencilRuler,
  Video,
  X,
  ChevronLeft,
  ChevronRight,
  Users,
  Radio,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import RoomChat from "./RoomChat";
import AIHelper from "./AIHelper";
import Whiteboard from "./Whiteboard";
import VideoCall from "./VideoCall";
import UserAvatar from "./UserAvatar";

const TOOLS = [
  {
    id: "chat",
    name: "Room Chat",
    icon: MessageCircleMore,
    color: "text-emerald-400",
    bg: "hover:bg-emerald-500/10",
    activeBg: "bg-emerald-500/10",
    activeBorder: "border-emerald-500/40",
  },
  {
    id: "video",
    name: "Video Call",
    icon: Video,
    color: "text-sky-400",
    bg: "hover:bg-sky-500/10",
    activeBg: "bg-sky-500/10",
    activeBorder: "border-sky-500/40",
  },
  {
    id: "ai",
    name: "AI Help",
    icon: Bot,
    color: "text-violet-400",
    bg: "hover:bg-violet-500/10",
    activeBg: "bg-violet-500/10",
    activeBorder: "border-violet-500/40",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    icon: PencilRuler,
    color: "text-amber-400",
    bg: "hover:bg-amber-500/10",
    activeBg: "bg-amber-500/10",
    activeBorder: "border-amber-500/40",
  },
];

// Collapsed icon rail width
const RAIL_WIDTH = 52;
const LAST_TOOL_STORAGE_KEY = "codechatter-last-active-tool";

export default function RightSidebar({
  isOpen = true,
  onToggle,
  mobile = false,
  onClose,
  onFeatureSelect,
  room,
  roomId,
  activeFilePath,
  activeCode,
  runResult,
  activeCollaborators = [],
  saveStatus = "saved",
  liveConnected = false,
  chatMessages = [],
  sendChatMessage = () => {},
  unreadChatMessagesCount = 0,
  setUnreadChatMessagesCount,
}) {
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [activeFeature, setActiveFeature] = useState(() => {
    try {
      const stored = sessionStorage.getItem(LAST_TOOL_STORAGE_KEY);
      return TOOLS.some((t) => t.id === stored) ? stored : null;
    } catch {
      return null;
    }
  });

  const allCollaborators = room?.collaborators || [];
  const liveCount = activeCollaborators.length;

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const resize = useCallback(
    (e) => {
      if (isResizing) {
        let newWidth = document.body.clientWidth - e.clientX;
        if (newWidth < 280) newWidth = 280;
        if (newWidth > 700) newWidth = 700;
        setSidebarWidth(newWidth);
      }
    },
    [isResizing],
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

  useEffect(() => {
    if (activeFeature === "chat" && isOpen) {
      setUnreadChatMessagesCount?.(0);
    }
  }, [activeFeature, isOpen, chatMessages.length, setUnreadChatMessagesCount]);

  const openTool = (id) => {
    setActiveFeature(id);
    onFeatureSelect?.(id);
    if (id === "chat") setUnreadChatMessagesCount?.(0);
    try { sessionStorage.setItem(LAST_TOOL_STORAGE_KEY, id); } catch { /* ignore */ }
  };

  const closeTool = () => {
    setActiveFeature(null);
    try { sessionStorage.removeItem(LAST_TOOL_STORAGE_KEY); } catch { /* ignore */ }
  };

  // Feature panel — full content when a tool is active
  const featurePanel = (
    <AnimatePresence mode="wait">
      {activeFeature === "chat" && (
        <Motion.div
          key="chat"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.15 }}
          className="flex h-full flex-col"
        >
          <RoomChat
            roomId={roomId}
            onBack={closeTool}
            chatMessages={chatMessages}
            sendChatMessage={sendChatMessage}
          />
        </Motion.div>
      )}
      {activeFeature === "ai" && (
        <Motion.div
          key="ai"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.15 }}
          className="flex h-full flex-col"
        >
          <AIHelper
            onBack={closeTool}
            roomId={roomId}
            roomName={room?.name}
            activeFilePath={activeFilePath}
            activeCode={activeCode}
            runResult={runResult}
          />
        </Motion.div>
      )}
      {activeFeature === "whiteboard" && (
        <Motion.div
          key="whiteboard"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.15 }}
          className="flex h-full flex-col"
        >
          <Whiteboard onBack={closeTool} />
        </Motion.div>
      )}
      {activeFeature === "video" && (
        <Motion.div
          key="video"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.15 }}
          className="flex h-full flex-col"
        >
          <VideoCall
            onBack={closeTool}
            roomName={room?.name}
            collaborators={activeCollaborators}
          />
        </Motion.div>
      )}
    </AnimatePresence>
  );

  // ── Icon rail (collapsed / always visible right edge) ──────────────────────
  const iconRail = (
    <div
      style={{ width: `${RAIL_WIDTH}px` }}
      className="flex h-full shrink-0 flex-col border-l border-white/[0.06] bg-[#0d0d10]"
    >
      {/* Collapse / expand toggle */}
      <button
        onClick={onToggle}
        className="flex h-11 w-full items-center justify-center text-zinc-600 transition hover:text-zinc-300"
        title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>

      <div className="h-px w-full bg-white/[0.05]" />

      {/* Tool icons */}
      <div className="flex flex-col items-center gap-1 py-3">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeFeature === tool.id;
          const badge = tool.id === "chat" && unreadChatMessagesCount > 0 ? unreadChatMessagesCount : null;

          return (
            <button
              key={tool.id}
              onClick={() => {
                if (!isOpen) onToggle?.();
                openTool(tool.id);
              }}
              title={tool.name}
              className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition-all ${
                isActive
                  ? `${tool.activeBg} ${tool.activeBorder} ${tool.color}`
                  : `border-transparent ${tool.color} ${tool.bg} opacity-60 hover:opacity-100`
              }`}
            >
              <Icon size={17} />
              {badge && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-[#0d0d10]">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <div className="h-px w-full bg-white/[0.05]" />
        {/* Live presence avatars — mini stack */}
        <div className="flex flex-col items-center gap-1.5 py-3">
          <div className="flex items-center gap-1 text-[10px] text-zinc-700">
            <Radio size={9} className={liveConnected ? "text-emerald-500" : ""} />
            {liveCount > 0 ? liveCount : ""}
          </div>
          {allCollaborators.slice(0, 4).map((c) => (
            <div key={c.id} className="relative" title={c.username}>
              <UserAvatar username={c.username} size="xs" />
              {activeCollaborators.some((a) => a.userId === c.id || a.id === c.id) && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[#0d0d10] bg-emerald-500" />
              )}
            </div>
          ))}
          {allCollaborators.length > 4 && (
            <span className="text-[10px] text-zinc-700">+{allCollaborators.length - 4}</span>
          )}
        </div>
      </div>
    </div>
  );

  // ── Mobile overlay ─────────────────────────────────────────────────────────
  if (mobile) {
    if (!isOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex justify-end lg:hidden">
        <button className="flex-1 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} aria-label="Close tools" />
        <div className="flex h-full w-[82vw] max-w-[380px] flex-col border-l border-white/[0.06] bg-[#0d0d10] shadow-2xl">
          {/* Mobile header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="text-sm font-semibold text-white">Workspace Tools</p>
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
              <X size={16} />
            </button>
          </div>
          {activeFeature ? (
            <div className="flex-1 overflow-hidden">{featurePanel}</div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    onClick={() => openTool(tool.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left transition hover:bg-white/[0.05]`}
                  >
                    <Icon size={18} className={tool.color} />
                    <span className="text-sm font-medium text-zinc-200">{tool.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  if (!isOpen) {
    // Collapsed = just the icon rail
    return (
      <div className={isResizing ? "pointer-events-none select-none" : ""}>
        {iconRail}
      </div>
    );
  }

  return (
    <div className={`flex h-full ${isResizing ? "pointer-events-none select-none" : ""}`}>
      {/* Main content panel */}
      <div
        style={{ width: `${sidebarWidth}px` }}
        className="relative flex h-full flex-col border-l border-white/[0.06] bg-[#0d0d10]"
      >
        {/* Resize handle */}
        <div
          onMouseDown={startResizing}
          className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize group z-50 -translate-x-1.5"
        >
          <div
            className={`h-full w-[2px] transition-colors ${
              isResizing ? "bg-violet-500" : "bg-transparent group-hover:bg-zinc-700"
            }`}
          />
        </div>

        {activeFeature ? (
          <div className="flex-1 overflow-hidden">{featurePanel}</div>
        ) : (
          /* Default state: tool launcher grid */
          <div className="flex h-full flex-col">
            <div className="border-b border-white/[0.06] px-4 py-3.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">Workspace Tools</p>
            </div>

            {/* Live presence bar */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
              <div className="flex items-center gap-1.5">
                <Radio size={11} className={liveConnected ? "text-emerald-500" : "text-zinc-600"} />
                <span className="text-xs text-zinc-500">{liveConnected ? "Live" : "Offline"}</span>
              </div>
              {allCollaborators.length > 0 && (
                <>
                  <div className="h-3.5 w-px bg-white/[0.06]" />
                  <div className="flex items-center gap-1.5">
                    <div className="flex -space-x-1.5">
                      {allCollaborators.slice(0, 5).map((c) => (
                        <div key={c.id} className="relative" title={c.username}>
                          <UserAvatar username={c.username} size="xs" className="ring-1 ring-[#0d0d10]" />
                          {activeCollaborators.some((a) => a.userId === c.id || a.id === c.id) && (
                            <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-[#0d0d10] bg-emerald-500" />
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-zinc-600">
                      {liveCount > 0 ? `${liveCount} active` : `${allCollaborators.length} members`}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Tool cards */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-2">
                {TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  const badge = tool.id === "chat" && unreadChatMessagesCount > 0 ? unreadChatMessagesCount : null;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => openTool(tool.id)}
                      className={`group relative flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-5 text-center transition-all hover:border-white/[0.12] hover:bg-white/[0.05]`}
                    >
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] transition group-hover:scale-110 ${tool.color}`}>
                        <Icon size={20} />
                      </div>
                      <span className="text-xs font-semibold text-zinc-300">{tool.name}</span>
                      {badge && (
                        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-[#0d0d10]">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Icon rail always visible on far right */}
      {iconRail}
    </div>
  );
}
