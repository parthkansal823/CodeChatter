import { useState, useCallback, useEffect } from "react";
import {
  Activity,
  Bot,
  LayoutDashboard,
  FileText,
  Github,
  GitBranch,
  MessageCircleMore,
  PencilRuler,
  Search,
  Timer,
  Video,
  X,
  ChevronLeft,
  ChevronRight,
  Radio,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import RoomChat from "./RoomChat";
import AIHelper from "./AIHelper";
import FlowchartPanel from "./FlowchartPanel";
import ActivityLog from "./ActivityLog";
import GitHubPanel from "./GitHubPanel";
import QuickNotes from "./QuickNotes";
import PomodoroTimer from "./PomodoroTimer";
import Whiteboard from "./Whiteboard";
import VideoCall from "./VideoCall";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../hooks/useAuth";

const TOOLS = [
  // ── Core collaboration ──────────────────────────────
  {
    id: "overview",
    name: "Overview",
    section: "Workspace",
    icon: LayoutDashboard,
    color: "text-indigo-400",
    bg: "hover:bg-indigo-500/10",
    activeBg: "bg-indigo-500/10",
    activeBorder: "border-indigo-500/40",
  },
  {
    id: "chat",
    name: "Room Chat",
    section: "Collaboration",
    icon: MessageCircleMore,
    color: "text-emerald-400",
    bg: "hover:bg-emerald-500/10",
    activeBg: "bg-emerald-500/10",
    activeBorder: "border-emerald-500/40",
  },
  {
    id: "ai",
    name: "AI Help",
    section: "Collaboration",
    icon: Bot,
    color: "text-violet-400",
    bg: "hover:bg-violet-500/10",
    activeBg: "bg-violet-500/10",
    activeBorder: "border-violet-500/40",
  },
  // ── Code tools ──────────────────────────────────────
  {
    id: "flowchart",
    name: "Flowchart",
    section: "Coding",
    icon: GitBranch,
    color: "text-cyan-400",
    bg: "hover:bg-cyan-500/10",
    activeBg: "bg-cyan-500/10",
    activeBorder: "border-cyan-500/40",
  },
  {
    id: "github",
    name: "GitHub",
    section: "Coding",
    icon: Github,
    color: "text-zinc-500 dark:text-zinc-400",
    bg: "hover:bg-zinc-500/10",
    activeBg: "bg-zinc-500/10",
    activeBorder: "border-zinc-500/40",
  },
  // ── Utilities ───────────────────────────────────────
  {
    id: "activity",
    name: "Activity",
    section: "Workspace",
    icon: Activity,
    color: "text-rose-400",
    bg: "hover:bg-rose-500/10",
    activeBg: "bg-rose-500/10",
    activeBorder: "border-rose-500/40",
  },
  {
    id: "notes",
    name: "Quick Notes",
    section: "Workspace",
    icon: FileText,
    color: "text-amber-400",
    bg: "hover:bg-amber-500/10",
    activeBg: "bg-amber-500/10",
    activeBorder: "border-amber-500/40",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    section: "Planning",
    icon: PencilRuler,
    color: "text-orange-400",
    bg: "hover:bg-orange-500/10",
    activeBg: "bg-orange-500/10",
    activeBorder: "border-orange-500/40",
  },
  // ── Focus / AV ──────────────────────────────────────
  {
    id: "pomodoro",
    name: "Pomodoro",
    section: "Focus",
    icon: Timer,
    color: "text-rose-400",
    bg: "hover:bg-rose-500/10",
    activeBg: "bg-rose-500/10",
    activeBorder: "border-rose-500/40",
  },
  {
    id: "video",
    name: "Video Call",
    section: "Collaboration",
    icon: Video,
    color: "text-sky-400",
    bg: "hover:bg-sky-500/10",
    activeBg: "bg-sky-500/10",
    activeBorder: "border-sky-500/40",
  },
];

const TOOL_SECTIONS = [
  { id: "Workspace", label: "Workspace" },
  { id: "Collaboration", label: "Collaboration" },
  { id: "Coding", label: "Coding" },
  { id: "Planning", label: "Planning" },
  { id: "Focus", label: "Focus" },
];

// Collapsed icon rail width
const RAIL_WIDTH = 52;
const LAST_TOOL_STORAGE_KEY = "codechatter-last-active-tool";
const SIDEBAR_WIDTH_STORAGE_KEY = "codechatter-right-sidebar-width";

function formatRoleLabel(role = "") {
  if (!role) return "Member";
  return String(role).replace(/^./, (letter) => letter.toUpperCase());
}

function ToolHeader({ icon: Icon, title, description, onBack, actions = null }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
          title="Back to tools"
        >
          <ChevronLeft size={15} />
        </button>
      ) : null}
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-white/[0.04] dark:text-zinc-200">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
        {description ? (
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

function OverviewPanel({
  room,
  activeFilePath,
  runResult,
  overviewStats,
  allCollaborators,
  activeCollaborators,
  liveConnected,
  accessRole,
  openTool,
}) {
  const canEdit = Boolean(room?.canEdit);
  const canRun = Boolean(room?.canRun);
  const canManage = Boolean(room?.canManage);
  const lastRunFailed = runResult?.status === "completed" && runResult?.exitCode !== 0;
  const lastRunLabel = runResult?.status === "running"
    ? "Running now"
    : runResult?.status === "completed"
      ? lastRunFailed
        ? "Last run finished with errors"
        : "Last run finished successfully"
      : "No recent runs";

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0d0d10]">
      <ToolHeader
        icon={LayoutDashboard}
        title="Workspace Overview"
        description={room?.name || "Current room summary"}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{room?.name || "Workspace"}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {room?.description || "Everything important in this room, in one place."}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              liveConnected
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            }`}>
              {liveConnected ? "Live" : "Offline"}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {overviewStats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{stat.label}</p>
                <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Your role", value: formatRoleLabel(accessRole) },
            { label: "Can edit", value: canEdit ? "Yes" : "No" },
            { label: "Can run", value: canRun ? "Yes" : "No" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{item.label}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Current file</p>
          <p className="mt-2 truncate text-sm font-medium text-zinc-900 dark:text-white">
            {activeFilePath || "No file selected"}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Open AI Help or Flowchart from here when you want help on the active file.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => openTool("ai")}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-white/[0.06] dark:text-zinc-200 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
            >
              Open AI Help
            </button>
            <button
              type="button"
              onClick={() => openTool("flowchart")}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-white/[0.06] dark:text-zinc-200 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10"
            >
              Open Flowchart
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Run status</p>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-white">{lastRunLabel}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              runResult?.status === "running"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
                : lastRunFailed
                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            }`}>
              {runResult?.status === "running" ? "Running" : lastRunFailed ? "Errors" : "Ready"}
            </span>
          </div>
          {runResult?.filePath ? (
            <p className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400">{runResult.filePath}</p>
          ) : null}
        </div>

        <div className="mt-4 rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">People in room</p>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {activeCollaborators.length > 0 ? `${activeCollaborators.length} active` : `${allCollaborators.length} members`}
            </span>
          </div>
          <div className="mt-3 space-y-2">
            {allCollaborators.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">No collaborators yet.</p>
            ) : (
              allCollaborators.slice(0, 6).map((collaborator) => {
                const isLive = activeCollaborators.some((active) => active.userId === collaborator.id || active.id === collaborator.id);
                return (
                  <div key={collaborator.id} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="relative">
                      <UserAvatar username={collaborator.username} size="xs" />
                      {isLive ? (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-emerald-500 dark:border-[#0d0d10]" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{collaborator.username}</p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{formatRoleLabel(collaborator.accessRole || "editor")}</p>
                    </div>
                    {isLive ? <Radio size={12} className="text-emerald-500" /> : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {!canManage ? null : (
          <div className="mt-4 rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Owner controls available</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              You can review access requests and manage member roles from the workspace settings modal.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

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
  liveConnected = false,
  fileCount = 0,
  folderCount = 0,
  openFileCount = 0,
  accessRole = "",
  chatMessages = [],
  sendChatMessage = () => {},
  sendVideoSignal,
  setVideoSignalListener,
  unreadChatMessagesCount = 0,
  setUnreadChatMessagesCount,
  initialFeature = null,
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 340;
    }
    const storedValue = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(storedValue)) {
      return 340;
    }
    return Math.min(620, Math.max(300, storedValue));
  });
  const [isResizing, setIsResizing] = useState(false);
  const [toolQuery, setToolQuery] = useState("");
  const [activeFeature, setActiveFeature] = useState(() => {
    if (initialFeature && TOOLS.some((tool) => tool.id === initialFeature)) {
      return initialFeature;
    }

    try {
      const stored = sessionStorage.getItem(LAST_TOOL_STORAGE_KEY);
      return TOOLS.some((t) => t.id === stored) ? stored : null;
    } catch {
      return null;
    }
  });

  const { user } = useAuth();
  const allCollaborators = room?.collaborators || [];
  const liveCount = activeCollaborators.length;
  const overviewStats = [
    { label: "Files", value: fileCount },
    { label: "Folders", value: folderCount },
    { label: "Open tabs", value: openFileCount },
    { label: "Live users", value: liveCount || allCollaborators.length },
  ];
  const filteredTools = TOOLS.filter((tool) => {
    if (!toolQuery.trim()) {
      return true;
    }
    const query = toolQuery.toLowerCase();
    return `${tool.name} ${tool.section}`.toLowerCase().includes(query);
  });
  const groupedTools = TOOL_SECTIONS
    .map((section) => ({
      ...section,
      tools: filteredTools.filter((tool) => tool.section === section.id),
    }))
    .filter((section) => section.tools.length > 0);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const resize = useCallback(
    (e) => {
      if (isResizing) {
        let newWidth = document.body.clientWidth - e.clientX;
        if (newWidth < 300) newWidth = 300;
        if (newWidth > 620) newWidth = 620;
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
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!mobile || !isOpen) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, mobile, onClose]);

  useEffect(() => {
    if (activeFeature === "chat" && isOpen) {
      setUnreadChatMessagesCount?.(0);
    }
  }, [activeFeature, isOpen, chatMessages.length, setUnreadChatMessagesCount]);

  const openTool = (id) => {
    setActiveFeature(id);
    setToolQuery("");
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
      {activeFeature === "overview" && (
        <Motion.div
          key="overview"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.15 }}
          className="flex h-full flex-col"
        >
          <OverviewPanel
            room={room}
            activeFilePath={activeFilePath}
            runResult={runResult}
            overviewStats={overviewStats}
            allCollaborators={allCollaborators}
            activeCollaborators={activeCollaborators}
            liveConnected={liveConnected}
            accessRole={accessRole}
            openTool={openTool}
          />
        </Motion.div>
      )}
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
            sendVideoSignal={sendVideoSignal}
            setVideoSignalListener={setVideoSignalListener}
          />
        </Motion.div>
      )}
      {activeFeature === "activity" && (
        <Motion.div key="activity" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }} className="flex h-full flex-col">
          <ActivityLog roomId={roomId} onBack={closeTool} />
        </Motion.div>
      )}
      {activeFeature === "notes" && (
        <Motion.div key="notes" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }} className="flex h-full flex-col">
          <QuickNotes roomId={roomId} onBack={closeTool} />
        </Motion.div>
      )}
      {activeFeature === "pomodoro" && (
        <Motion.div key="pomodoro" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }} className="flex h-full flex-col">
          <PomodoroTimer onBack={closeTool} />
        </Motion.div>
      )}
      {activeFeature === "github" && (
        <Motion.div key="github" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }} className="flex h-full flex-col overflow-hidden">
          <ToolHeader
            icon={Github}
            title="GitHub"
            description="Import repos, push changes, and manage sync."
            onBack={closeTool}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <GitHubPanel roomId={roomId} activeFilePath={activeFilePath} activeCode={activeCode} />
          </div>
        </Motion.div>
      )}
      {activeFeature === "flowchart" && (
        <Motion.div key="flowchart" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.15 }} className="flex h-full flex-col overflow-hidden">
          <FlowchartPanel
            onBack={closeTool}
            roomId={roomId}
            activeFilePath={activeFilePath}
            activeCode={activeCode}
          />
        </Motion.div>
      )}
    </AnimatePresence>
  );

  const renderToolButton = (tool, compact = false) => {
    const Icon = tool.icon;
    const badge = tool.id === "chat" && unreadChatMessagesCount > 0 ? unreadChatMessagesCount : null;

    return (
      <button
        key={tool.id}
        onClick={() => openTool(tool.id)}
        className={`group relative flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 text-left transition hover:border-zinc-300 hover:bg-zinc-100 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05] ${
          compact ? "px-4 py-3" : "px-4 py-4"
        }`}
      >
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 transition group-hover:scale-105 dark:bg-white/[0.04] ${tool.color}`}>
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{tool.name}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{tool.section}</p>
        </div>
        {badge ? (
          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
    );
  };

  // ── Icon rail (collapsed / always visible right edge) ──────────────────────
  const iconRail = (
    <div
      style={{ width: `${RAIL_WIDTH}px` }}
      className="flex h-full shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 dark:border-white/[0.06] dark:bg-[#0d0d10]"
    >
      {/* Collapse / expand toggle */}
      <button
        onClick={onToggle}
        className="flex h-11 w-full items-center justify-center text-zinc-500 transition hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
        title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>

      <div className="h-px w-full bg-zinc-200 dark:bg-white/[0.05]" />

      {/* Tool icons */}
      <div className="flex flex-col items-center gap-1 py-3">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeFeature === tool.id;
          const badge = tool.id === "chat" && unreadChatMessagesCount > 0 ? unreadChatMessagesCount : null;
          const showGithubDot = tool.id === "github" && user?.githubConnected;

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
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white ring-2 ring-zinc-50 dark:ring-[#0d0d10]">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
              {showGithubDot && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-50 bg-emerald-500 dark:border-[#0d0d10]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <div className="h-px w-full bg-zinc-200 dark:bg-white/[0.05]" />
        {/* Live presence avatars — mini stack */}
        <div className="flex flex-col items-center gap-1.5 py-3">
          <div className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-700">
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
            <span className="text-[10px] text-zinc-400 dark:text-zinc-700">+{allCollaborators.length - 4}</span>
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
        <div className="flex h-full w-[88vw] max-w-[400px] flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-white/[0.06] dark:bg-[#0d0d10]">
          {/* Mobile header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Workspace Tools</p>
            <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200">
              <X size={16} />
            </button>
          </div>
          {activeFeature ? (
            <div className="flex-1 overflow-hidden">{featurePanel}</div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">{room?.name || "Workspace"}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {liveConnected ? "Live collaboration connected" : "Live collaboration offline"}
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Workspace overview</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {overviewStats.map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.03]">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{stat.label}</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={toolQuery}
                    onChange={(event) => setToolQuery(event.target.value)}
                    placeholder="Search tools"
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-100"
                  />
                </div>
              </div>
              {groupedTools.map((section) => (
                <div key={section.id} className="space-y-2">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">
                    {section.label}
                  </p>
                  {section.tools.map((tool) => renderToolButton(tool, true))}
                </div>
              ))}
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
        className="relative flex h-full flex-col border-l border-zinc-200 bg-white dark:border-white/[0.06] dark:bg-[#0d0d10]"
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
          /* Default state: tool launcher */
          <div className="flex h-full flex-col">
            <div className="border-b border-zinc-200 px-4 py-3.5 dark:border-white/[0.06]">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Workspace Tools</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">Everything important, easier to reach</p>
            </div>

            <div className="border-b border-zinc-200 px-4 py-4 dark:border-white/[0.06]">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                      {room?.name || "Workspace"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {liveConnected ? "Realtime connected" : "Realtime offline"}
                      {accessRole ? ` · ${String(accessRole).replace(/^./, (letter) => letter.toUpperCase())}` : ""}
                    </p>
                  </div>
                  <div className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                    liveConnected
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}>
                    {liveConnected ? "Live" : "Offline"}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {overviewStats.map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.03]">
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{stat.label}</p>
                      <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">{stat.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-dashed border-zinc-200 px-3 py-2 dark:border-white/[0.08]">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">Active file</p>
                  <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300">{activeFilePath || "No file selected yet"}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {["overview", "chat", "ai", "github"].map((toolId) => {
                    const tool = TOOLS.find((item) => item.id === toolId);
                    if (!tool) return null;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => openTool(tool.id)}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-zinc-200 dark:hover:border-violet-500/40 dark:hover:bg-violet-500/10"
                      >
                        {tool.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Live presence bar + member list */}
            <div className="border-b border-zinc-200 dark:border-white/[0.06]">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Radio size={11} className={liveConnected ? "text-emerald-500" : "text-zinc-400 dark:text-zinc-600"} />
                  <span className="text-xs text-zinc-500">{liveConnected ? "Live" : "Offline"}</span>
                </div>
                {allCollaborators.length > 0 && (
                  <>
                    <div className="h-3.5 w-px bg-zinc-200 dark:bg-white/[0.06]" />
                    <div className="flex items-center gap-1.5">
                      <div className="flex -space-x-1.5">
                        {allCollaborators.slice(0, 5).map((c) => (
                          <div key={c.id} className="relative" title={`${c.username} · ${c.accessRole || "member"}`}>
                            <UserAvatar username={c.username} size="xs" className="ring-1 ring-[#0d0d10]" />
                            {activeCollaborators.some((a) => a.userId === c.id || a.id === c.id) && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-[#0d0d10] bg-emerald-500" />
                            )}
                          </div>
                        ))}
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-600">
                        {liveCount > 0 ? `${liveCount} active` : `${allCollaborators.length} members`}
                      </span>
                    </div>
                  </>
                )}
              </div>
              {/* Member role list */}
              {allCollaborators.length > 0 && (
                <div className="px-4 pb-3 space-y-1">
                  {allCollaborators.map((c) => {
                    const isLive = activeCollaborators.some((a) => a.userId === c.id || a.id === c.id);
                    const roleDot = { owner: "bg-yellow-400", editor: "bg-violet-400", runner: "bg-amber-400", viewer: "bg-zinc-500" };
                    const roleLabel = { owner: "Owner", editor: "Editor", runner: "Runner", viewer: "Viewer" };
                    const role = c.accessRole || "editor";
                    return (
                      <div key={c.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-white/[0.04]">
                        <div className="relative shrink-0">
                          <UserAvatar username={c.username} size="xs" />
                          {isLive && <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-white bg-emerald-500 dark:border-[#0d0d10]" />}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">{c.username}</span>
                        <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          role === "owner"  ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-300" :
                          role === "editor" ? "bg-violet-500/10 text-violet-600 dark:text-violet-300" :
                          role === "runner" ? "bg-amber-500/10 text-amber-600 dark:text-amber-300" :
                          "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                        }`}>
                          <span className={`h-1 w-1 rounded-full ${roleDot[role] || "bg-zinc-500"}`} />
                          {roleLabel[role] || role}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tool cards */}
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder="Search sidebar tools"
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <div className="space-y-4">
                {groupedTools.map((section) => (
                  <div key={section.id}>
                    <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-600">
                      {section.label}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {section.tools.map((tool) => renderToolButton(tool))}
                    </div>
                  </div>
                ))}
                {groupedTools.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-white/[0.08]">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">No tools match that search</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Try a different word like chat, notes, or github.</p>
                  </div>
                ) : null}
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
