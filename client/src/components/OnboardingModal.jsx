import { useState, useEffect } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Check, X,
  LayoutGrid, Plus, Users, Share2,
  Bot, GitBranch, MessageCircleMore,
  Settings, Sparkles, Code2,
  FolderOpen, Play, Timer, Github,
} from "lucide-react";
import { HOME_TUTORIAL_KEY } from "./tutorialKeys";

// ── Mini UI preview components ──────────────────────────────────────────────

function RoomCardPreview() {
  return (
    <div className="flex gap-2 px-2">
      {[
        { name: "my-project",   lang: "Python", color: "bg-blue-500"   },
        { name: "web-app",      lang: "React",  color: "bg-cyan-500"   },
        { name: "api-service",  lang: "Go",     color: "bg-emerald-500"},
      ].map((r) => (
        <div key={r.name} className="flex-1 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <div className="mb-1.5 flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${r.color}`} />
            <p className="truncate text-[10px] font-semibold text-zinc-700 dark:text-zinc-200">{r.name}</p>
          </div>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">{r.lang}</span>
        </div>
      ))}
    </div>
  );
}

function CreateRoomPreview() {
  return (
    <div className="flex flex-col gap-2 px-4">
      <div className="rounded-lg border border-violet-300 bg-violet-50 p-2 dark:border-violet-500/40 dark:bg-violet-900/20">
        <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-300">Room Name</p>
        <p className="text-xs text-zinc-400">my-awesome-project</p>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {["Python", "React", "Node.js", "Go", "Java", "Blank"].map((t) => (
          <div key={t} className={`rounded-lg border px-2 py-1.5 text-center text-[10px] font-medium ${t === "Python" ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"}`}>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function SharePreview() {
  return (
    <div className="flex flex-col items-center gap-3 px-4">
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
        <Share2 size={13} className="text-zinc-400" />
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Share</span>
      </div>
      <div className="w-full rounded-xl border border-zinc-100 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Invite Link</p>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="flex-1 truncate font-mono text-[10px] text-zinc-400">codechatter.app/room/abc…</p>
        </div>
        <div className="mt-2 flex gap-1.5">
          {["Dark", "Light"].map((t) => (
            <div key={t} className={`flex-1 rounded-lg border py-1 text-center text-[10px] font-medium ${t === "Dark" ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "border-zinc-200 text-zinc-500 dark:border-zinc-700"}`}>{t}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolsPreview() {
  const tools = [
    { icon: MessageCircleMore, color: "text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20", label: "Chat"      },
    { icon: Bot,               color: "text-violet-400 bg-violet-50 dark:bg-violet-900/20",   label: "AI"        },
    { icon: GitBranch,         color: "text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20",         label: "Flowchart" },
    { icon: Github,            color: "text-zinc-500 bg-zinc-100 dark:bg-zinc-800",           label: "GitHub"    },
    { icon: Timer,             color: "text-rose-400 bg-rose-50 dark:bg-rose-900/20",         label: "Pomodoro"  },
  ];
  return (
    <div className="flex items-center justify-center gap-3 px-2">
      {tools.map(({ icon: Icon, color, label }) => (
        <div key={label} className="flex flex-col items-center gap-1">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
            <Icon size={16} />
          </div>
          <span className="text-[9px] text-zinc-400">{label}</span>
        </div>
      ))}
    </div>
  );
}

function CodeEditorPreview() {
  return (
    <div className="mx-4 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-900 font-mono text-[10px] leading-5 dark:border-zinc-700">
      <div className="flex items-center gap-1.5 border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
        <div className="h-2 w-2 rounded-full bg-red-400" />
        <div className="h-2 w-2 rounded-full bg-yellow-400" />
        <div className="h-2 w-2 rounded-full bg-green-400" />
        <span className="ml-2 text-zinc-400">main.py</span>
      </div>
      <div className="px-3 py-2">
        <p><span className="text-violet-400">def</span> <span className="text-yellow-300">greet</span><span className="text-zinc-300">(name):</span></p>
        <p className="pl-4"><span className="text-green-400">return</span> <span className="text-amber-300">"Hello, " + name</span></p>
        <p className="mt-1"><span className="text-zinc-500"># Live collab — 2 online</span></p>
      </div>
    </div>
  );
}

// ── Steps definition ────────────────────────────────────────────────────────

const HOME_STEPS = [
  {
    gradient: "from-violet-500 to-purple-700",
    icon: Sparkles,
    title: "Welcome to CodeChatter!",
    desc: "Your all-in-one collaborative coding platform. This quick tour shows you everything in under 2 minutes.",
    visual: null,
    tip: null,
  },
  {
    gradient: "from-sky-500 to-blue-700",
    icon: LayoutGrid,
    title: "Your Dashboard",
    desc: "All your rooms live here. Filter by recent, bookmarked, or search by name. Switch between grid and list views.",
    visual: <RoomCardPreview />,
    tip: "Click a room card to jump straight into the code editor.",
  },
  {
    gradient: "from-emerald-500 to-green-700",
    icon: Plus,
    title: "Create a Room",
    desc: "Hit the + New Room button to create a workspace. Pick a language template (Python, React, Node.js…) or start blank.",
    visual: <CreateRoomPreview />,
    tip: "Rooms keep all your files, history, and collaborator access together.",
  },
  {
    gradient: "from-amber-500 to-orange-600",
    icon: Share2,
    title: "Share & Theme",
    desc: "Use the Share button inside any room to copy the invite link. The dropdown also has Dark / Light theme toggle.",
    visual: <SharePreview />,
    tip: "Anyone with the link can request to join — you approve them in Room Settings.",
  },
  {
    gradient: "from-cyan-500 to-teal-600",
    icon: Bot,
    title: "Built-in Tools",
    desc: "Every room includes Chat, AI Help, Flowchart generator, GitHub sync, Whiteboard, Pomodoro timer, and Video call.",
    visual: <ToolsPreview />,
    tip: "All tools live in the right sidebar — click any icon to open it.",
  },
  {
    gradient: "from-rose-500 to-pink-600",
    icon: Settings,
    title: "Settings & Profile",
    desc: "Use Settings to change theme, editor font size, notifications, and privacy. Your profile shows your GitHub connection.",
    visual: null,
    tip: "You can always replay this tutorial from Settings → Help & Tutorial.",
  },
];

// ── Main component ───────────────────────────────────────────────────────────

const SPRING = { type: "spring", stiffness: 380, damping: 26 };

export default function OnboardingModal() {
  const [step, setStep]       = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => { setStep(0); setVisible(true); };

    // First-time auto-show
    try {
      if (!localStorage.getItem(HOME_TUTORIAL_KEY)) show();
    } catch { /* */ }

    // Re-open from Settings
    window.addEventListener("cc-open-tutorial", show);
    return () => window.removeEventListener("cc-open-tutorial", show);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(HOME_TUTORIAL_KEY, "1"); } catch { /* */ }
    setVisible(false);
  };

  const next = () => {
    if (step < HOME_STEPS.length - 1) setStep((s) => s + 1);
    else dismiss();
  };

  const current = HOME_STEPS[step];
  const Icon    = current.icon;
  const isLast  = step === HOME_STEPS.length - 1;

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
            <div className={`relative flex h-32 items-center justify-center overflow-hidden bg-gradient-to-br ${current.gradient}`}>
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
              <AnimatePresence mode="wait">
                <Motion.div key={step}
                  initial={{ scale: 0, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, rotate: 20, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  <Icon size={42} className="text-white drop-shadow-lg" />
                </Motion.div>
              </AnimatePresence>
              {/* Step badge */}
              <span className="absolute bottom-2 right-3 rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-semibold text-white">
                {step + 1} / {HOME_STEPS.length}
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
                <div className="px-6 pt-5 pb-3">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{current.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{current.desc}</p>
                </div>

                {/* Visual preview */}
                {current.visual && (
                  <div className="pb-3">
                    {current.visual}
                  </div>
                )}

                {/* Tip */}
                {current.tip && (
                  <div className="mx-6 mb-3 flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-2 dark:bg-violet-900/20">
                    <span className="mt-px text-violet-500">💡</span>
                    <p className="text-[11px] leading-relaxed text-violet-700 dark:text-violet-300">{current.tip}</p>
                  </div>
                )}
              </Motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {HOME_STEPS.map((_, i) => (
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
