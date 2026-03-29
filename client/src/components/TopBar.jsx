import {
  Copy,
  FileCode2,
  Home,
  PanelLeft,
  Play,
  Radio,
  Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import UserAvatar from "./UserAvatar";

function formatPathLabel(path) {
  if (!path) {
    return "No file selected";
  }

  const normalizedPath = String(path).replace(/\\/g, "/");
  const parts = normalizedPath.split("/").filter(Boolean);

  if (parts.length <= 3) {
    return normalizedPath;
  }

  return ["...", ...parts.slice(-2)].join("/");
}

function getSyncLabel(saveStatus, liveConnected) {
  if (saveStatus === "saving") {
    return "Syncing";
  }

  if (saveStatus === "error") {
    return "Sync issue";
  }

  if (!liveConnected) {
    return "Offline";
  }

  return "Live";
}

function getPresenceTone(collaborator, fallbackOnly = false) {
  if (fallbackOnly) {
    return "member";
  }

  if (collaborator?.typing?.isTyping) {
    return "typing";
  }

  if (collaborator?.activeFilePath || collaborator?.typing?.filePath) {
    return "active";
  }

  return "idle";
}

function toneClasses(tone) {
  if (tone === "typing") {
    return {
      chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
      dot: "bg-amber-400",
      avatar: "border-amber-200 bg-white dark:border-amber-500/30 dark:bg-zinc-900",
    };
  }

  if (tone === "active") {
    return {
      chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
      dot: "bg-emerald-400",
      avatar: "border-emerald-200 bg-white dark:border-emerald-500/30 dark:bg-zinc-900",
    };
  }

  if (tone === "member") {
    return {
      chip: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
      dot: "bg-zinc-400",
      avatar: "border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800",
    };
  }

  return {
    chip: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
    dot: "bg-zinc-400",
    avatar: "border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800",
  };
}

function PresenceChip({ className = "", children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

export default function TopBar({
  room,
  activePath,
  collaborators = [],
  activeCollaborators = [],
  pendingJoinRequestCount = 0,
  explorerOpen,
  onToggleExplorer,
  sidebarOpen,
  onToggleSidebar,
  onCopyInvite,
  onRun,
  isRunning,
  saveStatus = "saved",
  liveConnected = false,
  onOpenSettings,
  canEdit = true,
  canRun = true,
  canManageRoom = false,
}) {
  const navigate = useNavigate();
  const hasLivePresence = activeCollaborators.length > 0;
  const visibleCollaborators = hasLivePresence ? activeCollaborators : collaborators;
  const fallbackOnly = !hasLivePresence && collaborators.length > 0;
  const typingCollaborators = activeCollaborators.filter((collaborator) => collaborator.typing?.isTyping);
  const shownCollaborators = visibleCollaborators.slice(0, 5);
  const extraCollaborators = Math.max(visibleCollaborators.length - shownCollaborators.length, 0);
  const syncLabel = getSyncLabel(saveStatus, liveConnected);
  const activeFileLabel = formatPathLabel(activePath);

  return (
    <div className="border-b border-zinc-100 bg-white/85 backdrop-blur-xl dark:border-white/[0.04] dark:bg-[#09090b]/90">
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {/* Single clean explorer toggle icon */}
            <button
              onClick={onToggleExplorer}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                explorerOpen
                  ? "bg-violet-500/10 text-violet-400"
                  : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
              }`}
              title={explorerOpen ? "Hide files" : "Show files"}
            >
              <PanelLeft size={15} />
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {room?.name || "Workspace"}
                </p>
                {room?.templateName && (
                  <PresenceChip className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {room.templateName}
                  </PresenceChip>
                )}
                <PresenceChip
                  className={
                    saveStatus === "error"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                      : liveConnected
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                  }
                >
                  <Radio size={12} />
                  {syncLabel}
                </PresenceChip>
                {!canEdit && (
                  <PresenceChip className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    View only
                  </PresenceChip>
                )}
                {canManageRoom && pendingJoinRequestCount > 0 && (
                  <button
                    onClick={onOpenSettings}
                    className="outline-none flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-all hover:border-amber-500/60 hover:bg-amber-500/20"
                    title="Review join requests"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                    </span>
                    {pendingJoinRequestCount} waiting to join
                  </button>
                )}
              </div>

              <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <FileCode2 size={12} className="shrink-0" />
                <span className="truncate">{activeFileLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {activeCollaborators.length > 0 && (
              <PresenceChip className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {activeCollaborators.length} live
              </PresenceChip>
            )}

            {typingCollaborators.length > 0 && (
              <PresenceChip className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {typingCollaborators.length === 1
                  ? `${typingCollaborators[0].username} typing`
                  : `${typingCollaborators.length} typing`}
              </PresenceChip>
            )}

            {shownCollaborators.length > 0 && (
              <div className="hidden items-center gap-1.5 lg:flex">
                {shownCollaborators.map((collaborator) => {
                  const tone = getPresenceTone(collaborator, fallbackOnly);
                  const toneClass = toneClasses(tone);
                  const activeTarget = collaborator.typing?.filePath || collaborator.activeFilePath;
                  const detail = fallbackOnly
                    ? "Has access to this workspace"
                    : activeTarget
                      ? `In ${formatPathLabel(activeTarget)}`
                      : collaborator.typing?.isTyping
                        ? "Typing in the editor"
                        : "Active in room";

                  return (
                    <div
                      key={collaborator.userId || collaborator.id}
                      className={`relative rounded-full border ${toneClass.avatar}`}
                      title={`${collaborator.username} - ${detail}`}
                    >
                      <UserAvatar
                        username={collaborator.username}
                        size="sm"
                        className="border-0 bg-transparent shadow-none ring-0"
                      />
                      <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#09090b] ${toneClass.dot}`} />
                    </div>
                  );
                })}
                {extraCollaborators > 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    +{extraCollaborators}
                  </span>
                )}
              </div>
            )}

            <button
              onClick={onRun}
              disabled={isRunning || !canRun}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              title={canRun ? "Run active file" : "You need at least runner access to run files"}
            >
              <Play size={13} fill="currentColor" />
              <span>{isRunning ? "Running..." : "Run"}</span>
            </button>

            <button
              onClick={onCopyInvite}
              className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              title="Copy invite link"
            >
              <Copy size={14} />
              <span className="hidden sm:inline">Invite</span>
            </button>

            <button
              onClick={() => navigate("/home")}
              className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              title="Back to dashboard"
            >
              <Home size={14} />
              <span className="hidden sm:inline">Home</span>
            </button>

            {canManageRoom && (
              <button
                onClick={onOpenSettings}
                className="inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
                title="Room settings"
              >
                <Settings size={14} />
                <span className="hidden sm:inline">Settings</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
