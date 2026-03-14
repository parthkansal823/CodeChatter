import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Github } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { TypeAnimation } from "react-type-animation";

export default function Signup() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [cardGlow, setCardGlow] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);

  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    await new Promise((r) => setTimeout(r, 1500));

    setLoading(false);
  };

  const handleGithubLogin = () => {
    console.log("GitHub OAuth");
  };

  const handleGoogleLogin = () => {
    console.log("Google OAuth");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      onMouseMove={handleMouseMove}
      className="relative min-h-screen bg-black overflow-hidden text-white"
    >
      {/* Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:40px_40px]" />

      <div className="absolute top-[-200px] left-[-200px] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-[-200px] right-[-200px] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl animate-pulse" />

      <div
        className="pointer-events-none absolute w-96 h-96 bg-purple-600/20 rounded-full blur-3xl"
        style={{
          left: mousePos.x - 200,
          top: mousePos.y - 200,
        }}
      />

      <div className="relative z-10 flex min-h-screen">

        {/* Hero Section (same as login) */}
        <div className="hidden lg:flex w-1/2 flex-col justify-center px-20">
          <motion.h1
            initial={{ opacity: 0, x: -60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1 }}
            className="text-6xl font-bold leading-tight"
          >
            Join.
            <br />
            Build.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400">
              Collaborate.
            </span>
          </motion.h1>

          <div className="mt-8 bg-black/60 border border-white/10 rounded-xl p-4 text-green-400 text-sm font-mono">
            <TypeAnimation
              sequence={[
                "Creating secure developer account...",
                1500,
                "Setting up workspace...",
                1500,
                "Ready to collaborate.",
                2000,
              ]}
              wrapper="span"
              speed={50}
              repeat={Infinity}
            />
          </div>
        </div>

        {/* Signup Card */}
        <div className="flex w-full lg:w-1/2 items-center justify-center px-6">
          <motion.div
            whileHover={{ rotateX: 4, rotateY: -4 }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setCardGlow({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
              });
            }}
            style={{
              background: `radial-gradient(circle at ${cardGlow.x}px ${cardGlow.y}px, rgba(168,85,247,0.15), rgba(255,255,255,0.03))`,
            }}
            className="w-full max-w-md backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl"
          >
            <h2 className="text-3xl font-semibold mb-2">
              Create Account
            </h2>
            <p className="text-gray-400 text-sm mb-8">
              Join CodeChatter today.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Username */}
              <FloatingInput id="username" label="Username" />

              {/* Email */}
              <FloatingInput id="email" label="Email" type="email" />

              {/* Password */}
              <PasswordInput
                id="password"
                label="Password"
                show={showPassword}
                setShow={setShowPassword}
              />

              {/* Confirm Password */}
              <PasswordInput
                id="confirmPassword"
                label="Confirm Password"
                show={showConfirm}
                setShow={setShowConfirm}
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium 
                bg-gradient-to-r from-purple-500 to-blue-500
                hover:scale-105 active:scale-95 transition"
              >
                {loading ? "Creating..." : "Create Account"}
              </button>

              {/* OAuth */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGithubLogin}
                  className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
                >
                  <Github size={18}/> GitHub
                </button>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
                >
                  <FcGoogle size={18}/> Google
                </button>
              </div>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              Already have an account?{" "}
              <Link to="/login" className="text-purple-400 hover:underline">
                Login
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

/* Reusable Floating Input */
function FloatingInput({ id, label, type = "text" }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        placeholder=" "
        required
        className="peer w-full px-4 pt-6 pb-2 bg-transparent border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
      />
      <label
        htmlFor={id}
        className="absolute left-4 top-4 text-gray-400 text-sm transition-all 
        peer-focus:top-2 peer-focus:text-xs peer-focus:text-purple-400
        peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
        peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-xs
        pointer-events-none"
      >
        {label}
      </label>
    </div>
  );
}

/* Reusable Password Input */
function PasswordInput({ id, label, show, setShow }) {
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        placeholder=" "
        required
        className="peer w-full px-4 pt-6 pb-2 bg-transparent border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
      />
      <label
        htmlFor={id}
        className="absolute left-4 top-4 text-gray-400 text-sm transition-all 
        peer-focus:top-2 peer-focus:text-xs peer-focus:text-purple-400
        peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
        peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-xs
        pointer-events-none"
      >
        {label}
      </label>

      <div
        onClick={() => setShow(!show)}
        className="absolute right-4 top-4 cursor-pointer text-gray-400 hover:text-white"
      >
        {show ? <Eye size={20}/> : <EyeOff size={20}/>}
      </div>
    </div>
  );
}