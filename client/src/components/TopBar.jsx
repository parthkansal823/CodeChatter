import { Copy, Home, PanelLeft, PanelRight, Play } from "lucide-react";
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
  sidebarOpen,
  onToggleExplorer,
  onToggleSidebar,
  onCopyInvite,
  onRun,
  isRunning,
  saveStatus = "saved"
}) {
  const navigate = useNavigate();

  return (
    <div className="border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onToggleExplorer}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
              explorerOpen
                ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-white"
            }`}
            title="Toggle files"
          >
            <PanelLeft size={16} />
            <span className="hidden sm:inline">Files</span>
          </button>

          <button
            onClick={onToggleSidebar}
            className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
              sidebarOpen
                ? "border-zinc-300 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-white"
            }`}
            title="Toggle tools"
          >
            <PanelRight size={16} />
            <span className="hidden sm:inline">Tools</span>
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
              <div
                key={collaborator.id}
                title={collaborator.username}
                className={`-ml-2 flex h-8 w-8 items-center justify-center rounded-full border border-white bg-zinc-900 text-xs font-semibold text-white first:ml-0 dark:border-zinc-950 ${
                  index === 0 ? "bg-cyan-600" : index === 1 ? "bg-blue-600" : index === 2 ? "bg-emerald-600" : index === 3 ? "bg-violet-600" : "bg-amber-600"
                }`}
              >
                {collaborator.username?.charAt(0).toUpperCase()}
              </div>
            ))}
          </div>

          <button
            onClick={onRun}
            disabled={isRunning}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:border-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <Play size={15} />
            <span>{isRunning ? "Running..." : "Run"}</span>
          </button>

          <button
            onClick={onCopyInvite}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-white"
            title="Copy invite link"
          >
            <Copy size={15} />
            <span className="hidden sm:inline">Invite</span>
          </button>

          <button
            onClick={() => navigate("/home")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-white"
            title="Back to dashboard"
          >
            <Home size={15} />
            <span className="hidden sm:inline">Home</span>
          </button>
        </div>
      </div>
    </div>
  );
}
