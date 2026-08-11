import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import {
  Users, Terminal, Shield, Zap, Video, Bot,
  Code2, Moon, Sun, ArrowRight, ChevronRight, Menu, X,
} from "lucide-react";
import BrandLogo from "../components/BrandLogo";
import { useAuth } from "../hooks/useAuth";

// ─── Data ────────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: Users,    title: "Real-time collaboration", desc: "Live cursors, selections, and presence. Everyone sees the same file as it changes." },
  { icon: Code2,    title: "Monaco editor",           desc: "The editor engine behind VS Code, with syntax support for 20+ languages." },
  { icon: Video,    title: "Video and screen share",  desc: "Talk through the code without leaving the workspace." },
  { icon: Shield,   title: "Private rooms",           desc: "Invite links, owner approval queues, and per-member viewer/editor/runner roles." },
  { icon: Terminal, title: "Integrated terminal",     desc: "A real shell per room, plus one-click run for the file you're editing." },
  { icon: Bot,      title: "AI assistance",           desc: "Explain a file, read a stack trace, or plan a fix with full room context." },
];

const STEPS = [
  { n: "01", title: "Create a room",        desc: "Set up a workspace in seconds. Pick a template or start from scratch." },
  { n: "02", title: "Invite collaborators", desc: "Share a link — teammates join instantly, no extra setup." },
  { n: "03", title: "Code together",        desc: "Write, run, and debug in real-time with voice and video built right in." },
];

// Capability facts, not invented traction numbers.
const STATS = [
  { value: "20+", label: "Languages" },
  { value: "5",   label: "Starter templates" },
  { value: "4",   label: "Access roles" },
  { value: "<1s", label: "Edit sync" },
];

const PLATFORM_DETAILS = [
  {
    icon: Terminal,
    title: "Code, run, and debug in one room",
    desc: "Every workspace can include files, a Monaco editor, terminal access, and starter templates so teams can begin working immediately.",
  },
  {
    icon: Users,
    title: "Built for pair programming and team sessions",
    desc: "Invite collaborators by link, review code together, and keep presence, chat, and participation connected to the room itself.",
  },
  {
    icon: Shield,
    title: "Private by default",
    desc: "Room ownership, invite links, and approval flows help keep each workspace scoped to the right people and project.",
  },
  {
    icon: Bot,
    title: "Helpful when you need momentum",
    desc: "Use integrated AI assistance for explanations, quick iteration, and faster onboarding without leaving the workspace.",
  },
];

// One accent for every feature icon. Colour-coding six unrelated features in six
// different hues carries no information and is the fastest way to make a product
// look unfinished; status colours are reserved for actual status.
const ICON_TILE =
  "bg-brand-500/10 border border-brand-500/20 text-brand-600 dark:text-brand-400";

// ─── Fake code for the hero mockup ───────────────────────────────────────────

const CODE = [
  [["kw","def "],["fn","merge_sort"],["","(arr):"]],
  [["","    "],["kw","if "],["","len(arr) "],["op","<= "],["num","1"],["","  :"]],
  [["","        "],["kw","return "],["","arr"]],
  [["",""]],
  [["","    mid "],["op","= "],["","len(arr) "],["op","// "],["num","2"]],
  [["","    left "],["op","= "],["fn","merge_sort"],["","(arr[:mid])"]],
  [["","    right "],["op","= "],["fn","merge_sort"],["","(arr[mid:])"]],
  [["","    "],["kw","return "],["fn","merge"],["","(left, right)"]],
];

const TOKEN_COLOR = { kw:"text-brand-400", fn:"text-info-400", op:"text-warning-400", num:"text-warning-400", "":"text-gray-300" };

// ─── Sub-components ──────────────────────────────────────────────────────────

function FadeUp({ children, delay = 0, className = "" }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.2, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </Motion.div>
  );
}

