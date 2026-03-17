import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Moon, Sun, Menu, X } from "lucide-react";
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

  return (
    <div className="h-14 border-b flex items-center justify-between px-4 md:px-6
      bg-white dark:bg-zinc-950
      border-zinc-300 dark:border-zinc-800">

      {/* LEFT - Logo */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate("/home")}
          className="font-bold text-lg text-purple-600 dark:text-purple-400
          hover:opacity-80 transition"
        >
          CodeChatter
        </button>
      </div>

      {/* CENTER - Breadcrumb (hidden on mobile) */}
      <div className="hidden md:flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-500">
        <span className="cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-300"
          onClick={() => navigate("/home")}>
          Dashboard
        </span>
      </div>

      {/* RIGHT */}
      <div className="flex items-center gap-3">

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
          title="Toggle theme"
        >
          {theme === "vs-dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className={`w-8 h-8 rounded-full flex items-center justify-center
            text-white text-xs font-semibold cursor-pointer
            ${avatarColors[colorIndex]}
            border border-white dark:border-zinc-800
            hover:scale-110 transition`}
            title={user?.username}
          >
            {userInitial}
          </button>

          {dropdownOpen && (
            <div className="absolute top-10 right-0 w-48 rounded shadow-lg z-50
              bg-white dark:bg-zinc-900
              border border-zinc-300 dark:border-zinc-800">

              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <p className="text-sm font-medium text-zinc-800 dark:text-white">
                  {user?.username}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {user?.email}
                </p>
              </div>

              <button
                onClick={() => {
                  navigate("/home");
                  setDropdownOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-sm
                text-zinc-800 dark:text-white
                hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                Dashboard
              </button>

              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm flex items-center gap-2
                text-red-600 dark:text-red-400
                hover:bg-red-100 dark:hover:bg-red-900/20 transition"
              >
                <LogOut size={16} />
                Logout
              </button>

            </div>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

      </div>
    </div>
  );
}
