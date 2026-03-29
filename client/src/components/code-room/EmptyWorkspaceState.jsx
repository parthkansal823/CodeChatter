import { FilePlus2, FolderPlus, Sparkles, Users } from "lucide-react";

import { Button } from "../ui/Button";

export default function EmptyWorkspaceState({ onCreateFile, onCreateFolder }) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-white dark:bg-zinc-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.12),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.1),transparent_35%)]" />

      <div className="relative w-full max-w-3xl px-6">
        <div className="rounded-[28px] border border-zinc-200 bg-white/90 p-8 text-center shadow-xl shadow-zinc-200/40 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/90 dark:shadow-black/20">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            <Sparkles size={24} />
          </div>

          <p className="mt-5 text-2xl font-semibold text-zinc-900 dark:text-white">
            Start this workspace your way
          </p>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Add the first file or folder and everyone in the room will immediately see the same workspace.
          </p>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={onCreateFile}>
              <FilePlus2 size={16} className="mr-2" />
              Create First File
            </Button>
            <Button onClick={onCreateFolder} variant="outline">
              <FolderPlus size={16} className="mr-2" />
              Create Folder
            </Button>
          </div>

          <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-700 shadow-sm dark:bg-zinc-950 dark:text-zinc-200">
                <FilePlus2 size={18} />
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Start coding fast</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Drop in a starter file and begin editing right away with realtime sync.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-700 shadow-sm dark:bg-zinc-950 dark:text-zinc-200">
                <FolderPlus size={18} />
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Organize clearly</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Create folders for components, notes, solutions, or anything your team needs.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-700 shadow-sm dark:bg-zinc-950 dark:text-zinc-200">
                <Users size={18} />
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Collaborate live</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Invite others, code together, and watch presence updates once they join the room.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
