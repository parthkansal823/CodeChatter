import { useCallback, useEffect, useRef, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  Bell, BellOff, CheckCircle2, ChevronRight,
  Flame, Pause, Play, RefreshCw, Settings, SkipForward,
  Target, Timer, Trophy, X, Zap,
} from "lucide-react";

// ── constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "Pomodoro", work: 25, shortBreak: 5,  longBreak: 15 },
  { label: "Short",    work: 15, shortBreak: 3,  longBreak: 10 },
  { label: "Long",     work: 50, shortBreak: 10, longBreak: 20 },
];

const LONG_BREAK_AFTER = 4; // pomodoros before long break
const STORAGE_KEY = "cc-pomodoro-stats";

function fmt(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return {};
}

function saveStats(stats) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch { /* */ }
}

// ── audio beep ───────────────────────────────────────────────────────────────

function playBeep(type = "work") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = window.AudioContext || (/** @type {any} */ (window)).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(type === "work" ? 880 : 528, ctx.currentTime);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.8);
    // Double beep for break end
    if (type === "break") {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.9);
      gain2.gain.setValueAtTime(0.4, ctx.currentTime + 0.9);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
      osc2.start(ctx.currentTime + 0.9);
      osc2.stop(ctx.currentTime + 1.6);
    }
  } catch { /* AudioContext may not be available */ }
}

// ── browser notification ──────────────────────────────────────────────────────

function sendNotif(title, body) {
  if (typeof window !== "undefined" && Notification?.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  }
}

// ── phase config ──────────────────────────────────────────────────────────────

function getPhaseConfig(phase) {
  return {
    work:       { label: "Focus",      color: "#7c3aed", textClass: "text-violet-500 dark:text-violet-400", ringClass: "stroke-violet-500" },
    shortBreak: { label: "Short Break",color: "#10b981", textClass: "text-emerald-500 dark:text-emerald-400", ringClass: "stroke-emerald-500" },
    longBreak:  { label: "Long Break", color: "#06b6d4", textClass: "text-sky-500 dark:text-sky-400",         ringClass: "stroke-sky-500" },
  }[phase];
}

// ── SettingsPanel ─────────────────────────────────────────────────────────────