function HeroMockup() {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-800 shadow-[0_24px_64px_rgba(0,0,0,0.12)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
      {/* Window chrome */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 dark:bg-[#14141f] border-b border-gray-200 dark:border-zinc-800">
        <span className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-danger-400" />
          <span className="w-3 h-3 rounded-full bg-warning-400" />
          <span className="w-3 h-3 rounded-full bg-success-400" />
        </span>
        <span className="flex-1 text-center text-xs text-gray-400 font-mono">
          merge_sort.py — CodeChatter
        </span>
        {/* Live avatars */}
        <span className="flex items-center gap-1.5">
          {[["P","#7c3aed"],["N","#2563eb"],["K","#059669"]].map(([l,c]) => (
            <span key={l} className="w-5 h-5 rounded-full text-white text-[9px] font-bold flex items-center justify-center border-2 border-gray-100 dark:border-[#14141f]" style={{ background: c }}>{l}</span>
          ))}
          <span className="ml-1 text-[11px] text-gray-400">3 online</span>
        </span>
      </div>

      {/* Editor body — always dark like a real IDE */}
      <div className="bg-[#0d1117] flex text-sm font-mono">
        {/* Line numbers */}
        <div className="w-10 py-4 pr-3 select-none text-right bg-[#0d1117] border-r border-zinc-800">
          {CODE.map((_, i) => (
            <div key={i} className="h-6 leading-6 text-[11px] text-gray-600">{i + 1}</div>
          ))}
        </div>

        {/* Code */}
        <div className="flex-1 py-4 pl-4 overflow-x-auto">
          {/* User cursor badge — line 1 */}
          <div className="h-6 leading-6 relative">
            <span className="absolute -left-4 top-0 flex items-start">
              <span className="text-[9px] font-semibold px-1 py-0.5 rounded text-white translate-y-[-100%] absolute whitespace-nowrap" style={{ background: "#7c3aed" }}>Ananya</span>
              <span className="w-0.5 h-6" style={{ background: "#7c3aed" }} />
            </span>
            {CODE[0].map(([type, txt], j) => <span key={j} className={TOKEN_COLOR[type]}>{txt}</span>)}
          </div>

          {CODE.slice(1).map((line, i) => (
            <div key={i} className="h-6 leading-6 relative">
              {/* User cursor badge — line 5 */}
              {i === 3 && (
                <span className="absolute -left-4 top-0 flex items-start">
                  <span className="text-[9px] font-semibold px-1 py-0.5 rounded text-white translate-y-[-100%] absolute whitespace-nowrap" style={{ background: "#2563eb" }}>Parth</span>
                  <span className="w-0.5 h-6" style={{ background: "#2563eb" }} />
                </span>
              )}
              {line.map(([type, txt], j) => <span key={j} className={TOKEN_COLOR[type]}>{txt}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Landing({ theme, onThemeChange }) {
  const isDark = theme === "vs-dark";
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const toggleTheme = () => onThemeChange(isDark ? "vs" : "vs-dark");

  return (
    <div className="min-h-screen bg-white dark:bg-[#08080f] text-gray-900 dark:text-white transition-colors duration-200">

      {/* ── Dot-grid overlay ───────────────────────────────────────────────── */}
      <div className="pointer-events-none fixed inset-0 dark:hidden"
        style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.055) 1px,transparent 1px)", backgroundSize: "28px 28px" }} />
      <div className="pointer-events-none fixed inset-0 hidden dark:block"
        style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.038) 1px,transparent 1px)", backgroundSize: "28px 28px" }} />

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  NAVBAR                                                          ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-gray-200/70 dark:border-zinc-800 bg-white/80 dark:bg-[#08080f]/80 backdrop-blur-xl flex items-center">
        <div className="max-w-7xl mx-auto w-full px-5 flex items-center gap-4">
          <Link to="/"><BrandLogo size="sm" /></Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 ml-8 text-[13.5px] font-medium">
            {[["Features","#features"],["Platform","#platform"],["How it works","#how-it-works"]].map(([label, href]) => (
              <a key={label} href={href} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto">
            {/* Theme toggle */}
            <button onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all">
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {isAuthenticated ? (
              <button onClick={() => navigate("/home")}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-brand-600 to-info-600 hover:from-brand-500 hover:to-info-500 transition-all">
                Dashboard <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <Link to="/auth"
                  className="hidden sm:block px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all">
                  Sign in
                </Link>
                <Link to="/auth?mode=signup"
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13.5px] font-semibold text-white bg-gradient-to-r from-brand-600 to-info-600 hover:from-brand-500 hover:to-info-500 transition-all shadow-sm">
                  Get started <ChevronRight size={14} />
                </Link>
              </>
            )}

            {/* Mobile menu toggle */}
            <button onClick={() => setMobileOpen(v => !v)}
              className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all">
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="absolute top-14 left-0 right-0 bg-white dark:bg-[#0d0d18] border-b border-gray-200 dark:border-zinc-800 px-5 py-4 flex flex-col gap-3 md:hidden">
            {[["Features","#features"],["Platform","#platform"],["How it works","#how-it-works"]].map(([label,href]) => (
              <a key={label} href={href} onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
                {label}
              </a>
            ))}
            <hr className="border-gray-100 dark:border-zinc-800" />
            <Link to="/auth" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-gray-600 dark:text-gray-300">Sign in</Link>
            <Link to="/auth?mode=signup" onClick={() => setMobileOpen(false)}
              className="text-center py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-brand-600 to-info-600">
              Get started free
            </Link>
          </div>
        )}
      </header>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  HERO                                                            ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <section className="relative pt-32 pb-20 px-5 overflow-hidden">
        {/* Ambient blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/3 w-[480px] h-[480px] rounded-full bg-brand-500/10 blur-[100px]" />
          <div className="absolute top-10 right-1/4 w-[400px] h-[400px] rounded-full bg-info-500/8 blur-[100px]" />
        </div>

        <div className="relative max-w-7xl mx-auto">
          <div className="max-w-[680px] mx-auto text-center mb-14">
            <Motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1 mb-6 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 dark:text-brand-400 text-[12.5px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                Now in open beta — free for all developers
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-[4rem] font-extrabold leading-[1.1] tracking-tight mb-5">
                Code together,{" "}
                <span className="bg-gradient-to-r from-brand-500 via-info-500 to-info-400 bg-clip-text text-transparent">
                  ship faster.
                </span>
              </h1>

              <p className="text-[17px] text-gray-500 dark:text-gray-400 leading-relaxed mb-9 max-w-[520px] mx-auto">
                CodeChatter is a real-time collaborative IDE for developer teams — write, run, and debug together with built-in video, chat, and AI assistance.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link to="/auth?mode=signup"
                  className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-white text-[15px] bg-gradient-to-r from-brand-600 to-info-600 hover:from-brand-500 hover:to-info-500 transition-all shadow-[0_0_28px_rgba(124,58,237,0.3)] hover:shadow-[0_0_40px_rgba(124,58,237,0.45)]">
                  Start for free <ArrowRight size={16} />
                </Link>
                <Link to="/auth"
                  className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-[15px] text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-zinc-800/60 hover:bg-gray-200 dark:hover:bg-zinc-800 border border-gray-200 dark:border-zinc-800 transition-all">
                  Sign in
                </Link>
              </div>

              <p className="mt-3.5 text-xs text-gray-400 dark:text-gray-500">
                No credit card required · Free forever for small teams
              </p>
            </Motion.div>
          </div>

          {/* Hero visual */}
          <Motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.18 }}
            className="max-w-4xl mx-auto"
          >
            <HeroMockup />
          </Motion.div>
        </div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  STATS                                                           ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <FadeUp>
        <div className="border-y border-gray-100 dark:border-zinc-800 py-12 px-5">
          <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
            {STATS.map(({ value, label }) => (
              <div key={label}>
                <p className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-brand-500 to-info-500 bg-clip-text text-transparent">
                  {value}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-medium">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </FadeUp>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  FEATURES                                                        ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <section id="features" className="py-24 px-5">
        <div className="max-w-7xl mx-auto">
          <FadeUp className="text-center mb-14">
            <p className="text-[13px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-widest mb-3">Features</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Everything in one workspace</h2>
            <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-md mx-auto text-[15px] leading-relaxed">
              No more context-switching. Your entire dev workflow, right here.
            </p>
          </FadeUp>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <FadeUp key={title} delay={i * 0.07}>
                <Motion.div
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2 }}
                  className="group h-full rounded-lg border border-zinc-200 bg-zinc-50/80 p-6 transition-colors hover:border-brand-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-brand-500/40"
                >
                  <div className={`mb-4 flex h-9 w-9 items-center justify-center rounded-xl ${ICON_TILE}`}>
                    <Icon size={16} />
                  </div>
                  <h3 className="mb-1.5 font-semibold text-zinc-900 dark:text-white">{title}</h3>
                  <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{desc}</p>
                </Motion.div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  HOW IT WORKS                                                    ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <section id="platform" className="pb-24 px-5">
        <div className="max-w-7xl mx-auto">
          <FadeUp className="text-center mb-14">
            <p className="text-[13px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-widest mb-3">Platform overview</p>
            <h2 className="text-4xl font-extrabold tracking-tight">More than a login page</h2>
            <p className="mt-4 text-gray-500 dark:text-gray-400 max-w-2xl mx-auto text-[15px] leading-relaxed">
              CodeChatter gives your team a full website experience from the start: a clear product page, guided authentication, and dedicated collaborative rooms for actual work.
            </p>
          </FadeUp>

          <div className="grid gap-5 lg:grid-cols-2">
            {PLATFORM_DETAILS.map(({ icon: Icon, title, desc }, i) => (
              <FadeUp key={title} delay={i * 0.08}>
                <div className="h-full rounded-lg border border-gray-200 bg-white/80 p-6 transition-all hover:-translate-y-1 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="w-10 h-10 rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-500 dark:text-brand-300 flex items-center justify-center mb-4">
                    <Icon size={18} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-24 px-5 bg-gray-50 dark:bg-zinc-900">
        <div className="max-w-7xl mx-auto">
          <FadeUp className="text-center mb-16">
            <p className="text-[13px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-widest mb-3">How it works</p>
            <h2 className="text-4xl font-extrabold tracking-tight">Up and running in minutes</h2>
          </FadeUp>

          <div className="grid sm:grid-cols-3 gap-10 max-w-4xl mx-auto">
            {STEPS.map(({ n, title, desc }, i) => (
              <FadeUp key={n} delay={i * 0.1}>
                <p className="text-8xl font-black text-gray-100 dark:text-white/[0.04] leading-none select-none mb-4">{n}</p>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  CTA                                                             ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <section className="py-28 px-5">
        <FadeUp className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-5">
            Start coding{" "}
            <span className="bg-gradient-to-r from-brand-500 to-info-500 bg-clip-text text-transparent">
              together today.
            </span>
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-[15px] leading-relaxed max-w-md mx-auto">
            Join thousands of developers using CodeChatter to collaborate faster and ship better software.
          </p>
          <Link to="/auth?mode=signup"
            className="inline-flex items-center gap-2.5 px-9 py-4 rounded-xl font-bold text-white text-[15px] bg-gradient-to-r from-brand-600 to-info-600 hover:from-brand-500 hover:to-info-500 transition-all shadow-[0_0_32px_rgba(124,58,237,0.3)] hover:shadow-[0_0_48px_rgba(124,58,237,0.5)]">
            Create free account <ArrowRight size={18} />
          </Link>
          <p className="mt-4 text-[12px] text-gray-400 dark:text-gray-500">
            Free forever for small teams · No credit card required
          </p>
        </FadeUp>
      </section>

      {/* ╔══════════════════════════════════════════════════════════════════╗ */}
      {/* ║  FOOTER                                                          ║ */}
      {/* ╚══════════════════════════════════════════════════════════════════╝ */}
      <footer className="border-t border-gray-100 dark:border-zinc-800 py-10 px-5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-5">
          <BrandLogo size="sm" />
          <p className="text-[13px] text-gray-400 text-center">
            © {new Date().getFullYear()} CodeChatter — built for developers, by developers.
          </p>
          <div className="flex gap-6 text-[13px] text-gray-400">
            <a href="#features" className="hover:text-gray-700 dark:hover:text-white transition-colors">Features</a>
            <a href="#platform" className="hover:text-gray-700 dark:hover:text-white transition-colors">Platform</a>
            <Link to="/auth" className="hover:text-gray-700 dark:hover:text-white transition-colors">Auth</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
