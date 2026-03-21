import { motion as Motion } from "framer-motion";
import { TypeAnimation } from "react-type-animation";

export default function AuthFormLayout({ children, onMouseMove, isSignup = false }) {
  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
      onMouseMove={onMouseMove}
      className="relative min-h-screen bg-[#050505] overflow-hidden text-white flex justify-center items-center"
    >
      {/* Aurora Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <Motion.div 
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.25, 0.45, 0.25],
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[70vw] h-[70vw] max-w-[800px] max-h-[800px] rounded-full bg-purple-600/30 blur-[120px]"
        />
        <Motion.div 
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.15, 0.35, 0.15],
            x: [0, -100, 0],
            y: [0, 100, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-[0%] -right-[10%] w-[60vw] h-[60vw] max-w-[600px] max-h-[600px] rounded-full bg-blue-600/20 blur-[120px]"
        />
        <Motion.div 
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.15, 0.25, 0.15],
            y: [0, -100, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[20%] right-[20%] w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] rounded-full bg-cyan-500/10 blur-[100px]"
        />
      </div>

      {/* Grain Overlay for premium texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      <div className="relative z-10 flex w-full max-w-7xl min-h-screen items-center">
        {/* Left Hero Section */}
        <div className="hidden lg:flex w-1/2 flex-col justify-center px-12 xl:px-20 relative">
          <Motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-8 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-purple-300">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Systems Operational
            </div>

            <h1 className="text-6xl xl:text-7xl font-extrabold tracking-tight leading-[1.1]">
              <span className="block text-white">Code.</span>
              <span className="block text-white/80">Connect.</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-400">
                Create.
              </span>
            </h1>

            <p className="mt-6 text-gray-400 max-w-md text-lg leading-relaxed font-light">
              Experience the next generation of real-time collaborative development. Secure, fast, and remarkably beautiful.
            </p>

            <div className="mt-12 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl p-6 text-sm font-mono shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/5">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <div className="text-gray-500 text-xs">terminal ~ codechatter</div>
              </div>
              <div className="text-gray-300">
                <span className="text-purple-400">➜</span> <span className="text-cyan-400">~</span>{" "}
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

        {/* Right Form Section */}
        <div className="flex w-full lg:w-1/2 items-center justify-center p-6 sm:p-12 relative z-20">
          {children}
        </div>
      </div>
    </Motion.div>
  );
}
