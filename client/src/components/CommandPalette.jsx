import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Search, FolderGit2, Home, Settings, LogOut, Sun, Moon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

const COMMANDS = [
  { id: "home", title: "Go to Dashboard", icon: Home, section: "Navigation", path: "/home" },
  { id: "settings", title: "Preferences", icon: Settings, section: "Navigation", path: "/settings" },
];

export default function CommandPalette({ theme, onThemeChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { logout } = useAuth();
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
    ...COMMANDS,
    {
      id: "theme",
      title: `Switch to ${theme === "vs-dark" ? "Light" : "Dark"} Theme`,
      icon: theme === "vs-dark" ? Sun : Moon,
      section: "Actions",
      action: () => onThemeChange(theme === "vs-dark" ? "vs" : "vs-dark"),
    },
    {
      id: "logout",
      title: "Logout securely",
      icon: LogOut,
      section: "Actions",
      action: async () => {
        await logout();
        navigate("/auth");
      },
    },
  ]), [logout, navigate, onThemeChange, theme]);

  const filtered = useMemo(() => (
    query.trim() === ""
      ? allCommands
      : allCommands.filter((cmd) => cmd.title.toLowerCase().includes(query.toLowerCase()))
  ), [allCommands, query]);

  const normalizedSelectedIndex = filtered.length
    ? Math.min(selectedIndex, filtered.length - 1)
    : 0;

  const handleSelect = useCallback((command) => {
    if (command.path) {
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
                  No commands found for <span className="text-zinc-900 dark:text-white">"{query}"</span>
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((cmd, idx) => {
                    const isSelected = idx === normalizedSelectedIndex;
                    return (
                      <button
                        key={cmd.id}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={() => handleSelect(cmd)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
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
                          <cmd.icon size={16} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{cmd.title}</p>
                          <p className={`text-[11px] ${isSelected ? "text-brand-200" : "text-zinc-500 dark:text-zinc-500"}`}>
                            {cmd.section}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="text-[10px] font-medium tracking-wider text-brand-200 opacity-80">
                            ENTER
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-500 dark:border-white/10 dark:bg-[#050505] dark:text-zinc-400">
              <span className="font-semibold text-zinc-900 dark:text-zinc-300">Tip:</span> Use arrows to navigate and enter to select.
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
