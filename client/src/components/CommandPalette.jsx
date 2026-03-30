import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  Activity, Bell, FolderGit2, Home, Keyboard, LogOut, Moon, Plus, Search, Settings, Sun, User,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../context/NotificationsContext";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";

const STATIC_COMMANDS = [
  { id: "home",         title: "Go to Dashboard",     icon: Home,        section: "Navigation", path: "/home" },
  { id: "profile",      title: "View Profile",         icon: User,        section: "Navigation", path: "/profile" },
  { id: "settings",     title: "Preferences",          icon: Settings,    section: "Navigation", path: "/settings" },
  { id: "create-room",  title: "Create New Room",      icon: Plus,        section: "Quick Actions", path: "/home" },
  { id: "notifications",title: "Notifications",        icon: Bell,        section: "Quick Actions", path: "/profile" },
  { id: "activity",     title: "View Activity Log",    icon: Activity,    section: "Quick Actions", path: "/home" },
  { id: "shortcuts",    title: "Keyboard Shortcuts",   icon: Keyboard,    section: "Quick Actions" },
];

export default function CommandPalette({ theme, onThemeChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { unreadCount } = useNotifications();
  const inputRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((open) => !open);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const allCommands = useMemo(() => ([
    ...STATIC_COMMANDS.map(cmd =>
      cmd.id === "notifications" && unreadCount > 0
        ? { ...cmd, title: `Notifications (${unreadCount} unread)` }
        : cmd
    ),
    {
      id: "theme",
      title: `Switch to ${theme === "vs-dark" ? "Light" : "Dark"} Theme`,
      icon: theme === "vs-dark" ? Sun : Moon,
      section: "Appearance",
      action: () => onThemeChange(theme === "vs-dark" ? "vs" : "vs-dark"),
    },
    {
      id: "logout",
      title: "Sign out",
      icon: LogOut,
      section: "Account",
      action: async () => {
        await logout();
        navigate("/auth");
      },
    },
  ]), [logout, navigate, onThemeChange, theme, unreadCount]);

  const filtered = useMemo(() => (
    query.trim() === ""
      ? allCommands
      : allCommands.filter((cmd) => cmd.title.toLowerCase().includes(query.toLowerCase()))
  ), [allCommands, query]);

  const normalizedSelectedIndex = filtered.length
    ? Math.min(selectedIndex, filtered.length - 1)
    : 0;

  const handleSelect = useCallback((command) => {
    if (command.id === "shortcuts") {
      setShortcutsOpen(true);
    } else if (command.path) {
      navigate(command.path);
    } else if (command.action) {
      command.action();
    }
    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, [navigate]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e) => {
      if (!filtered.length) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[normalizedSelectedIndex]) handleSelect(filtered[normalizedSelectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, filtered, normalizedSelectedIndex, handleSelect]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      // Small timeout to ensure DOM draws the input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  return (
    <>
    <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
        >
          {/* Backdrop */}
          <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />

          {/* Palette Modal */}
          <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#09090b]/80">
            <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-4 dark:border-white/10">
              <Search className="text-zinc-400 dark:text-zinc-500" size={20} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command or search..."
                className="flex-1 bg-transparent text-base text-zinc-900 placeholder-zinc-400 outline-none dark:text-white dark:placeholder-zinc-600"
              />
              <div className="flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <span>esc</span>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No commands found for{" "}
                  <span className="text-zinc-900 dark:text-white">"{query}"</span>
                </div>
              ) : (
                (() => {
                  const sections = [];
                  const seen = new Set();
                  filtered.forEach(cmd => {
                    if (!seen.has(cmd.section)) { seen.add(cmd.section); sections.push(cmd.section); }
                  });
                  return sections.map(section => (
                    <div key={section} className="mb-1">
                      <p className="mb-1 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                        {section}
                      </p>
                      {filtered
                        .filter(cmd => cmd.section === section)
                        .map(cmd => {
                          const idx = filtered.indexOf(cmd);
                          const isSelected = idx === normalizedSelectedIndex;
                          return (
                            <Motion.button
                              key={cmd.id}
                              onMouseEnter={() => setSelectedIndex(idx)}
                              onClick={() => handleSelect(cmd)}
                              whileHover={{ x: 2 }}
                              transition={{ duration: 0.1 }}
                              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                                isSelected
                                  ? "bg-brand-600 text-white shadow-md shadow-brand-600/20"
                                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5"
                              }`}
                            >
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                                  isSelected
                                    ? "bg-white/20 text-white"
                                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                                }`}
                              >
                                <cmd.icon size={15} />
                              </div>
                              <p className="flex-1 text-sm font-medium">{cmd.title}</p>
                              {isSelected && (
                                <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
                                  ↵
                                </kbd>
                              )}
                            </Motion.button>
                          );
                        })}
                    </div>
                  ));
                })()
              )}
            </div>
            <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-white/10 dark:bg-[#050505] dark:text-zinc-400">
              <span className="font-semibold text-zinc-900 dark:text-zinc-300">Tip:</span> Use arrows to navigate and enter to select.
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
    </>
  );
}
