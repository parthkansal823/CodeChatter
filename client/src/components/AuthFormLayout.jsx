import { motion as Motion } from "framer-motion";
import { TypeAnimation } from "react-type-animation";

export default function AuthFormLayout({ children, onMouseMove, isSignup = false }) {
  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      onMouseMove={onMouseMove}
      className="relative min-h-screen bg-black overflow-hidden text-white"
    >
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:30px_30px] sm:bg-[size:40px_40px] animate-gridMove" />

      <div className="absolute top-[-150px] sm:top-[-200px] left-[-150px] sm:left-[-200px] w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-purple-600/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-[-150px] sm:bottom-[-200px] right-[-150px] sm:right-[-200px] w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-blue-600/20 rounded-full blur-3xl animate-pulse" />

      <div className="absolute inset-0 opacity-5 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden lg:flex w-1/2 flex-col justify-center px-12 xl:px-20">
          <Motion.h1
            initial={{ opacity: 0, x: -60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1 }}
            className="text-5xl lg:text-6xl font-bold leading-tight"
          >
            {isSignup ? "Join." : "Code."}
            <br />
            {isSignup ? "Build." : "Connect."}
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 animate-gradientText">
              Collaborate.
            </span>
          </Motion.h1>

          <Motion.p
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 0.8, x: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-6 text-gray-400 max-w-md text-sm lg:text-base"
          >
            Real-time secure communication for developers.
          </Motion.p>

          <div className="mt-8 bg-black/60 border border-white/10 rounded-xl p-4 text-green-400 text-xs lg:text-sm font-mono shadow-inner">
            <TypeAnimation
              sequence={[
                isSignup ? "Creating secure developer account..." : "Initializing secure connection...",
                1500,
                isSignup ? "Setting up workspace..." : "Connecting to CodeChatter server...",
                1500,
                "Authentication ready.",
                2000,
              ]}
              wrapper="span"
              speed={50}
              repeat={Infinity}
            />
          </div>
        </div>

        <div className="flex w-full lg:w-1/2 items-center justify-center px-4 sm:px-6 py-6 lg:py-0">
          {children}
        </div>
      </div>
    </Motion.div>
  );
}
