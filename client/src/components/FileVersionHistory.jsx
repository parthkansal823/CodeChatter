import { useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Clock, RotateCcw, Trash2, X, CheckCircle } from "lucide-react";

const VERSION_PREFIX = "cc-fvh-";
const MAX_VERSIONS = 15;

function makeKey(roomId, filePath) {
  return `${VERSION_PREFIX}${roomId || "local"}-${filePath || "untitled"}`;
}

/** Save a snapshot of a file. Call this on Ctrl+S or periodic auto-save. */
export function saveFileVersion(roomId, filePath, content) {
  if (!filePath || content === undefined) return;
  const key = makeKey(roomId, filePath);
  try {
    const existing = JSON.parse(localStorage.getItem(key) || "[]");
    // Skip if content identical to last version
    if (existing.length > 0 && existing[0].content === content) return;
    const entry = {
      id: `${Date.now()}`,
      timestamp: new Date().toISOString(),
      size: content.length,
      content,
    };
    const updated = [entry, ...existing].slice(0, MAX_VERSIONS);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch { /* ignore */ }
}

/** Load all saved versions for a file. */
export function loadFileVersions(roomId, filePath) {
  if (!filePath) return [];
  try {
    const raw = localStorage.getItem(makeKey(roomId, filePath));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function timeLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1)  return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)  return `${diffHrs}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FileVersionHistory({ roomId, filePath, fileName, onRestore, onClose }) {
  const versions = loadFileVersions(roomId, filePath);
  const [restored, setRestored] = useState(null);

  const handleRestore = (entry) => {
    onRestore?.(entry.content);
    setRestored(entry.id);
    setTimeout(() => setRestored(null), 1800);
  };

  const deleteVersion = (id) => {
    const key = makeKey(roomId, filePath);
    try {
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify(existing.filter(e => e.id !== id)));
    } catch { /* ignore */ }
  };

  return (
    <Motion.div
      initial={{ opacity: 0, x: 16, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      style={{ width: 260 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2 min-w-0">
          <Clock size={14} className="shrink-0 text-violet-400" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-900 dark:text-white">Version History</p>
            {fileName && (
              <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{fileName}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center px-4">
            <Clock size={20} className="text-zinc-300 dark:text-zinc-600" />
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">No saved versions</p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Press Ctrl+S to save a version snapshot
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {versions.map((entry, i) => (
              <div key={entry.id} className="group flex items-start gap-2 px-3 py-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-[9px] font-bold text-violet-600 dark:bg-violet-900/20 dark:text-violet-400">
                  {versions.length - i}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                    {i === 0 ? "Latest save" : timeLabel(entry.timestamp)}
                  </p>
                  <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                    {i !== 0 && timeLabel(entry.timestamp) !== timeLabel(entry.timestamp) ? timeLabel(entry.timestamp) : new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" · "}{entry.size.toLocaleString()} chars
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleRestore(entry)}
                    className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-900/20 dark:hover:text-violet-400"
                    title="Restore this version"
                  >
                    <AnimatePresence mode="wait">
                      {restored === entry.id ? (
                        <Motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                          <CheckCircle size={13} className="text-green-500" />
                        </Motion.div>
                      ) : (
                        <Motion.div key="restore" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                          <RotateCcw size={13} />
                        </Motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                  {i > 0 && (
                    <button
                      onClick={() => deleteVersion(entry.id)}
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Delete this version"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          Up to {MAX_VERSIONS} versions per file · Ctrl+S to snapshot
        </p>
      </div>
    </Motion.div>
  );
}
