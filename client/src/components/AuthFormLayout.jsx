import { motion as Motion } from "framer-motion";
import { Zap, Lock, Users, Terminal } from "lucide-react";
import BrandLogo from "./BrandLogo";

const FEATURES = [
  {
    icon: Users,
    label: "Real-time collaboration",
    desc: "Code together with zero latency, live cursors included",
  },
  {
    icon: Terminal,
    label: "Monaco-powered editor",
    desc: "Full VS Code experience right in your browser",
  },
  {
    icon: Lock,
    label: "End-to-end secure rooms",
    desc: "Your sessions and code stay private by default",
  },
  {
    icon: Zap,
    label: "Instant room creation",
    desc: "Share a link and start coding in seconds",
  },
];

const AVATARS  = ["#7c3aed", "#2563eb", "#0891b2", "#059669"];
const INITIALS = ["A", "P", "N", "V"];

// ── Shared easing ─────────────────────────────────────────────────────────────
const EASE_EXPO = [0.22, 1, 0.36, 1];   // easeOutExpo — fast then glide
const SPRING    = { type: "spring", stiffness: 320, damping: 26 };
const SPRING_POP = { type: "spring", stiffness: 420, damping: 20 }; // slight overshoot

// ── Variants ──────────────────────────────────────────────────────────────────
const featureVariants = {
  hidden:  { opacity: 0, x: -20, scale: 0.94 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { ...SPRING, delay: 0.28 + i * 0.09 },
  }),
};

const avatarVariants = {
  hidden:  { opacity: 0, x: -10, scale: 0.8 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { ...SPRING_POP, delay: 0.7 + i * 0.07 },
  }),
};

export default function AuthFormLayout({ children }) {
  return (
    <div className="min-h-screen flex bg-[#08080f] text-white overflow-hidden">

      {/* ── Background ── */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Dot grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.032) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Animated blobs */}
        <Motion.div
          animate={{
            scale:   [1, 1.25, 0.9, 1],
            x:       [0, 40, -20, 0],
            y:       [0, -50, 25, 0],
            opacity: [0.09, 0.15, 0.08, 0.09],
          }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-48 -left-48 w-[620px] h-[620px] rounded-full bg-purple-700"
          style={{ filter: "blur(120px)" }}
        />
        <Motion.div
          animate={{
            scale:   [1, 0.8, 1.15, 1],
            x:       [0, -30, 15, 0],
            y:       [0, 40, -30, 0],
            opacity: [0.06, 0.11, 0.07, 0.06],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 4 }}
          className="absolute -bottom-48 -right-24 w-[540px] h-[540px] rounded-full bg-indigo-600"
          style={{ filter: "blur(120px)" }}
        />
        <Motion.div
          animate={{
            scale:   [1, 1.4, 1],
            opacity: [0.03, 0.08, 0.03],
          }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] h-[320px] rounded-full bg-blue-500"
          style={{ filter: "blur(100px)" }}
        />
      </div>

      {/* ── LEFT: Brand panel ── */}
      <Motion.aside
        initial={{ opacity: 0, x: -32, filter: "blur(8px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: EASE_EXPO }}
        className="hidden lg:flex w-[440px] xl:w-[480px] shrink-0 flex-col justify-between p-10 xl:p-14 border-r border-white/[0.06] relative z-10"
      >
        {/* Logo */}
        <Motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.12 }}
        >
          <BrandLogo size="lg" />
        </Motion.div>

        {/* Headline + copy */}
        <div>
          <Motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_EXPO, delay: 0.2 }}
          >
            <h2 className="text-[2.4rem] xl:text-[2.7rem] font-bold leading-[1.18] tracking-tight mb-4">
              Your workspace,{" "}
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                multiplied.
              </span>
            </h2>
            <p className="text-gray-400 text-[0.93rem] leading-relaxed mb-10">
              Collaborate, compile, and ship — all from one beautifully crafted
              environment built for developers.
            </p>
          </Motion.div>

          {/* Feature list */}
          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, label, desc }, i) => (
              <Motion.div
                key={label}
                custom={i}
                variants={featureVariants}
                initial="hidden"
                animate="visible"
                className="flex items-start gap-3.5"
              >
                <Motion.div
                  whileHover={{ scale: 1.12, rotate: 6 }}
                  transition={SPRING_POP}
                  className="mt-0.5 w-8 h-8 rounded-lg bg-white/[0.045] border border-white/[0.08] flex items-center justify-center flex-shrink-0"
                >
                  <Icon size={14} className="text-purple-400" />
                </Motion.div>
                <div>
                  <p className="text-[13.5px] font-medium text-gray-100">{label}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{desc}</p>
                </div>
              </Motion.div>
            ))}
          </div>
        </div>

        {/* Social proof */}
        <Motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.68 }}
          className="flex items-center gap-3 pt-6 border-t border-white/[0.06]"
        >
          <div className="flex -space-x-2">
            {AVATARS.map((bg, i) => (
              <Motion.div
                key={i}
                custom={i}
                variants={avatarVariants}
                initial="hidden"
                animate="visible"
                whileHover={{ scale: 1.2, zIndex: 10 }}
                transition={SPRING_POP}
                className="w-7 h-7 rounded-full border-2 border-[#08080f] flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: bg }}
              >
                {INITIALS[i]}
              </Motion.div>
            ))}
          </div>
          <div>
            <p className="text-[12.5px] font-medium text-white">2,000+ developers</p>
            <p className="text-[11.5px] text-gray-500">already collaborating</p>
          </div>
        </Motion.div>
      </Motion.aside>

      {/* ── RIGHT: Form panel ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative z-10">
        <Motion.div
          initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: EASE_EXPO, delay: 0.05 }}
          className="w-full max-w-[400px]"
        >
          {children}
        </Motion.div>
      </div>
    </div>
  );
}
