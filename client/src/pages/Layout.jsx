import { useLocation } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import Navbar from "../components/Navbar";

const EASE_EXPO = [0.22, 1, 0.36, 1];

export default function Layout({ children, theme, onThemeChange }) {
  const currentTheme = theme || "vs-dark";
  const location = useLocation();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-zinc-950 text-black dark:text-white">
      <Navbar theme={currentTheme} onThemeChange={onThemeChange} minimal />
      <main className="flex-1 overflow-auto">
        <AnimatePresence mode="wait">
          <Motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
            transition={{ duration: 0.24, ease: EASE_EXPO }}
          >
            {children}
          </Motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}