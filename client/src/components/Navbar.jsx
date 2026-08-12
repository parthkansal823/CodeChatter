import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  Bell,
  Circle,
  Home,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  User,
  X
} from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "../context/NotificationsContext";
import BrandLogo from "./BrandLogo";
import UserAvatar from "./UserAvatar";
import NotificationsPanel from "./NotificationsPanel";

export default function Navbar({
  theme,
  onThemeChange,
  minimal = false,
  contextLabel = "Workspace",
  contextValue = "",
  contextHint = ""
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [presence, setPresence] = useState(() => {
    try { return localStorage.getItem("cc-presence") || "available"; } catch { return "available"; }
  });
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);
  const notifRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (!dropdownRef.current?.contains(event.target)) setDropdownOpen(false);
      if (!notifRef.current?.contains(event.target)) setNotifOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const PRESENCE_OPTIONS = [
    { id: "available", label: "Available", color: "bg-success-500" },
    { id: "busy",      label: "Busy",      color: "bg-warning-500"   },
    { id: "away",      label: "Away",      color: "bg-panel"    },
    { id: "focus",     label: "Focus",     color: "bg-brand-500"  },
  ];
  const presenceColor = PRESENCE_OPTIONS.find(p => p.id === presence)?.color || "bg-success-500";

  const setPresenceOption = (id) => {
    setPresence(id);
    try { localStorage.setItem("cc-presence", id); } catch { /* ignore */ }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/auth");
  };

  const toggleTheme = () => {
    const nextTheme = theme === "vs-dark" ? "vs" : "vs-dark";
    onThemeChange?.(nextTheme);
  };

  const goTo = (path) => {
    navigate(path);
    setDropdownOpen(false);
    setMobileMenuOpen(false);
  };

  const navItems = [
    { label: "Dashboard", icon: Home,     path: "/home" },
    { label: "Settings",  icon: Settings, path: "/settings" },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-edge-subtle bg-panel backdrop-blur-sm">
      <div className={`mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 md:px-6 ${minimal ? "h-11" : "h-14"
        }`}>
        {/* Logo + context */}
        <div className="flex min-w-0 items-center gap-3">
          <Motion.button
            onClick={() => goTo("/home")}
            className="flex min-w-0 items-center rounded-lg px-1 py-1 text-left transition-opacity hover:opacity-80"
            
            whileTap={{ scale: 0.97 }}
          >
            <BrandLogo size="sm" />
          </Motion.button>

          {contextValue && (
            <div className="hidden min-w-0 items-center gap-2 text-sm text-fg-muted md:flex">
              <span>/</span>
              <span className="truncate font-mono text-fg">
                {contextValue}
              </span>
              {contextHint && (
                <span className="text-xs text-fg-subtle">{contextHint}</span>
              )}
            </div>
          )}
        </div>

        {/* Desktop nav links */}
        {!minimal && (
          <div className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              const Icon = item.icon;

              return (
                <button
                  key={item.label}
                  onClick={() => goTo(item.path)}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${isActive
                      ? "bg-hovered text-fg"
                      : "text-fg-muted hover:bg-hovered hover:text-fg"
                    }`}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Right controls */}
        <div className="flex items-center gap-2">
          {/* Notifications bell */}
          <div className="relative hidden sm:block" ref={notifRef}>
            <button
              onClick={() => { setNotifOpen(v => !v); setDropdownOpen(false); }}
              className="relative inline-flex h-8 items-center justify-center rounded-lg border border-edge-subtle bg-panel px-2.5 text-fg transition-colors hover:border-edge-subtle"
              title="Notifications"
            >
              <Bell size={15} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[9px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            <NotificationsPanel isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-edge-subtle bg-panel px-2.5 text-sm font-medium text-fg transition-colors hover:border-edge-subtle"
            title="Toggle theme"
          >
            {theme === "vs-dark" ? <Sun size={15} /> : <Moon size={15} />}
            {!minimal && (
              <span className="hidden lg:inline">
                {theme === "vs-dark" ? "Light" : "Dark"}
              </span>
            )}
          </button>

          {/* User dropdown */}
          <div className="relative hidden sm:block" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((c) => !c)}
              className="flex h-8 items-center gap-2 rounded-lg border border-edge-subtle bg-panel px-1.5 text-left transition-colors hover:border-brand-300"
              title={user?.username}
            >
              <div className="relative">
                <UserAvatar username={user?.username} hue={user?.avatarHue} size="xs" />
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${presenceColor}`} />
              </div>
              {!minimal && (
                <span className="hidden max-w-[120px] truncate text-sm text-fg xl:block">
                  {user?.username}
                </span>
              )}
            </button>

            <AnimatePresence>
              {dropdownOpen && (
                <Motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.14 }}
                  className="absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-lg border border-edge-subtle bg-panel shadow-2xl shadow-black/10"
                >
                  {/* Profile header */}
                  <div className="flex items-center gap-3 border-b border-edge-subtle px-4 py-3.5">
                    <UserAvatar username={user?.username} hue={user?.avatarHue} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-fg">
                        {user?.username}
                      </p>
                      <p className="truncate text-xs text-fg-muted">
                        {user?.email}
                      </p>
                    </div>
                  </div>

                  {/* Context badge */}
                  {contextValue && (
                    <div className="border-b border-edge-subtle px-4 py-2.5">
                      <div className="rounded-lg border border-edge-subtle bg-hovered px-3 py-2 text-xs text-fg-muted">
                        <span className="font-semibold text-fg">{contextLabel}:</span>{" "}
                        {contextValue}
                      </div>
                    </div>
                  )}

                  {/* Presence selector */}
                  <div className="border-b border-edge-subtle px-4 py-2.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Status</p>
                    <div className="grid grid-cols-2 gap-1">
                      {PRESENCE_OPTIONS.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setPresenceOption(opt.id)}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                            presence === opt.id
                              ? "bg-hovered font-semibold text-fg"
                              : "text-fg-muted hover:bg-hovered"
                          }`}
                        >
                          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${opt.color}`} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Profile shortcut */}
                  <button
                    onClick={() => goTo("/profile")}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-fg transition-colors hover:bg-hovered"
                  >
                    <User size={15} className="text-fg-subtle" />
                    View Profile
                  </button>

                  {/* Nav items */}
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={() => goTo(item.path)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-fg transition-colors hover:bg-hovered"
                      >
                        <Icon size={15} className="text-fg-subtle" />
                        {item.label}
                      </button>
                    );
                  })}

                  {/* Logout */}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 border-t border-edge-subtle px-4 py-3 text-left text-sm text-danger-600 transition-colors hover:bg-danger-50"
                  >
                    <LogOut size={15} />
                    Sign out
                  </button>
                </Motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileMenuOpen((c) => !c)}
            className="rounded-lg border border-edge-subtle bg-panel p-2 text-fg transition-colors md:hidden"
          >
            <AnimatePresence mode="wait">
              {mobileMenuOpen ? (
                <Motion.div key="close" initial={{ rotate: -90 }} animate={{ rotate: 0 }} exit={{ rotate: 90 }}>
                  <X size={18} />
                </Motion.div>
              ) : (
                <Motion.div key="open" initial={{ rotate: 90 }} animate={{ rotate: 0 }} exit={{ rotate: -90 }}>
                  <Menu size={18} />
                </Motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <Motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-edge-subtle bg-panel px-4 py-4 md:hidden"
          >
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-edge-subtle bg-hovered p-3">
              <UserAvatar username={user?.username} hue={user?.avatarHue} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{user?.username}</p>
                <p className="truncate text-xs text-fg-muted">{user?.email}</p>
              </div>
            </div>

            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => goTo(item.path)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-fg transition-colors hover:bg-hovered"
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-xl border border-danger-200 px-3 py-3 text-left text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50"
              >
                <LogOut size={18} />
                Sign out
              </button>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
