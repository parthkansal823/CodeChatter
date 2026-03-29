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

const AVATARS = ["#7c3aed", "#2563eb", "#0891b2", "#059669"];
const INITIALS = ["A", "P", "N", "V"];

export default function AuthFormLayout({ children }) {
  return (
    <div className="min-h-screen flex bg-[#08080f] text-white">
      {/* Dot-grid background */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Ambient light blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-48 -left-48 w-[600px] h-[600px] rounded-full bg-purple-700/10 blur-[130px]" />
        <div className="absolute -bottom-48 -right-24 w-[520px] h-[520px] rounded-full bg-indigo-700/8 blur-[130px]" />
      </div>

      {/* ── LEFT: Brand panel ── */}
      <Motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="hidden lg:flex w-[440px] xl:w-[480px] shrink-0 flex-col justify-between p-10 xl:p-14 border-r border-white/[0.06] relative z-10"
      >
        {/* Logo */}
        <BrandLogo size="lg" />

        {/* Hero copy + features */}
        <div>
          <Motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
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

          <div className="space-y-5">
            {FEATURES.map(({ icon: Icon, label, desc }, i) => (
              <Motion.div
                key={label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.38, delay: 0.18 + i * 0.07 }}
                className="flex items-start gap-3.5"
              >
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-white/[0.045] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                  <Icon size={14} className="text-purple-400" />
                </div>
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.55 }}
          className="flex items-center gap-3 pt-6 border-t border-white/[0.06]"
        >
          <div className="flex -space-x-2">
            {AVATARS.map((bg, i) => (
              <div
                key={i}
                className="w-7 h-7 rounded-full border-2 border-[#08080f] flex items-center justify-center text-white text-[10px] font-bold"
                style={{ background: bg }}
              >
                {INITIALS[i]}
              </div>
            ))}
          </div>
          <div>
            <p className="text-[12.5px] font-medium text-white">
              2,000+ developers
            </p>
            <p className="text-[11.5px] text-gray-500">already collaborating</p>
          </div>
        </Motion.div>
      </Motion.aside>

      {/* ── RIGHT: Form ── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative z-10">
        <Motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="w-full max-w-[400px]"
        >
          {children}
        </Motion.div>
      </div>
    </div>
  );
}
