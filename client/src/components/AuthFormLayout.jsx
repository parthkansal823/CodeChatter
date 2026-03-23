import { motion as Motion } from "framer-motion";
import { TypeAnimation } from "react-type-animation";

import BrandLogo from "./BrandLogo";

export default function AuthFormLayout({ children, onMouseMove, isSignup = false }) {
  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
      onMouseMove={onMouseMove}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] text-white"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <Motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.25, 0.45, 0.25],
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-[10%] -top-[20%] h-[70vw] w-[70vw] max-h-[800px] max-w-[800px] rounded-full bg-purple-600/30 blur-[120px]"
        />
        <Motion.div
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.15, 0.35, 0.15],
            x: [0, -100, 0],
            y: [0, 100, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-[10%] bottom-[0%] h-[60vw] w-[60vw] max-h-[600px] max-w-[600px] rounded-full bg-blue-600/20 blur-[120px]"
        />
        <Motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.15, 0.25, 0.15],
            y: [0, -100, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute right-[20%] top-[20%] h-[40vw] w-[40vw] max-h-[400px] max-w-[400px] rounded-full bg-cyan-500/10 blur-[100px]"
        />
      </div>

      <div className="absolute inset-0 pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03]" />

      <div className="relative z-10 flex min-h-screen w-full max-w-7xl items-center">
        <div className="relative hidden w-1/2 flex-col justify-center px-12 lg:flex xl:px-20">
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            <BrandLogo size="xl" />

            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-purple-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              {isSignup ? "New Developer Access" : "Systems Operational"}
            </div>

            <h1 className="text-6xl font-extrabold leading-[1.1] tracking-tight xl:text-7xl">
              <span className="block text-white">Code.</span>
              <span className="block text-white/80">Connect.</span>
              <span className="block bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Create.
              </span>
            </h1>

            <p className="mt-6 max-w-md text-lg font-light leading-relaxed text-gray-400">
              Experience the next generation of real-time collaborative development. Secure, fast, and remarkably beautiful.
            </p>

            <div className="group relative mt-12 overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-6 font-mono text-sm shadow-2xl backdrop-blur-md">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              <div className="mb-3 flex items-center gap-3 border-b border-white/5 pb-3">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                </div>
                <div className="text-xs text-gray-500">terminal ~ codechatter</div>
              </div>
              <div className="text-gray-300">
                <span className="text-purple-400">&gt;</span> <span className="text-cyan-400">~</span>{" "}
                <TypeAnimation
                  sequence={[
                    "connecting to secure node...",
                    1000,
                    "authenticating developer token...",
                    1000,
                    "workspace environment prepared.",
                    3000,
                  ]}
                  wrapper="span"
                  speed={60}
                  repeat={Infinity}
                />
              </div>
            </div>
          </Motion.div>
        </div>

        <div className="relative z-20 flex w-full items-center justify-center p-6 sm:p-12 lg:w-1/2">
          {children}
        </div>
      </div>
    </Motion.div>
  );
}
