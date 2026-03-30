import { useEffect, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Pause, Play, RefreshCw, Timer } from "lucide-react";

const PRESETS = [
  { label: "Pomodoro",  work: 25, break: 5  },
  { label: "Short",     work: 15, break: 3  },
  { label: "Long",      work: 50, break: 10 },
];

const PHASES = { work: "Focus", break: "Break" };

function fmt(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function PomodoroTimer() {
  const [preset, setPreset]   = useState(0);
  const [phase, setPhase]     = useState("work");    // "work" | "break"
  const [running, setRunning] = useState(false);
  const [secs, setSecs]       = useState(PRESETS[0].work * 60);
  const [round, setRound]     = useState(1);
  const intervalRef = useRef(null);

  const totalSecs = (phase === "work" ? PRESETS[preset].work : PRESETS[preset].break) * 60;
  const progress  = 1 - secs / totalSecs;

  const radius = 52;
  const circ   = 2 * Math.PI * radius;

  // tick
  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          // phase switch
          setPhase(p => {
            const next = p === "work" ? "break" : "work";
            if (next === "work") setRound(r => r + 1);
            setSecs((next === "work" ? PRESETS[preset].work : PRESETS[preset].break) * 60);
            return next;
          });
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, preset]);

  const reset = () => {
    setRunning(false);
    setPhase("work");
    setRound(1);
    setSecs(PRESETS[preset].work * 60);
  };

  const selectPreset = (i) => {
    setPreset(i);
    setRunning(false);
    setPhase("work");
    setRound(1);
    setSecs(PRESETS[i].work * 60);
  };

  const phaseColor = phase === "work"
    ? { stroke: "#7c3aed", text: "text-violet-500 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-900/20" }
    : { stroke: "#10b981", text: "text-emerald-500 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20" };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-[#0d0d10]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-rose-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Pomodoro</span>
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          Round {round}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6">
        {/* SVG ring timer */}
        <div className="relative flex items-center justify-center">
          <svg width="140" height="140" className="-rotate-90">
            <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor"
              className="text-zinc-100 dark:text-zinc-800" strokeWidth="8" />
            <Motion.circle
              cx="70" cy="70" r={radius} fill="none"
              stroke={phaseColor.stroke} strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              animate={{ strokeDashoffset: circ * (1 - progress) }}
              transition={{ duration: 0.5, ease: "linear" }}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <AnimatePresence mode="wait">
              <Motion.span
                key={fmt(secs)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                className="text-3xl font-bold tabular-nums text-zinc-900 dark:text-white"
              >
                {fmt(secs)}
              </Motion.span>
            </AnimatePresence>
            <span className={`mt-1 text-[11px] font-semibold uppercase tracking-wider ${phaseColor.text}`}>
              {PHASES[phase]}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <RefreshCw size={14} />
          </button>
          <Motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setRunning(v => !v)}
            className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-colors ${
              running
                ? "bg-zinc-700 shadow-zinc-700/30 hover:bg-zinc-600"
                : "bg-violet-600 shadow-violet-500/30 hover:bg-violet-500"
            }`}
          >
            {running ? <Pause size={18} /> : <Play size={18} />}
          </Motion.button>
        </div>

        {/* Preset selector */}
        <div className="flex w-full gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => selectPreset(i)}
              className={`flex-1 rounded-xl border py-2 text-center text-xs font-semibold transition-colors ${
                preset === i
                  ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              <p>{p.label}</p>
              <p className="mt-0.5 font-normal opacity-70">{p.work}m</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
