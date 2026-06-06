import { useEffect, useRef } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  Bell, BellOff, CheckCheck, Trash2, X,
  Info, AlertCircle, UserPlus, FolderGit2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useNotifications } from "../context/NotificationsContext";

const TYPE_META = {
  join_request: {
    icon: UserPlus,
    colorClass: "text-violet-500 bg-violet-50 dark:bg-violet-900/20",
  },
  room_invite: {
    icon: FolderGit2,
    colorClass: "text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20",
  },
  room_deleted: {
    icon: AlertCircle,
    colorClass: "text-red-500 bg-red-50 dark:bg-red-900/20",
  },
  info: {
    icon: Info,
    colorClass: "text-sky-500 bg-sky-50 dark:bg-sky-900/20",
  },
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsPanel({ isOpen, onClose }) {
  const { notifications, unreadCount, markAllRead, markRead, removeNotification, clearAll } =
    useNotifications();
  const navigate = useNavigate();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (!panelRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  const handleClick = (notif) => {
    markRead(notif.id);
    if (notif.roomId) navigate(`/room/${notif.roomId}`);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.14 }}
          className="absolute right-0 top-10 z-50 w-80 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-zinc-700 dark:text-zinc-200" />
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  title="Mark all read"
                >
                  <CheckCheck size={14} />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  title="Clear all"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <BellOff size={24} className="text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">All caught up!</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No notifications yet</p>
              </div>
            ) : (
              notifications.map(notif => {
                const meta = TYPE_META[notif.type] || TYPE_META.info;
                const Icon = meta.icon;
                return (
                  <div
                    key={notif.id}
                    className={`relative flex gap-3 border-b border-zinc-100 px-4 py-3.5 last:border-b-0 dark:border-zinc-800 ${
                      !notif.read ? "bg-violet-50/40 dark:bg-violet-900/5" : ""
                    }`}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.colorClass}`}>
                      <Icon size={14} />
                    </div>
                    <button className="flex-1 text-left" onClick={() => handleClick(notif)}>
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs font-semibold leading-snug ${
                          notif.read
                            ? "text-zinc-700 dark:text-zinc-300"
                            : "text-zinc-900 dark:text-white"
                        }`}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{notif.message}</p>
                      <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">{timeAgo(notif.timestamp)}</p>
                    </button>
                    <button
                      onClick={() => removeNotification(notif.id)}
                      className="mt-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
