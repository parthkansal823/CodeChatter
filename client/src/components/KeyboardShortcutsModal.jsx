import { useEffect } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Keyboard, X } from "lucide-react";

const SECTIONS = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["Ctrl", "K"], desc: "Open command palette" },
      { keys: ["Ctrl", "Shift", "Z"], desc: "Toggle focus mode" },
      { keys: ["Esc"], desc: "Close overlays or exit focus mode" },
    ],
  },
  {
    title: "Workspace",
    shortcuts: [
      { keys: ["Ctrl", "Enter"], desc: "Run active file" },
      { keys: ["Ctrl", "K"], desc: "Search files, tools, and room actions" },
      { keys: ["F2"], desc: "Rename selected file or folder" },
      { keys: ["Delete"], desc: "Delete selected file or folder" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["Ctrl", "P"], desc: "Quick file open in Monaco" },
      { keys: ["Ctrl", "/"], desc: "Toggle line comment" },
      { keys: ["Ctrl", "Z"], desc: "Undo" },
      { keys: ["Ctrl", "Shift", "Z"], desc: "Redo" },
      { keys: ["F12"], desc: "Go to definition" },
    ],
  },
];

function Key({ k }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded-md border border-edge bg-hovered px-1.5 py-0.5 text-[11px] font-semibold text-fg shadow-sm">
      {k}
    </kbd>
  );
}

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center bg-canvas p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-2xl overflow-hidden rounded-xl border border-edge-subtle bg-panel shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-edge-subtle px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-100">
                  <Keyboard size={16} className="text-brand-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-fg">Keyboard Shortcuts</h2>
                  <p className="text-xs text-fg-muted">Shortcuts that work across CodeChatter</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-1.5 text-fg-subtle transition-colors hover:bg-hovered hover:text-fg-muted"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-6">
              <div className="grid gap-6 md:grid-cols-2">
                {SECTIONS.map((section) => (
                  <div key={section.title}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
                      {section.title}
                    </h3>
                    <div className="space-y-2">
                      {section.shortcuts.map(({ keys, desc }) => (
                        <div
                          key={desc}
                          className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-panel"
                        >
                          <span className="text-sm text-fg">{desc}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            {keys.map((keyLabel, index) => (
                              <span key={`${desc}-${keyLabel}`} className="flex items-center gap-1">
                                {index > 0 && <span className="text-[10px] text-fg-subtle">+</span>}
                                <Key k={keyLabel} />
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

            <div className="border-t border-edge-subtle px-6 py-3">
              <p className="text-xs text-fg-subtle">
                On Mac, use <Key k="Cmd" /> instead of <Key k="Ctrl" />.
              </p>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
