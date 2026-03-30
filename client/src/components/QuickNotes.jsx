import { useEffect, useRef, useState } from "react";
import { motion as Motion } from "framer-motion";
import { Check, FileText, RotateCcw, Trash2 } from "lucide-react";

const STORAGE_PREFIX = "cc-notes-";

export default function QuickNotes({ roomId }) {
  const key = STORAGE_PREFIX + (roomId || "global");
  const [text, setText] = useState(() => {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  });
  const [saved, setSaved] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const saveTimer = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setCharCount(text.length);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { localStorage.setItem(key, text); } catch { /* ignore */ }
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [text, key]);

  const handleClear = () => {
    setText("");
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    textareaRef.current?.focus();
  };

  const handleRestore = () => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) setText(stored);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0d0d10]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-amber-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Quick Notes</span>
        </div>
        <div className="flex items-center gap-1">
          <Motion.div
            animate={{ opacity: saved ? 1 : 0, scale: saved ? 1 : 0.8 }}
            className="flex items-center gap-1 text-[10px] text-emerald-500"
          >
            <Check size={11} /> Saved
          </Motion.div>
          <button
            onClick={handleClear}
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title="Clear notes"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative flex-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Scratch pad for this room…\n\nJot down ideas, todos, or code snippets. Auto-saved locally.`}
          className="h-full w-full resize-none bg-transparent p-4 font-mono text-xs leading-6 text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200 dark:placeholder:text-zinc-600"
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 dark:border-white/[0.04]">
        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">Auto-saved · per room</span>
        <span className={`text-[10px] ${charCount > 4000 ? "text-red-400" : "text-zinc-400 dark:text-zinc-600"}`}>
          {charCount.toLocaleString()} chars
        </span>
      </div>
    </div>
  );
}
