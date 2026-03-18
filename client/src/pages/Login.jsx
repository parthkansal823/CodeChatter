import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { Eye, EyeOff, Github } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { TypeAnimation } from "react-type-animation";

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [cardGlow, setCardGlow] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);

  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Simulated backend delay
    await new Promise((r) => setTimeout(r, 1500));

    setLoading(false);
  };

  const handleGithubLogin = () => {
    console.log("GitHub OAuth Clicked");
     window.location.href = "http://localhost:8000/auth/github";
  };

  const navigate = useNavigate();

  const handleGoogleLogin = () => {
    console.log("Google OAuth Clicked");
    window.location.href = "http://localhost:8000/auth/google";
  };

  const handleLogout = () => {
    console.log("Logout clicked");
    // Clear any stored auth tokens and redirect to the login page
    localStorage.clear();
    navigate("/login");
  };

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      onMouseMove={handleMouseMove}
      className="relative min-h-screen bg-black overflow-hidden text-white"
    >
      {/* Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:40px_40px] animate-gridMove" />

      {/* Animated Blobs */}
      <div className="absolute top-[-200px] left-[-200px] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-[-200px] right-[-200px] w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-3xl animate-pulse" />

      {/* Mouse Glow */}
      <div
        className="pointer-events-none absolute w-96 h-96 bg-purple-600/20 rounded-full blur-3xl"
        style={{
          left: mousePos.x - 200,
          top: mousePos.y - 200,
        }}
      />

      {/* Noise Overlay */}
      <div className="absolute inset-0 opacity-5 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

      <div className="relative z-10 flex min-h-screen">

        {/* Hero Section */}
        <div className="hidden lg:flex w-1/2 flex-col justify-center px-20">
          <Motion.h1
            initial={{ opacity: 0, x: -60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1 }}
            className="text-6xl font-bold leading-tight"
          >
            Code.
            <br />
            Connect.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 animate-gradientText">
              Collaborate.
            </span>
          </Motion.h1>

          <Motion.p
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 0.8, x: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-6 text-gray-400 max-w-md"
          >
            Real-time secure communication for developers.
          </Motion.p>

          {/* Terminal Animation */}
          <div className="mt-8 bg-black/60 border border-white/10 rounded-xl p-4 text-green-400 text-sm font-mono shadow-inner">
            <TypeAnimation
              sequence={[
                "Initializing secure connection...",
                1500,
                "Connecting to CodeChatter server...",
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

        {/* Login Card */}
        <div className="flex w-full lg:w-1/2 items-center justify-center px-6">
          <Motion.div
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
              Welcome Back
            </h2>
            <p className="text-gray-400 text-sm mb-8">
              Login to continue coding.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Username */}
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  placeholder=" "
                  required
                  className="peer w-full px-4 pt-6 pb-2 bg-transparent border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
                />
                <label
                  htmlFor="username"
                  className="absolute left-4 top-4 text-gray-400 text-sm transition-all 
                    peer-focus:top-2 peer-focus:text-xs peer-focus:text-purple-400
                    peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
                    peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-xs
                    pointer-events-none"
                >
                  Username
                </label>
              </div>

              {/* Password */}
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder=" "
                  required
                  className="peer w-full px-4 pt-6 pb-2 bg-transparent border border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:outline-none transition"
                />
                <label
                  htmlFor="password"
                  className="absolute left-4 top-4 text-gray-400 text-sm transition-all 
                    peer-focus:top-2 peer-focus:text-xs peer-focus:text-purple-400
                    peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
                    peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:text-xs
                    pointer-events-none"
                >
                  Password
                </label>

                <div
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-4 cursor-pointer text-gray-400 hover:text-white"
                >
                  {showPassword ? <Eye size={20}/> : <EyeOff size={20}/>}
                </div>
              </div>

              {/* Options */}
              <div className="flex justify-between text-sm text-gray-400">
                <label className="flex gap-2 items-center">
                  <input type="checkbox" className="accent-purple-500"/>
                  Remember me
                </label>
                <span className="hover:text-purple-400 cursor-pointer">
                  Forgot password?
                </span>
              </div>

              {/* Login Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium 
                bg-gradient-to-r from-purple-500 to-blue-500
                hover:scale-105 active:scale-95 transition duration-200 shadow-lg shadow-purple-500/20"
              >
                {loading ? "Logging in..." : "Login"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-700"/>
                <span className="text-gray-500 text-sm">OR</span>
                <div className="flex-1 h-px bg-gray-700"/>
              </div>

              {/* OAuth Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleGithubLogin}
                  className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
                >
                  <Github size={18}/>
                  GitHub
                </button>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
                >
                  
                  <FcGoogle size={18}/>
                  Google
                </button>

                <button onClick={handleLogout}>Logout</button>
              </div>
            </form>

            <p className="text-center text-sm text-gray-400 mt-6">
              Don’t have an account?{" "}
              <Link to="/signup" className="text-purple-400 hover:underline">
                Signup
              </Link>
            </p>
          </Motion.div>
        </div>
      </div>
    </Motion.div>
  );
}
