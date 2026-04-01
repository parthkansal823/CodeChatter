// eslint-disable-next-line no-unused-vars
import { motion } from "framer-motion";

export default function FloatingHelper() {
  return (
    <motion.div
      animate={{ y: [0, -9, 0] }}
      transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
      className="fixed bottom-6 left-6 z-[50] group flex flex-col items-start justify-end"
    >
      {/* Tooltip */}
      <div className="absolute bottom-[5.5rem] left-0 pointer-events-none opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="relative min-w-[190px] rounded-xl border border-amber-400/30 bg-[#1c1007]/90 backdrop-blur-sm p-3 text-sm font-medium text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.25)]">
          Need help? I&apos;m your AI buddy!
          <div className="absolute -bottom-2 left-6 h-0 w-0 border-x-8 border-x-transparent border-t-8 border-t-[#1c1007]/90" />
          <div className="absolute -bottom-[9px] left-6 -z-10 h-0 w-0 border-x-[9px] border-x-transparent border-t-[9px] border-t-amber-400/30" />
        </div>
      </div>

      {/* Icon avatar — smaller: h-14 w-14 */}
      <div className="h-14 w-14 cursor-pointer select-none transition-transform duration-200 hover:scale-110 drop-shadow-[0_4px_12px_rgba(251,191,36,0.5)]">
        <svg viewBox="0 0 140 140" className="h-full w-full overflow-visible">
          {/* ── Yellow/orange background circle ── */}
          <circle cx="68" cy="72" r="62" fill="#f59e0b" />
          <circle cx="68" cy="72" r="62" fill="none" stroke="#fde68a" strokeWidth="4" opacity="0.4" />

          {/* ── Browser window ── */}
          <rect x="10" y="22" width="96" height="82" rx="5" fill="white" />
          <rect x="10" y="22" width="96" height="20" rx="5" fill="#1e3a8a" />
          <rect x="10" y="34"  width="96" height="8"  fill="#1e3a8a" />
          <circle cx="21" cy="32" r="3.5" fill="#93c5fd" />
          <circle cx="31" cy="32" r="3.5" fill="#93c5fd" />
          <circle cx="41" cy="32" r="3.5" fill="#93c5fd" />

          {/* ── Image thumbnail ── */}
          <motion.g
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "26px 57px" }}
          >
            <rect x="14" y="44" width="30" height="26" rx="3" fill="#06b6d4" />
            <rect x="14" y="44" width="30" height="12" rx="3" fill="#0ea5e9" />
            <polygon points="14,70 22,57 30,65 38,54 44,70" fill="#0284c7" />
            <circle cx="40" cy="50" r="4" fill="#fde68a" opacity="0.9" />
          </motion.g>

          {/* ── Content lines ── */}
          <motion.rect x="49" y="47" width="32" height="5" rx="2.5" fill="#3b82f6"
            animate={{ width: [32, 38, 32], opacity: [1, 0.65, 1] }}
            transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut", delay: 0 }} />
          <rect x="84" y="47" width="15" height="5" rx="2.5" fill="#3b82f6" opacity="0.6" />

          <motion.rect x="49" y="56" width="38" height="5" rx="2.5" fill="#22c55e"
            animate={{ width: [38, 30, 38], opacity: [1, 0.65, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.35 }} />
          <rect x="90" y="56" width="10" height="5" rx="2.5" fill="#22c55e" opacity="0.6" />

          <motion.rect x="49" y="65" width="26" height="5" rx="2.5" fill="#f97316"
            animate={{ width: [26, 32, 26], opacity: [1, 0.65, 1] }}
            transition={{ duration: 2.7, repeat: Infinity, ease: "easeInOut", delay: 0.6 }} />
          <rect x="78" y="65" width="18" height="5" rx="2.5" fill="#f97316" opacity="0.55" />

          <motion.rect x="14" y="75" width="24" height="5" rx="2.5" fill="#f97316"
            animate={{ opacity: [0.9, 0.5, 0.9] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.2 }} />
          <motion.rect x="41" y="75" width="28" height="5" rx="2.5" fill="#3b82f6"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} />
          <motion.rect x="72" y="75" width="22" height="5" rx="2.5" fill="#22c55e"
            animate={{ opacity: [1, 0.6, 1] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 0.8 }} />

          <motion.rect x="14" y="84" width="20" height="5" rx="2.5" fill="#3b82f6"
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.4 }} />
          <rect x="37" y="84" width="32" height="5" rx="2.5" fill="#f97316" opacity="0.75" />

          {/* ── Magnifying glass — static ── */}
          <motion.g
            animate={{ scale: [1, 1.07, 1] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
            style={{ transformOrigin: "78px 64px" }}
          >
            <circle cx="78" cy="64" r="16" fill="#1e293b" />
            <circle cx="78" cy="64" r="10" fill="white" />
            <circle cx="78" cy="64" r="5.5" fill="#1e293b" />
            <circle cx="80"  cy="61.5" r="1.8" fill="white" opacity="0.8" />
            <line x1="89" y1="75" x2="97" y2="83" stroke="#1e293b" strokeWidth="6" strokeLinecap="round" />
          </motion.g>

          {/* ── Blue document card ── */}
          <motion.g
            animate={{ y: [0, -6, 0], rotate: [-1.5, 1.5, -1.5] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
            style={{ transformOrigin: "112px 110px" }}
          >
            <rect x="90" y="82" width="44" height="52" rx="5" fill="#2563eb" />
            <rect x="97" y="93"  width="30" height="4" rx="2" fill="white" opacity="0.9" />
            <rect x="97" y="101" width="25" height="4" rx="2" fill="white" opacity="0.8" />
            <rect x="97" y="109" width="30" height="4" rx="2" fill="white" opacity="0.9" />
            <rect x="97" y="117" width="20" height="4" rx="2" fill="white" opacity="0.7" />
          </motion.g>
        </svg>
      </div>
    </motion.div>
  );
}
