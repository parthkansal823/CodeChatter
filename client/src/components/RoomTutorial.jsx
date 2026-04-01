import { useState, useEffect } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Check, X,
  FolderOpen, Code2, Play, Share2,
  Bot, GitBranch, MessageCircleMore,
  Timer, Keyboard, Layers,
} from "lucide-react";
import { ROOM_TUTORIAL_KEY } from "./tutorialKeys";

// ── Mini preview components ──────────────────────────────────────────────────

function ExplorerPreview() {
  return (
    <div className="mx-4 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
      <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800/80">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Explorer</p>
      </div>
      <div className="px-2 py-1.5 space-y-0.5">
        {[
          { name: "src/", indent: 0, folder: true },
          { name: "main.py", indent: 1, folder: false, active: true },
          { name: "utils.py", indent: 1, folder: false },
          { name: "tests/", indent: 0, folder: true },
        ].map((item) => (
          <div key={item.name}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] ${item.active ? "bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "text-zinc-600 dark:text-zinc-400"}`}
            style={{ paddingLeft: `${8 + item.indent * 12}px` }}
          >
            <span>{item.folder ? "📁" : "📄"}</span>
            <span className="font-medium">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EditorPreview() {
  return (
    <div className="mx-4 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900 font-mono text-[10px] leading-5 dark:border-zinc-700">
      <div className="flex items-center gap-1 border-b border-zinc-700 bg-zinc-800 px-3 py-1">
        <div className="h-1.5 w-1.5 rounded-full bg-red-400" />
        <div className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
        <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
        <span className="ml-2 text-zinc-400">main.py</span>
        <span className="ml-auto rounded-full bg-violet-600/30 px-1.5 py-0.5 text-[9px] text-violet-300">Saved</span>
      </div>
      <div className="px-3 py-2">
        <p><span className="text-violet-400">def</span> <span className="text-yellow-300">factorial</span><span className="text-zinc-300">(n):</span></p>
        <p className="pl-4"><span className="text-sky-400">if</span> <span className="text-zinc-300">n &lt;= 1:</span></p>
        <p className="pl-8"><span className="text-green-400">return</span> <span className="text-amber-300">1</span></p>
        <p className="pl-4"><span className="text-green-400">return</span> <span className="text-zinc-300">n * factorial(n-1)</span></p>
      </div>
    </div>
  );
}

function TopBarPreview() {
  return (
    <div className="mx-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 dark:bg-emerald-900/20">
        <Play size={10} className="text-emerald-500" />
        <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Run</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 dark:border-zinc-700">
        <Share2 size={10} className="text-zinc-500" />
        <span className="text-[10px] font-medium text-zinc-500">Share</span>
      </div>
      <div className="ml-auto flex -space-x-1.5">
        {["bg-violet-400", "bg-cyan-400", "bg-amber-400"].map((c, i) => (
          <div key={i} className={`h-5 w-5 rounded-full border-2 border-white dark:border-zinc-800 ${c}`} />
        ))}
      </div>
    </div>
  );
}

function SidebarPreview() {
  const tools = [
    { icon: MessageCircleMore, color: "text-emerald-400", label: "Chat" },
    { icon: Bot,               color: "text-violet-400",  label: "AI"   },
    { icon: GitBranch,         color: "text-cyan-400",    label: "Flow" },
    { icon: Timer,             color: "text-rose-400",    label: "Pomo" },
  ];
  return (
    <div className="flex items-center justify-center gap-4 px-4">
      {tools.map(({ icon: Icon, color, label }) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 ${color}`}>
            <Icon size={16} />
          </div>
          <span className="text-[9px] text-zinc-400">{label}</span>
        </div>
      ))}
    </div>
  );
}

function ShortcutsPreview() {
  const shortcuts = [
    ["Run Code", "Ctrl+Enter"],
    ["Save File", "Ctrl+S"],
    ["Focus Mode", "Ctrl⇧Z"],
  ];
  return (
    <div className="mx-4 space-y-1.5">
      {shortcuts.map(([action, keys]) => (
        <div key={action} className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400">{action}</span>
          <kbd className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[9px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">{keys}</kbd>
        </div>
      ))}
    </div>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

const ROOM_STEPS = [
  {
    gradient: "from-violet-500 to-purple-700",
    icon: Layers,
    title: "Welcome to the Code Room!",
    desc: "This is your collaborative coding space. Let's take a quick tour of all the tools available to you.",
    visual: null,
    tip: null,
  },
  {
    gradient: "from-sky-500 to-blue-700",
    icon: FolderOpen,
    title: "File Explorer",
    desc: "The left panel holds all your project files. Create, rename, move, or delete files and folders. Click any file to open it in the editor.",
    visual: <ExplorerPreview />,
    tip: "Right-click a file or folder for quick actions like rename and delete.",
  },
  {
    gradient: "from-zinc-600 to-zinc-800",
    icon: Code2,
    title: "Code Editor",
    desc: "The central editor supports syntax highlighting, auto-completion, and real-time collaboration. See your teammates' cursors live as they type.",
    visual: <EditorPreview />,
    tip: "Files auto-save. The status indicator in the tab bar shows Saved / Saving / Unsaved.",
  },
  {
    gradient: "from-emerald-500 to-green-700",
    icon: Play,
    title: "Run & Share",
    desc: "Hit Run (or Ctrl+Enter) to execute your code. Use Share to copy the invite link or open Room Settings to manage members.",
    visual: <TopBarPreview />,
    tip: "Run output appears in the terminal panel at the bottom of the screen.",
  },
  {
    gradient: "from-cyan-500 to-teal-600",
    icon: GitBranch,
    title: "Right Sidebar Tools",
    desc: "Click any icon on the right edge to open tools: Chat, AI Help, Flowchart, GitHub sync, Notes, Whiteboard, Pomodoro, and Video call.",
    visual: <SidebarPreview />,
    tip: "The AI tool can explain code, suggest fixes, and answer coding questions in context.",
  },
  {
    gradient: "from-rose-500 to-pink-600",
    icon: Bot,
    title: "Flowchart Generator",
    desc: "Open the Flowchart tool and it auto-generates a colorful Mermaid diagram from your active code file. Download it as SVG, PNG, or .mmd.",
    visual: null,
    tip: "Switch files and the flowchart updates automatically — great for understanding complex logic.",
  },
  {
    gradient: "from-amber-500 to-orange-600",
    icon: Keyboard,
    title: "Keyboard Shortcuts",
    desc: "Speed up your workflow with shortcuts. Use Focus Mode for a distraction-free coding experience.",
    visual: <ShortcutsPreview />,
    tip: "Press Ctrl⇧Z to enter Focus Mode — hides the navbar and sidebars. Press Esc to exit.",
  },
];

// ── Component ────────────────────────────────────────────────────────────────

const SPRING = { type: "spring", stiffness: 380, damping: 26 };

export default function RoomTutorial() {
  const [step, setStep]       = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => { setStep(0); setVisible(true); };

    try {
      if (!localStorage.getItem(ROOM_TUTORIAL_KEY)) show();
    } catch { /* */ }

    window.addEventListener("cc-open-room-tutorial", show);
    return () => window.removeEventListener("cc-open-room-tutorial", show);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(ROOM_TUTORIAL_KEY, "1"); } catch { /* */ }
    setVisible(false);
  };

  const next = () => {
    if (step < ROOM_STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  };

  const current = ROOM_STEPS[step];
  const Icon    = current.icon;
  const isLast  = step === ROOM_STEPS.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={SPRING}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
            {/* Close */}
            <button
              onClick={dismiss}
              className="absolute right-4 top-4 z-10 rounded-xl p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>

            {/* Gradient hero */}
            <div className={`relative flex h-28 items-center justify-center overflow-hidden bg-gradient-to-br ${current.gradient}`}>
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
              <AnimatePresence mode="wait">
                <Motion.div key={step}
                  initial={{ scale: 0, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, rotate: 20, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  <Icon size={38} className="text-white drop-shadow-lg" />
                </Motion.div>
              </AnimatePresence>
              <span className="absolute bottom-2 right-3 rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-semibold text-white">
                {step + 1} / {ROOM_STEPS.length}
              </span>
            </div>

            {/* Content */}
            <AnimatePresence mode="wait">
              <Motion.div key={step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                <div className="px-6 pt-4 pb-3">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{current.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{current.desc}</p>
                </div>

                {current.visual && (
                  <div className="pb-3">{current.visual}</div>
                )}

                {current.tip && (
                  <div className="mx-6 mb-3 flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-2 dark:bg-violet-900/20">
                    <span className="mt-px text-violet-500">💡</span>
                    <p className="text-[11px] leading-relaxed text-violet-700 dark:text-violet-300">{current.tip}</p>
                  </div>
                )}
              </Motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-3.5 dark:border-zinc-800">
              <div className="flex items-center gap-1.5">
                {ROOM_STEPS.map((_, i) => (
                  <Motion.div key={i}
                    animate={{
                      width: i === step ? 18 : 6,
                      backgroundColor: i === step ? "#7c3aed" : i < step ? "#a78bfa" : "#d4d4d8",
                    }}
                    transition={SPRING}
                    className="h-1.5 cursor-pointer rounded-full"
                    onClick={() => setStep(i)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button onClick={() => setStep((s) => s - 1)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                    Back
                  </button>
                )}
                <Motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} onClick={next}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-violet-500/30 transition-colors hover:bg-violet-500">
                  {isLast ? "Done" : "Next"}
                  {isLast ? <Check size={14} /> : <ArrowRight size={14} />}
                </Motion.button>
              </div>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
