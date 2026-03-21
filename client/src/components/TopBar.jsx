import { Copy, Home, PanelLeft, PanelRight, Play, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";

function StatusText({ saveStatus }) {
  if (saveStatus === "saving") {
    return <span className="text-amber-600 dark:text-amber-400">Saving...</span>;
  }

  if (saveStatus === "error") {
    return <span className="text-red-600 dark:text-red-400">Save failed</span>;
  }

  return <span>Saved</span>;
}

export default function TopBar({
  room,
  activePath,
  collaborators = [],
  explorerOpen,
  onToggleExplorer,
  sidebarOpen,
  onToggleSidebar,
  onCopyInvite,
  onRun,
  isRunning,
  saveStatus = "saved",
  onOpenSettings
}) {
  const navigate = useNavigate();

  return (
    <div className="border-b border-zinc-100 bg-white/70 backdrop-blur-md px-3 py-2 dark:border-white/[0.04] dark:bg-[#09090b]/80">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onToggleExplorer}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors ${
              explorerOpen
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
          <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 lg:block">
            <StatusText saveStatus={saveStatus} />
          </div>

          <div className="hidden items-center sm:flex">
            {collaborators.slice(0, 5).map((collaborator, index) => (
              <img
                key={collaborator.id}
                title={collaborator.username}
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(collaborator.username || "U")}&background=random&color=fff&size=128`}
                alt={collaborator.username}
                className="-ml-2 h-8 w-8 rounded-full border-2 border-white bg-zinc-100 object-cover first:ml-0 dark:border-zinc-950 dark:bg-zinc-800"
              />
            ))}
          </div>

          <button
            onClick={onRun}
            disabled={isRunning}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-purple-600 px-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-purple-600 dark:text-white dark:hover:bg-purple-500"
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

          <button
            onClick={onOpenSettings}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-200"
            title="Room Settings"
          >
            <Settings size={15} />
            <span className="hidden sm:inline">Settings</span>
          </button>

          <button
            onClick={onToggleSidebar}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors ${
              sidebarOpen
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
