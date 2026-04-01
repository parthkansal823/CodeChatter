/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  Activity, Bot, Code2, File, Play, RefreshCw, Save, Trash2, UserMinus, UserPlus,
} from "lucide-react";

export const ACTIVITY_STORAGE_PREFIX = "cc-activity-";
const MAX_ENTRIES = 60;

const TYPE_META = {
  file_open:   { icon: File,      color: "text-sky-500",     bg: "bg-sky-50 dark:bg-sky-900/20" },
  file_create: { icon: File,      color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  file_delete: { icon: Trash2,    color: "text-red-500",     bg: "bg-red-50 dark:bg-red-900/20" },
  code_run:    { icon: Play,      color: "text-green-500",   bg: "bg-green-50 dark:bg-green-900/20" },
  code_error:  { icon: Code2,     color: "text-red-500",     bg: "bg-red-50 dark:bg-red-900/20" },
  code_save:   { icon: Save,      color: "text-violet-500",  bg: "bg-violet-50 dark:bg-violet-900/20" },
  user_join:   { icon: UserPlus,  color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  user_leave:  { icon: UserMinus, color: "text-zinc-500",    bg: "bg-zinc-100 dark:bg-zinc-800" },
  ai_query:    { icon: Bot,       color: "text-amber-500",   bg: "bg-amber-50 dark:bg-amber-900/20" },
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Call this from any component to log an activity for a room. */
export function logActivity(roomId, type, message) {
  if (!roomId) return;
  const key = ACTIVITY_STORAGE_PREFIX + roomId;
  try {
    const existing = JSON.parse(sessionStorage.getItem(key) || "[]");
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      message,
      timestamp: new Date().toISOString(),
    };
    const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
    sessionStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("cc-activity", { detail: { roomId } }));
  } catch { /* ignore */ }
}

export default function ActivityLog({ roomId }) {
  const [activities, setActivities] = useState([]);

  const load = useCallback(() => {
    if (!roomId) return;
    try {
      const raw = sessionStorage.getItem(ACTIVITY_STORAGE_PREFIX + roomId);
      setActivities(raw ? JSON.parse(raw) : []);
    } catch {
      setActivities([]);
    }
  }, [roomId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const handler = (e) => { if (e.detail?.roomId === roomId) load(); };
    window.addEventListener("cc-activity", handler);
    return () => window.removeEventListener("cc-activity", handler);
  }, [roomId, load]);

  const clear = () => {
    if (roomId) sessionStorage.removeItem(ACTIVITY_STORAGE_PREFIX + roomId);
    setActivities([]);
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0d0d10]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-violet-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Activity Log</span>
          {activities.length > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {activities.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={load}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
          {activities.length > 0 && (
            <button
              onClick={clear}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              title="Clear log"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Activity size={22} className="text-zinc-300 dark:text-zinc-600" />
            </Motion.div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No activity yet</p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Actions in this room appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            <AnimatePresence initial={false}>
              {activities.map((a) => {
                const meta = TYPE_META[a.type] || TYPE_META.code_save;
                const Icon = meta.icon;
                return (
                  <Motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
                      <Icon size={13} className={meta.color} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{a.message}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">{timeAgo(a.timestamp)}</p>
                    </div>
                  </Motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
