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

const EASE_EXPO = [0.22, 1, 0.36, 1];
const SPRING = { type: "spring", stiffness: 320, damping: 26 };
const SPRING_POP = { type: "spring", stiffness: 420, damping: 20 };

const featureVariants = {
  hidden: { opacity: 0, x: -20, scale: 0.94 },
  visible: (index) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { ...SPRING, delay: 0.24 + index * 0.08 },
  }),
};

const avatarVariants = {
  hidden: { opacity: 0, x: -10, scale: 0.8 },
  visible: (index) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { ...SPRING_POP, delay: 0.62 + index * 0.06 },
  }),
};

export default function AuthFormLayout({ children }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#08080f] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.032) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <Motion.div
          animate={{
            scale: [1, 1.25, 0.9, 1],
            x: [0, 40, -20, 0],
            y: [0, -50, 25, 0],
            opacity: [0.09, 0.15, 0.08, 0.09],
          }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-48 -left-48 h-[620px] w-[620px] rounded-full bg-purple-700"
          style={{ filter: "blur(120px)" }}
        />
        <Motion.div
          animate={{
            scale: [1, 0.8, 1.15, 1],
            x: [0, -30, 15, 0],
            y: [0, 40, -30, 0],
            opacity: [0.06, 0.11, 0.07, 0.06],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 4 }}
          className="absolute -bottom-48 -right-24 h-[540px] w-[540px] rounded-full bg-indigo-600"
          style={{ filter: "blur(120px)" }}
        />
        <Motion.div
          animate={{
            scale: [1, 1.4, 1],
            opacity: [0.03, 0.08, 0.03],
          }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500"
          style={{ filter: "blur(100px)" }}
        />
      </div>

      <Motion.aside
        initial={{ opacity: 0, x: -32, filter: "blur(8px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: EASE_EXPO }}
        className="relative z-10 hidden w-[420px] shrink-0 flex-col justify-between border-r border-white/[0.06] px-8 py-8 lg:flex xl:w-[460px] xl:px-10 xl:py-10"
      >
        <Motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.12 }}
        >
          <BrandLogo size="lg" />
        </Motion.div>

        <div>
          <Motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_EXPO, delay: 0.2 }}
          >
            <h2 className="mb-3 text-[2.15rem] font-bold leading-[1.15] tracking-tight xl:text-[2.45rem]">
              Your workspace,{" "}
              <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                multiplied.
              </span>
            </h2>
            <p className="mb-8 text-[0.92rem] leading-relaxed text-gray-400">
              Collaborate, compile, and ship from one environment built for developers.
            </p>
          </Motion.div>

          <div className="space-y-4">
            {FEATURES.map(({ icon: Icon, label, desc }, index) => (
              <Motion.div
                key={label}
                custom={index}
                variants={featureVariants}
                initial="hidden"
                animate="visible"
                className="flex items-start gap-3.5"
              >
                <Motion.div
                  whileHover={{ scale: 1.08, rotate: 4 }}
                  transition={SPRING_POP}
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.045]"
                >
                  <Icon size={14} className="text-purple-400" />
                </Motion.div>
                <div>
                  <p className="text-[13.5px] font-medium text-gray-100">{label}</p>
                  <p className="mt-0.5 text-[12px] text-gray-500">{desc}</p>
                </div>
              </Motion.div>
            ))}
          </div>
        </div>

        <Motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.68 }}
          className="flex items-center gap-3 border-t border-white/[0.06] pt-4"
        >
          <div className="flex -space-x-2">
            {AVATARS.map((background, index) => (
              <Motion.div
                key={index}
                custom={index}
                variants={avatarVariants}
                initial="hidden"
                animate="visible"
                whileHover={{ scale: 1.14, zIndex: 10 }}
                transition={SPRING_POP}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#08080f] text-[10px] font-bold text-white"
                style={{ background }}
              >
                {INITIALS[index]}
              </Motion.div>
            ))}
          </div>
          <div>
            <p className="text-[12.5px] font-medium text-white">2,000+ developers</p>
            <p className="text-[11.5px] text-gray-500">already collaborating</p>
          </div>
        </Motion.div>
      </Motion.aside>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-4 sm:px-6 sm:py-6">
        <Motion.div
          initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.6, ease: EASE_EXPO, delay: 0.05 }}
          className="w-full max-w-[390px] lg:max-w-[400px]"
        >
          {children}
        </Motion.div>
      </div>
    </div>
  );
}
