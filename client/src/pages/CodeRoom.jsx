import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import TopBar from "../components/TopBar";
import FileExplorer from "../components/FileExplorer";
import CodeEditor from "../components/CodeEditor";
import RightSidebar from "../components/RightSidebar";
import BottomPanel from "../components/BottomPanel";

export default function CodeRoom({ theme: propTheme, onThemeChange }) {

  const { roomId } = useParams();
  const navigate = useNavigate();

  const [selectedLanguage, setSelectedLanguage] = useState("cpp");

  // 🌙 Theme (load from prop or localStorage if exists)
  const [theme, setTheme] = useState(() => {
    return propTheme || localStorage.getItem("theme") || "vs-dark";
  });

  // ⭐ Apply theme globally
  useEffect(() => {

    if (theme === "vs-dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Save theme
    localStorage.setItem("theme", theme);

  }, [theme]);

  // Auto-create room if user visits /room
  useEffect(() => {

    if (!roomId) {

      const newRoomId =
        Math.random().toString(36).substring(2, 8).toUpperCase();

      navigate(`/room/${newRoomId}`, { replace: true });

    }

  }, [roomId, navigate]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    onThemeChange?.(newTheme);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-black dark:text-white">

      {/* Navbar */}
      <Navbar theme={theme} onThemeChange={handleThemeChange} />

      {/* Top Bar */}
      <TopBar
        onLanguageChange={setSelectedLanguage}
        onThemeChange={setTheme}
        roomId={roomId}
      />

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">

        <FileExplorer />

        <CodeEditor
          selectedLanguage={selectedLanguage}
          theme={theme}
        />

        <RightSidebar />

      </div>

      {/* Bottom Panel */}
      <BottomPanel />

    </div>
  );
}