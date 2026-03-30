import { useState, useEffect } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Code2, FolderGit2, Users, Bot, Sparkles, X, ArrowRight, Check } from "lucide-react";

const STEPS = [
  {
    icon: Sparkles,
    gradient: "from-violet-500 to-purple-600",
    title: "Welcome to CodeChatter!",
    desc: "Your all-in-one collaborative coding environment. Let's get you set up in 30 seconds.",
    action: "Get started",
  },
  {
    icon: FolderGit2,
    gradient: "from-emerald-500 to-green-600",
    title: "Create your first room",
    desc: "Rooms are isolated workspaces with files, a terminal, and live collaboration. Pick a template or start blank.",
    action: "Next",
  },
  {
    icon: Users,
    gradient: "from-sky-500 to-blue-600",
    title: "Invite collaborators",
    desc: "Share a room link to instantly bring in teammates. Everyone gets live cursors and real-time editing.",
    action: "Next",
  },
  {
    icon: Bot,
    gradient: "from-amber-500 to-orange-600",
    title: "AI + Whiteboard built in",
    desc: "Use the AI assistant for code suggestions, debugging, and explanations. Draw ideas on the whiteboard.",
    action: "Start coding",
  },
];

const STORAGE_KEY = "cc-onboarded";

const SPRING = { type: "spring", stiffness: 380, damping: 26 };

export default function OnboardingModal() {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) setVisible(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  };

  const next = () => {
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else dismiss();
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-zinc-950/70 backdrop-blur-sm"
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

            {/* Icon hero */}
            <div className={`relative flex h-36 items-center justify-center bg-gradient-to-br ${current.gradient} overflow-hidden`}>
              {/* subtle pattern */}
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.4) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
              <AnimatePresence mode="wait">
                <Motion.div
                  key={step}
                  initial={{ scale: 0, rotate: -20, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, rotate: 20, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                >
                  <Icon size={44} className="text-white drop-shadow-lg" />
                </Motion.div>
              </AnimatePresence>
            </div>

            {/* Content */}
            <div className="min-h-[108px] px-7 py-6">
              <AnimatePresence mode="wait">
                <Motion.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                >
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{current.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{current.desc}</p>
                </Motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-zinc-100 px-7 py-5 dark:border-zinc-800">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5">
                {STEPS.map((_, i) => (
                  <Motion.div
                    key={i}
                    animate={{
                      width: i === step ? 20 : 6,
                      backgroundColor: i === step ? "#7c3aed" : i < step ? "#a78bfa" : "#d4d4d8",
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="h-1.5 rounded-full cursor-pointer"
                    onClick={() => setStep(i)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    className="rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Back
                  </button>
                )}
                <Motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={next}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-violet-500/30 transition-colors hover:bg-violet-500"
                >
                  {current.action}
                  {isLast ? <Check size={15} /> : <ArrowRight size={15} />}
                </Motion.button>
              </div>
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
