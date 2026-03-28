import { Copy, Home, PanelLeft, PanelRight, Play, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "./UserAvatar";

function StatusText({ saveStatus, liveConnected }) {
  if (saveStatus === "saving") {
    return <span className="text-amber-600 dark:text-amber-400">Syncing...</span>;
  }

  if (saveStatus === "error") {
    return <span className="text-red-600 dark:text-red-400">Sync failed</span>;
  }

  if (!liveConnected) {
    return <span className="text-zinc-500 dark:text-zinc-400">Realtime offline</span>;
  }

  return <span className="text-emerald-600 dark:text-emerald-400">Live</span>;
}

export default function TopBar({
  room,
  activePath,
  collaborators = [],
  activeCollaborators = [],
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
  canManageRoom = false,
}) {
  const navigate = useNavigate();
  const visibleCollaborators = activeCollaborators.length > 0 ? activeCollaborators : collaborators;
  const typingCollaborators = visibleCollaborators.filter((collaborator) => collaborator.typing?.isTyping);

  return (
    <div className="border-b border-zinc-100 bg-white/70 backdrop-blur-md px-3 py-2 dark:border-white/[0.04] dark:bg-[#09090b]/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onToggleExplorer}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors ${explorerOpen
              ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
              : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              }`}
            title="Toggle files"
          >
            <PanelLeft size={16} />
            <span className="hidden sm:inline">Files</span>
          </button>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {room?.name || "Workspace"}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {activePath || "No file selected"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            <StatusText saveStatus={saveStatus} liveConnected={liveConnected} />
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            {activeCollaborators.length > 0 && (
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {activeCollaborators.length} live
              </span>
            )}
            {typingCollaborators.length > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {typingCollaborators.length === 1 ? "Typing" : `${typingCollaborators.length} typing`}
              </span>
            )}
            <div className="flex items-center">
              {visibleCollaborators.slice(0, 5).map((collaborator) => {
                const isTyping = Boolean(collaborator.typing?.isTyping);
                const activeTarget = collaborator.typing?.filePath || collaborator.activeFilePath;

                return (
                  <div
                    key={collaborator.userId || collaborator.id}
                    className={`relative -ml-2 first:ml-0 ${isTyping ? "z-10" : ""}`}
                    title={
                      activeTarget
                        ? `${collaborator.username} ${isTyping ? "is typing in" : "editing"} ${activeTarget}`
                        : collaborator.username
                    }
                  >
                    {isTyping && (
                      <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.18)] dark:border-zinc-950" />
                    )}
                    <UserAvatar
                      username={collaborator.username}
                      size="base"
                      className={`border-2 border-white bg-zinc-100 transition-all dark:border-zinc-950 dark:bg-zinc-800 ${isTyping ? "scale-110 ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950" : ""}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <button
            onClick={onRun}
            disabled={isRunning}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:text-white dark:hover:bg-emerald-500"
          >
            <Play size={14} fill="currentColor" />
            <span>{isRunning ? "Running..." : "Run"}</span>
          </button>

          <button
            onClick={onCopyInvite}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
            title="Copy invite link"
          >
            <Copy size={15} />
            <span className="hidden sm:inline">Invite</span>
          </button>

          <button
            onClick={() => navigate("/home")}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
            title="Back to dashboard"
          >
            <Home size={15} />
            <span className="hidden sm:inline">Home</span>
          </button>

          {canManageRoom && (
            <button
              onClick={onOpenSettings}
              className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              title="Room Settings"
            >
              <Settings size={15} />
              <span className="hidden sm:inline">Settings</span>
            </button>
          )}

          <button
            onClick={onToggleSidebar}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors ${sidebarOpen
              ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
              : "text-zinc-500 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              }`}
            title="Toggle tools"
          >
            <PanelRight size={16} />
            <span className="hidden sm:inline">Tools</span>
          </button>
        </div>
      </div>
    </div>
  );
}
