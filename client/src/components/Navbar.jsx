import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  Home,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  X
} from "lucide-react";

import { useAuth } from "../hooks/useAuth";
import BrandLogo from "./BrandLogo";
import UserAvatar from "./UserAvatar";

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (!dropdownRef.current?.contains(event.target)) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
    { label: "Dashboard", icon: Home, path: "/home" },
    { label: "Settings", icon: Settings, path: "/settings" },
  ];

  return (
    <div className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className={`mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 md:px-6 ${minimal ? "h-11" : "h-14"
        }`}>
        {/* Logo + context */}
        <div className="flex min-w-0 items-center gap-3">
          <Motion.button
            onClick={() => goTo("/home")}
            className="flex min-w-0 items-center rounded-lg px-1 py-1 text-left transition-opacity hover:opacity-80"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            <BrandLogo size="sm" />
          </Motion.button>

          {contextValue && (
            <div className="hidden min-w-0 items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 md:flex">
              <span>/</span>
              <span className="truncate font-mono text-zinc-900 dark:text-zinc-100">
                {contextValue}
              </span>
              {contextHint && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{contextHint}</span>
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
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-white"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
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
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700"
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
              className="flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-1.5 text-left transition-colors hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-700"
              title={user?.username}
            >
              <UserAvatar username={user?.username} size="xs" />
              {!minimal && (
                <span className="hidden max-w-[120px] truncate text-sm text-zinc-800 dark:text-zinc-100 xl:block">
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
                  className="absolute right-0 top-10 z-50 w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {/* Profile header */}
                  <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
                    <UserAvatar username={user?.username} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                        {user?.username}
                      </p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {user?.email}
                      </p>
                    </div>
                  </div>

                  {/* Context badge */}
                  {contextValue && (
                    <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                        <span className="font-semibold text-zinc-900 dark:text-white">{contextLabel}:</span>{" "}
                        {contextValue}
                      </div>
                    </div>
                  )}

                  {/* Nav items */}
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.label}
                        onClick={() => goTo(item.path)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
                      >
                        <Icon size={15} className="text-zinc-400" />
                        {item.label}
                      </button>
                    );
                  })}

                  {/* Logout */}
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 border-t border-zinc-100 px-4 py-3 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-zinc-800 dark:text-red-400 dark:hover:bg-red-900/20"
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
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-700 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 md:hidden"
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
            className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950 md:hidden"
          >
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <UserAvatar username={user?.username} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">{user?.username}</p>
                <p className="truncate text-xs text-zinc-500">{user?.email}</p>
              </div>
            </div>

            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => goTo(item.path)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-xl border border-red-200 px-3 py-3 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-900/20"
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
