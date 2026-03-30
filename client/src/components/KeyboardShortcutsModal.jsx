import { useEffect } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Keyboard, X } from "lucide-react";

const SECTIONS = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["Ctrl", "K"],        desc: "Open command palette" },
      { keys: ["Ctrl", "⇧", "Z"],   desc: "Toggle focus mode" },
      { keys: ["Esc"],              desc: "Exit focus mode / close modal" },
    ],
  },
  {
    title: "Code Editor",
    shortcuts: [
      { keys: ["Ctrl", "S"],        desc: "Save file version snapshot" },
      { keys: ["Ctrl", "⇧", "F"],   desc: "Format document" },
      { keys: ["Ctrl", "Z"],        desc: "Undo" },
      { keys: ["Ctrl", "⇧", "Z"],   desc: "Redo (or use Ctrl+Y)" },
      { keys: ["Ctrl", "/"],        desc: "Toggle line comment" },
      { keys: ["Alt", "↑ / ↓"],     desc: "Move line up / down" },
      { keys: ["Ctrl", "D"],        desc: "Select next occurrence" },
      { keys: ["F2"],               desc: "Rename symbol" },
      { keys: ["F12"],              desc: "Go to definition" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "P"],        desc: "Quick file open (Monaco)" },
      { keys: ["Ctrl", "⇧", "E"],   desc: "Focus file explorer" },
      { keys: ["Ctrl", "\\"],       desc: "Split editor (Monaco)" },
    ],
  },
  {
    title: "Workspace Tools",
    shortcuts: [
      { keys: ["Ctrl", "Enter"],    desc: "Run code" },
      { keys: ["Ctrl", "`"],        desc: "Focus terminal" },
    ],
  },
];

function Key({ k }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
      {k}
    </kbd>
  );
}

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
                  <Keyboard size={16} className="text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Keyboard Shortcuts</h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">All available shortcuts</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {SECTIONS.map(section => (
                  <div key={section.title}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                      {section.title}
                    </h3>
                    <div className="space-y-2">
                      {section.shortcuts.map(({ keys, desc }) => (
                        <div key={desc} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <span className="text-sm text-zinc-700 dark:text-zinc-300">{desc}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            {keys.map((k, i) => (
                              <span key={i} className="flex items-center gap-1">
                                {i > 0 && <span className="text-[10px] text-zinc-400">+</span>}
                                <Key k={k} />
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-zinc-100 px-6 py-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                On Mac, use <Key k="⌘" /> instead of <Key k="Ctrl" />
              </p>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
