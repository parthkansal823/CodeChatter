import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";

export default function Layout({ children, theme, onThemeChange }) {
  const [currentTheme, setCurrentTheme] = useState(theme || "vs-dark");

  useEffect(() => {
    if (theme) {
      setCurrentTheme(theme);
    }
  }, [theme]);

  const handleThemeChange = (newTheme) => {
    setCurrentTheme(newTheme);
    onThemeChange?.(newTheme);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-black dark:text-white">
      <Navbar theme={currentTheme} onThemeChange={handleThemeChange} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