function SettingsPanel({ custom, onChange, onClose }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0d0d10]"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/[0.06]">
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">Custom Timer</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {[
          { key: "work",       label: "Focus (min)",       min: 1, max: 120 },
          { key: "shortBreak", label: "Short Break (min)", min: 1, max: 30  },
          { key: "longBreak",  label: "Long Break (min)",  min: 1, max: 60  },
        ].map(({ key, label, min, max }) => (
          <div key={key}>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</label>
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{custom[key]}m</span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={custom[key]}
              onChange={(e) => onChange({ ...custom, [key]: Number(e.target.value) })}
              className="w-full accent-violet-600"
            />
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>{min}m</span><span>{max}m</span>
            </div>
          </div>
        ))}
        <p className="text-[10px] text-zinc-400">Changes apply on next reset.</p>
      </div>
    </Motion.div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function PomodoroTimer() {
  const [preset, setPreset]         = useState(0);
  const [custom, setCustom]         = useState(null); // null = use preset
  const [phase, setPhase]           = useState("work");
  const [running, setRunning]       = useState(false);
  const [secs, setSecs]             = useState(PRESETS[0].work * 60);
  const [round, setRound]           = useState(1);        // pomodoro count (resets on long break)
  const [totalPomodoros, setTotal]  = useState(0);        // all-time today
  const [task, setTask]             = useState("");
  const [soundOn, setSoundOn]       = useState(true);
  const [autoStart, setAutoStart]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory]   = useState(false);
  const [history, setHistory]       = useState(() => loadStats());
  const intervalRef = useRef(null);

  const cfg = custom || PRESETS[preset];
  const phaseDuration = { work: cfg.work, shortBreak: cfg.shortBreak, longBreak: cfg.longBreak }[phase];
  const totalSecs = phaseDuration * 60;
  const progress  = 1 - secs / totalSecs;
  const radius    = 52;
  const circ      = 2 * Math.PI * radius;
  const pc        = getPhaseConfig(phase);

  // Today's stats
  const today     = todayKey();
  const todayData = history[today] || { pomodoros: 0, focusMin: 0, sessions: [] };
  const todayMin  = todayData.focusMin || 0;

  // ── phase transition ───────────────────────────────────────────────────────

  const switchPhase = useCallback((completedWork) => {
    if (completedWork) {
      // Record completed pomodoro
      const newTotal = totalPomodoros + 1;
      setTotal(newTotal);
      const newHistory = {
        ...history,
        [today]: {
          pomodoros: (todayData.pomodoros || 0) + 1,
          focusMin: (todayData.focusMin || 0) + cfg.work,
          sessions: [
            ...(todayData.sessions || []),
            { task: task || "Untitled", completedAt: Date.now(), duration: cfg.work },
          ],
        },
      };
      setHistory(newHistory);
      saveStats(newHistory);

      const isLongBreak = newTotal % LONG_BREAK_AFTER === 0;
      const nextPhase = isLongBreak ? "longBreak" : "shortBreak";
      setSecs((isLongBreak ? cfg.longBreak : cfg.shortBreak) * 60);
      setPhase(nextPhase);
      if (soundOn) playBeep("work");
      sendNotif("🎉 Focus complete!", isLongBreak ? `Time for a long break (${cfg.longBreak}min)` : `Short break time (${cfg.shortBreak}min)`);
      setRunning(autoStart);
      return;
    }

    // Break ended → back to work
    setRound((r) => r + 1);
    setSecs(cfg.work * 60);
    setPhase("work");
    if (soundOn) playBeep("break");
    sendNotif("⏰ Break over!", "Back to focus mode.");
    setRunning(autoStart);
  }, [phase, totalPomodoros, history, today, todayData, cfg, task, soundOn, autoStart]);

  // ── tick ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          clearInterval(intervalRef.current);
          switchPhase(phase === "work");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, phase, switchPhase]);

  // Update page title while running
  useEffect(() => {
    if (running) {
      document.title = `${fmt(secs)} ${pc.label} — CodeChatter`;
    } else {
      document.title = "CodeChatter";
    }
    return () => { document.title = "CodeChatter"; };
  }, [running, secs, pc.label]);

  const reset = () => {
    setRunning(false);
    setPhase("work");
    setRound(1);
    setSecs(cfg.work * 60);
  };

  const skip = () => {
    setRunning(false);
    switchPhase(phase === "work");
  };

  const selectPreset = (i) => {
    setPreset(i);
    setCustom(null);
    setRunning(false);
    setPhase("work");
    setRound(1);
    setSecs(PRESETS[i].work * 60);
  };

  const applyCustom = (c) => {
    setCustom(c);
    setRunning(false);
    setPhase("work");
    setRound(1);
    setSecs(c.work * 60);
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-[#0d0d10]">
      {/* Settings overlay */}
      <AnimatePresence>
        {showSettings && (
          <SettingsPanel
            custom={custom || cfg}
            onChange={(c) => applyCustom(c)}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-rose-400" />
          <span className="text-sm font-semibold text-zinc-900 dark:text-white">Pomodoro</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Today's stats chip */}
          <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <Flame size={10} className="text-rose-400" />
            {todayData.pomodoros || 0} · {Math.round(todayMin)}m
          </div>
          <button
            onClick={() => setSoundOn((v) => !v)}
            title={soundOn ? "Mute sounds" : "Enable sounds"}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.08]"
          >
            {soundOn ? <Bell size={13} /> : <BellOff size={13} className="opacity-40" />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.08]"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto px-4 py-5">

        {/* Round indicators — filled dots = completed pomodoros in current cycle */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: LONG_BREAK_AFTER }).map((_, i) => {
            const filledCount = totalPomodoros % LONG_BREAK_AFTER;
            const allFull = totalPomodoros > 0 && filledCount === 0;
            const filled = allFull ? LONG_BREAK_AFTER : filledCount;
            return (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${i < filled ? "bg-violet-500" : "bg-zinc-200 dark:bg-zinc-700"}`}
              />
            );
          })}
          <span className="ml-1 text-[10px] text-zinc-400">until long break</span>
        </div>

        {/* SVG ring */}
        <div className="relative flex items-center justify-center">
          <svg width="148" height="148" className="-rotate-90">
            <circle cx="74" cy="74" r={radius} fill="none" stroke="currentColor"
              className="text-zinc-100 dark:text-zinc-800" strokeWidth="9" />
            <Motion.circle
              cx="74" cy="74" r={radius} fill="none"
              stroke={pc.color} strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={circ}
              animate={{ strokeDashoffset: circ * (1 - progress) }}
              transition={{ duration: 0.5, ease: "linear" }}
            />
          </svg>
          <div className="absolute flex flex-col items-center gap-0.5">
            <AnimatePresence mode="wait">
              <Motion.span
                key={fmt(secs)}
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.88 }}
                transition={{ duration: 0.1 }}
                className="text-[2rem] font-bold tabular-nums text-zinc-900 dark:text-white leading-none"
              >
                {fmt(secs)}
              </Motion.span>
            </AnimatePresence>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${pc.textClass}`}>
              {pc.label}
            </span>
            <span className="text-[10px] text-zinc-400">Round {round}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            title="Reset"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <RefreshCw size={14} />
          </button>
          <Motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => {
              setRunning((v) => {
                if (!v && "Notification" in window && Notification.permission === "default") {
                  Notification.requestPermission();
                }
                return !v;
              });
            }}
            className={`flex h-13 w-13 h-[52px] w-[52px] items-center justify-center rounded-full text-white shadow-lg transition-colors ${
              running
                ? "bg-zinc-700 shadow-zinc-700/30 hover:bg-zinc-600"
                : "bg-violet-600 shadow-violet-500/30 hover:bg-violet-500"
            }`}
          >
            {running ? <Pause size={20} /> : <Play size={20} />}
          </Motion.button>
          <button
            onClick={skip}
            title="Skip phase"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <SkipForward size={14} />
          </button>
        </div>

        {/* Task input */}
        <div className="w-full">
          <div className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 focus-within:border-violet-400">
            <Target size={12} className="shrink-0 text-zinc-400" />
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What are you working on?"
              className="flex-1 bg-transparent text-xs text-zinc-700 outline-none placeholder-zinc-400 dark:text-zinc-200 dark:placeholder-zinc-600"
            />
          </div>
        </div>

        {/* Auto-start toggle */}
        <label className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <Zap size={12} className={autoStart ? "text-amber-400" : "text-zinc-400"} />
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Auto-start next phase</span>
          </div>
          <button
            onClick={() => setAutoStart((v) => !v)}
            className={`relative h-5 w-9 rounded-full transition-colors ${autoStart ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoStart ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </label>

        {/* Preset pills */}
        <div className="flex w-full gap-1.5">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => selectPreset(i)}
              className={`flex-1 rounded-xl border py-2 text-center text-[11px] font-semibold transition-colors ${
                preset === i && !custom
                  ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
                  : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"
              }`}
            >
              <p>{p.label}</p>
              <p className="mt-0.5 font-normal opacity-60">{p.work}m</p>
            </button>
          ))}
          {custom && (
            <button
              className="flex-1 rounded-xl border border-violet-400 bg-violet-50 py-2 text-center text-[11px] font-semibold text-violet-700 dark:border-violet-600 dark:bg-violet-900/20 dark:text-violet-300"
            >
              <p>Custom</p>
              <p className="mt-0.5 font-normal opacity-60">{custom.work}m</p>
            </button>
          )}
        </div>

        {/* Today's session history */}
        {todayData.sessions?.length > 0 && (
          <div className="w-full">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <div className="flex items-center gap-1.5">
                <Trophy size={12} className="text-amber-400" />
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Today — {todayData.pomodoros} sessions · {todayMin}m focus
                </span>
              </div>
              <ChevronRight size={12} className={`transition-transform ${showHistory ? "rotate-90" : ""}`} />
            </button>

            <AnimatePresence>
              {showHistory && (
                <Motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1 space-y-1 rounded-xl border border-zinc-100 p-2 dark:border-zinc-800">
                    {[...(todayData.sessions || [])].reverse().slice(0, 8).map((s, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                        <CheckCircle2 size={11} className="shrink-0 text-violet-400" />
                        <span className="flex-1 truncate text-[11px] text-zinc-600 dark:text-zinc-400">{s.task}</span>
                        <span className="text-[10px] text-zinc-400">{s.duration}m</span>
                      </div>
                    ))}
                  </div>
                </Motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
