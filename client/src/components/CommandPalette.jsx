import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  Activity,
  Bell,
  Bot,
  FileCode2,
  FileText,
  FolderGit2,
  FolderPlus,
  Github,
  Home,
  Keyboard,
  LogOut,
  MessageCircleMore,
  Moon,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Sun,
  Timer,
  User,
  Video,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../context/NotificationsContext";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";

const STATIC_COMMANDS = [
  { id: "home", title: "Go to Dashboard", icon: Home, section: "Navigation", path: "/home" },
  { id: "profile", title: "View Profile", icon: User, section: "Navigation", path: "/profile" },
  { id: "settings", title: "Preferences", icon: Settings, section: "Navigation", path: "/settings" },
  { id: "create-room", title: "Create New Room", icon: Plus, section: "Quick Actions", path: "/home" },
  { id: "notifications", title: "Notifications", icon: Bell, section: "Quick Actions", path: "/profile" },
  { id: "activity", title: "View Activity Log", icon: Activity, section: "Quick Actions", path: "/home" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: Keyboard, section: "Quick Actions" },
];

function commandMatchesQuery(command, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = [
    command.title,
    command.subtitle,
    command.section,
    ...(Array.isArray(command.keywords) ? command.keywords : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function getWorkspaceCommands(roomContext, normalizedQuery) {
  if (!roomContext) {
    return [];
  }

  const commands = [];

  if (roomContext.canRun) {
    commands.push({
      id: "room-run",
      title: "Run Active File",
      subtitle: roomContext.roomName,
      icon: Play,
      section: "Workspace",
      action: () => roomContext.actions?.runActiveFile?.(),
    });
  }

  if (roomContext.canEdit) {
    commands.push(
      {
        id: "room-create-file",
        title: "Create New File",
        subtitle: roomContext.roomName,
        icon: FileCode2,
        section: "Workspace",
        action: () => roomContext.actions?.createFile?.(),
      },
      {
        id: "room-create-folder",
        title: "Create New Folder",
        subtitle: roomContext.roomName,
        icon: FolderPlus,
        section: "Workspace",
        action: () => roomContext.actions?.createFolder?.(),
      },
    );
  }

  commands.push(
    {
      id: "room-copy-invite",
      title: "Copy Invite Link",
      subtitle: roomContext.roomName,
      icon: Share2,
      section: "Workspace",
      action: () => roomContext.actions?.copyInvite?.(),
    },
    {
      id: "room-guide",
      title: "Open Workspace Guide",
      subtitle: roomContext.roomName,
      icon: Sparkles,
      section: "Workspace",
      action: () => roomContext.actions?.openTutorial?.(),
    },
    {
      id: "room-toggle-explorer",
      title: "Toggle File Explorer",
      subtitle: roomContext.roomName,
      icon: PanelLeft,
      section: "Workspace",
      action: () => roomContext.actions?.toggleExplorer?.(),
    },
    {
      id: "room-toggle-tools",
      title: "Toggle Workspace Tools",
      subtitle: roomContext.roomName,
      icon: PanelRight,
      section: "Workspace",
      action: () => roomContext.actions?.toggleSidebar?.(),
    },
    {
      id: "room-overview",
      title: "Open Workspace Overview",
      subtitle: roomContext.roomName,
      icon: PanelRight,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("overview"),
    },
    {
      id: "room-chat",
      title: "Open Room Chat",
      subtitle: roomContext.roomName,
      icon: MessageCircleMore,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("chat"),
    },
    {
      id: "room-ai",
      title: "Open AI Help",
      subtitle: roomContext.roomName,
      icon: Bot,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("ai"),
    },
    {
      id: "room-flowchart",
      title: "Open Flowchart",
      subtitle: roomContext.roomName,
      icon: FolderGit2,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("flowchart"),
    },
    {
      id: "room-github",
      title: "Open GitHub",
      subtitle: roomContext.roomName,
      icon: Github,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("github"),
    },
    {
      id: "room-activity",
      title: "Open Activity Log",
      subtitle: roomContext.roomName,
      icon: Activity,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("activity"),
    },
    {
      id: "room-notes",
      title: "Open Quick Notes",
      subtitle: roomContext.roomName,
      icon: FileText,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("notes"),
    },
    {
      id: "room-whiteboard",
      title: "Open Whiteboard",
      subtitle: roomContext.roomName,
      icon: Sparkles,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("whiteboard"),
    },
    {
      id: "room-pomodoro",
      title: "Open Pomodoro",
      subtitle: roomContext.roomName,
      icon: Timer,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("pomodoro"),
    },
    {
      id: "room-video",
      title: "Open Video Call",
      subtitle: roomContext.roomName,
      icon: Video,
      section: "Tools",
      action: () => roomContext.actions?.openTool?.("video"),
    },
  );

  if (roomContext.canManage) {
    commands.push({
      id: "room-settings",
      title: "Open Room Settings",
      subtitle: roomContext.roomName,
      icon: Settings,
      section: "Workspace",
      action: () => roomContext.actions?.openSettings?.(),
    });
  }

  const fileCommands = [...(roomContext.files || [])]
    .sort((leftFile, rightFile) => {
      if (leftFile.isActive !== rightFile.isActive) {
        return leftFile.isActive ? -1 : 1;
      }

      if (leftFile.isOpen !== rightFile.isOpen) {
        return leftFile.isOpen ? -1 : 1;
      }

      return leftFile.path.localeCompare(rightFile.path, undefined, { sensitivity: "base" });
    })
    .filter((file) => {
      if (!normalizedQuery) {
        return true;
      }

      return `${file.name} ${file.path}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(normalizedQuery ? 40 : 10)
    .map((file) => ({
      id: `room-file-${file.id}`,
      title: file.name,
      subtitle: file.path,
      icon: FileCode2,
      section: "Files",
      keywords: [file.path, roomContext.roomName],
      action: () => roomContext.actions?.openFile?.(file.id),
    }));

  return [...commands, ...fileCommands];
}

export default function CommandPalette({ theme, onThemeChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [roomContext, setRoomContext] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { unreadCount } = useNotifications();
  const inputRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen((open) => {
          if (!open) {
            setSelectedIndex(0);
            setQuery("");
          }
          return !open;
        });
      }

      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    const handleRoomContext = (event) => {
      setRoomContext(event.detail || null);
    };

    window.addEventListener("cc-room-command-context", handleRoomContext);
    return () => window.removeEventListener("cc-room-command-context", handleRoomContext);
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const activeRoomContext = location.pathname.startsWith("/room") ? roomContext : null;

  const workspaceCommands = useMemo(() => {
    return getWorkspaceCommands(activeRoomContext, normalizedQuery);
  }, [activeRoomContext, normalizedQuery]);

  const allCommands = useMemo(() => ([
    ...STATIC_COMMANDS.map((command) =>
      command.id === "notifications" && unreadCount > 0
        ? { ...command, title: `Notifications (${unreadCount} unread)` }
        : command,
    ),
    ...workspaceCommands,
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
  ]), [logout, navigate, onThemeChange, theme, unreadCount, workspaceCommands]);

  const filtered = useMemo(() => {
    if (!normalizedQuery) {
      return allCommands;
    }

    return allCommands.filter((command) => commandMatchesQuery(command, normalizedQuery));
  }, [allCommands, normalizedQuery]);

  const normalizedSelectedIndex = filtered.length
    ? Math.min(selectedIndex, filtered.length - 1)
    : 0;

  const handleSelect = useCallback(async (command) => {
    if (command.id === "shortcuts") {
      setShortcutsOpen(true);
    } else if (command.path) {
      navigate(command.path);
    } else if (command.action) {
      await command.action();
    }

    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, [navigate]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKey = (event) => {
      if (!filtered.length) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((previousIndex) => (previousIndex + 1) % filtered.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((previousIndex) => (previousIndex - 1 + filtered.length) % filtered.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (filtered[normalizedSelectedIndex]) {
          handleSelect(filtered[normalizedSelectedIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [filtered, handleSelect, isOpen, normalizedSelectedIndex]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen]);

  return (
    <>
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
            <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />

            <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#09090b]/80">
              <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-4 dark:border-white/10">
                <Search className="text-zinc-400 dark:text-zinc-500" size={20} />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedIndex(0);
                  }}
                  placeholder={activeRoomContext
                    ? "Search files, tools, and workspace actions..."
                    : "Type a command or search..."}
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
                    const seenSections = new Set();

                    filtered.forEach((command) => {
                      if (!seenSections.has(command.section)) {
                        seenSections.add(command.section);
                        sections.push(command.section);
                      }
                    });

                    return sections.map((section) => (
                      <div key={section} className="mb-1">
                        <p className="mb-1 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                          {section}
                        </p>
                        {filtered
                          .filter((command) => command.section === section)
                          .map((command) => {
                            const index = filtered.indexOf(command);
                            const isSelected = index === normalizedSelectedIndex;

                            return (
                              <Motion.button
                                key={command.id}
                                onMouseEnter={() => setSelectedIndex(index)}
                                onClick={() => handleSelect(command)}
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
                                  <command.icon size={15} />
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{command.title}</p>
                                  {command.subtitle && (
                                    <p className={`mt-0.5 text-xs ${
                                      isSelected ? "text-white/75" : "text-zinc-400 dark:text-zinc-500"
                                    }`}>
                                      {command.subtitle}
                                    </p>
                                  )}
                                </div>
                                {isSelected && (
                                  <kbd className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
                                    Enter
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
