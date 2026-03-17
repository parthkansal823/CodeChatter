import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Moon, Sun, Menu, X, Home, Settings } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";

export default function Navbar({ theme, onThemeChange }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target)) {
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
    const newTheme = theme === "vs-dark" ? "light" : "vs-dark";
    onThemeChange?.(newTheme);
  };

  const userInitial = user?.username?.charAt(0).toUpperCase() || "U";
  const avatarColors = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-yellow-500"
  ];
  const colorIndex = user?.id ? user.id % avatarColors.length : 0;

  const navItems = [
    { label: "Dashboard", icon: Home, onClick: () => { navigate("/home"); setMobileMenuOpen(false); } }
  ];

  return (
    <div className="sticky top-0 z-40 border-b
      bg-white/95 dark:bg-zinc-950/95 backdrop-blur-sm
      border-zinc-200 dark:border-zinc-800
      shadow-sm dark:shadow-zinc-900/50">

      <div className="h-16 flex items-center justify-between px-4 md:px-8 max-w-7xl mx-auto w-full">

        {/* LEFT - Logo */}
        <motion.div
          className="flex items-center gap-2"
          whileHover={{ scale: 1.02 }}
        >
          <button
            onClick={() => navigate("/home")}
            className="font-bold text-xl bg-gradient-to-r from-purple-600 to-blue-600
            bg-clip-text text-transparent dark:from-purple-400 dark:to-blue-400
            hover:opacity-80 transition-opacity"
          >
            CodeChatter
          </button>
        </motion.div>

        {/* CENTER - Navigation (hidden on mobile) */}
        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <motion.button
              key={item.label}
              onClick={item.onClick}
              className="flex items-center gap-2 text-sm font-medium
              text-zinc-700 dark:text-zinc-300
              hover:text-purple-600 dark:hover:text-purple-400
              transition-colors"
              whileHover={{ x: 2 }}
            >
              <item.icon size={16} />
              {item.label}
            </motion.button>
          ))}
        </div>

        {/* RIGHT - Actions */}
        <div className="flex items-center gap-2">

          {/* Theme Toggle */}
          <motion.button
            onClick={toggleTheme}
            className="p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800
            transition-colors"
            title="Toggle theme"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            {theme === "vs-dark" ? <Sun size={18} /> : <Moon size={18} />}
          </motion.button>

          {/* User Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <motion.button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`w-9 h-9 rounded-full flex items-center justify-center
              text-white text-xs font-semibold cursor-pointer
              ${avatarColors[colorIndex]}
              border-2 border-white/20 dark:border-zinc-800
              hover:border-white/40 transition-all shadow-md`}
              title={user?.username}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              {userInitial}
            </motion.button>

            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute top-12 right-0 w-56 rounded-lg shadow-xl z-50
                  bg-white dark:bg-zinc-900
                  border border-zinc-200 dark:border-zinc-800
                  overflow-hidden"
                >
                  {/* User Info */}
                  <div className="px-4 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-purple-50 dark:from-purple-950/30 to-transparent">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {user?.username}
                    </p>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                      {user?.email}
                    </p>
                  </div>

                  {/* Menu Items */}
                  <button
                    onClick={() => {
                      navigate("/home");
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3
                    text-zinc-800 dark:text-zinc-300
                    hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Home size={16} />
                    Dashboard
                  </button>

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-sm flex items-center gap-3
                    text-red-600 dark:text-red-400
                    hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-t
                    border-zinc-200 dark:border-zinc-800"
                  >
                    <LogOut size={16} />
                    Logout
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile Menu Toggle */}
          <motion.button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <AnimatePresence mode="wait">
              {mobileMenuOpen ? (
                <motion.div key="close" initial={{ rotate: -90 }} animate={{ rotate: 0 }} exit={{ rotate: 90 }}>
                  <X size={20} />
                </motion.div>
              ) : (
                <motion.div key="open" initial={{ rotate: 90 }} animate={{ rotate: 0 }} exit={{ rotate: -90 }}>
                  <Menu size={20} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>

        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden border-t border-zinc-200 dark:border-zinc-800
            bg-white dark:bg-zinc-900"
          >
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => (
                <motion.button
                  key={item.label}
                  onClick={item.onClick}
                  className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3
                  text-zinc-800 dark:text-zinc-300
                  hover:bg-purple-50 dark:hover:bg-purple-900/20
                  hover:text-purple-600 dark:hover:text-purple-400
                  transition-colors"
                  whileHover={{ x: 4 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <item.icon size={18} />
                  {item.label}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
