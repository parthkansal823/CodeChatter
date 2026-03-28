import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Github, Mail, Lock, User } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import toast from "react-hot-toast";
import FloatingInput from "../components/FloatingInput";
import PasswordInput from "../components/PasswordInput";
import AuthFormLayout from "../components/AuthFormLayout";
import { API_ENDPOINTS } from "../config/security";
import { useAuth } from "../hooks/useAuth";

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [cardGlow, setCardGlow] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);

  const formVariant = {
    hidden: { opacity: 0, x: mode === "login" ? -20 : 20, filter: "blur(4px)" },
    visible: {
      opacity: 1,
      x: 0,
      filter: "blur(0px)",
      transition: { duration: 0.4, ease: "easeOut", staggerChildren: 0.08, delayChildren: 0.1 },
    },
    exit: {
      opacity: 0,
      x: mode === "login" ? 20 : -20,
      filter: "blur(4px)",
      transition: { duration: 0.2 },
    },
  };

  const itemVariant = {
    hidden: { opacity: 0, y: 15, filter: "blur(4px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.4, ease: "easeOut" } },
  };

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const navigate = useNavigate();
  const { login, signup } = useAuth();

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const result = await login(loginEmail, loginPassword);

      if (result.success) {
        toast.success("Logged in successfully!");
        navigate("/home");
      } else {
        toast.error(result.error || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignupSubmit = async (event) => {
    event.preventDefault();

    if (signupPassword !== signupConfirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const result = await signup(signupEmail, signupUsername, signupPassword);

      if (result.success) {
        toast.success("Account created! Welcome to CodeChatter!");
        navigate("/home");
      } else {
        toast.error(result.error || "Signup failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const startOAuthLogin = (providerUrl) => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `${providerUrl}?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  return (
    <AuthFormLayout isSignup={mode === "signup"}>
      <Motion.div
        whileHover={{ rotateX: 2, rotateY: -2 }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setCardGlow({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }}
        style={{
          background: `radial-gradient(circle 350px at ${cardGlow.x}px ${cardGlow.y}px, rgba(168,85,247,0.1), transparent 80%)`,
        }}
        className="w-full max-w-md bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 sm:p-10 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />


        <div className="relative flex p-1 mb-8 bg-black/40 border border-white/5 rounded-xl overflow-hidden">
          <div
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white/10 border border-white/10 rounded-lg shadow-sm transition-transform duration-300 ease-out ${mode === "signup" ? "translate-x-[calc(100%+0px)]" : "translate-x-0"
              }`}
          />
          <button
            onClick={() => setMode("login")}
            className={`relative w-1/2 py-2.5 text-sm font-semibold tracking-wide transition-colors z-10 ${mode === "login" ? "text-white" : "text-gray-400 hover:text-white"
              }`}
          >
            Login
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`relative w-1/2 py-2.5 text-sm font-semibold tracking-wide transition-colors z-10 ${mode === "signup" ? "text-white" : "text-gray-400 hover:text-white"
              }`}
          >
            Sign Up
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <Motion.div
            key={mode}
            variants={formVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {mode === "login" ? (
              <>
                <Motion.h2 variants={itemVariant} className="text-3xl font-bold mb-2 tracking-tight">Welcome Back</Motion.h2>
                <Motion.p variants={itemVariant} className="text-gray-400 text-sm mb-8 font-light tracking-wide">Enter your credentials to continue coding.</Motion.p>

                <form onSubmit={handleLoginSubmit} className="space-y-5">
                  <Motion.div variants={itemVariant}>
                    <FloatingInput
                      id="login-email"
                      label="Email or Username"
                      type="text"
                      required
                      value={loginEmail}
                      onChange={(event) => setLoginEmail(event.target.value)}
                      icon={Mail}
                    />
                  </Motion.div>

                  <Motion.div variants={itemVariant}>
                    <PasswordInput
                      id="login-password"
                      label="Password"
                      required
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      icon={Lock}
                    />
                  </Motion.div>

                  <Motion.div variants={itemVariant} className="flex justify-between items-center text-sm text-gray-400 pt-1">
                    <label className="flex gap-2 items-center hover:text-white cursor-pointer transition-colors">
                      <input type="checkbox" className="accent-purple-500 rounded bg-white/10 border-white/20 w-4 h-4" />
                      Remember me
                    </label>
                    <span className="hover:text-purple-400 cursor-pointer font-medium transition-colors">
                      Forgot password?
                    </span>
                  </Motion.div>

                  <Motion.button
                    variants={itemVariant}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full mt-4 py-3.5 rounded-xl font-semibold tracking-wide text-white bg-gradient-to-r from-purple-600 to-blue-600 transition-all shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] disabled:opacity-50"
                  >
                    {loading ? "Authenticating..." : "Login to Workspace"}
                  </Motion.button>
                </form>
              </>
            ) : (
              <>
                <Motion.h2 variants={itemVariant} className="text-3xl font-bold mb-2 tracking-tight">Create Account</Motion.h2>
                <Motion.p variants={itemVariant} className="text-gray-400 text-sm mb-8 font-light tracking-wide">Join thousands of developers on CodeChatter.</Motion.p>

                <form onSubmit={handleSignupSubmit} className="space-y-4">
                  <Motion.div variants={itemVariant} className="grid grid-cols-2 gap-4">
                    <FloatingInput
                      id="signup-email"
                      label="Email"
                      type="email"
                      required
                      value={signupEmail}
                      onChange={(event) => setSignupEmail(event.target.value)}
                      icon={Mail}
                    />

                    <FloatingInput
                      id="signup-username"
                      label="Username"
                      type="text"
                      required
                      value={signupUsername}
                      onChange={(event) => setSignupUsername(event.target.value)}
                      icon={User}
                    />
                  </Motion.div>

                  <Motion.div variants={itemVariant} className="grid grid-cols-2 gap-4">
                    <PasswordInput
                      id="signup-password"
                      label="Password"
                      required
                      value={signupPassword}
                      onChange={(event) => setSignupPassword(event.target.value)}
                      icon={Lock}
                    />

                    <PasswordInput
                      id="signup-confirm-password"
                      label="Confirm"
                      required
                      value={signupConfirmPassword}
                      onChange={(event) => setSignupConfirmPassword(event.target.value)}
                      icon={Lock}
                    />
                  </Motion.div>

                  <Motion.button
                    variants={itemVariant}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={loading}
                    className="w-full mt-4 py-3.5 rounded-xl font-semibold tracking-wide text-white bg-gradient-to-r from-purple-600 to-blue-600 transition-all shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] disabled:opacity-50"
                  >
                    {loading ? "Creating..." : "Create Free Account"}
                  </Motion.button>
                </form>
              </>
            )}
          </Motion.div>
        </AnimatePresence>

        <div className="flex items-center gap-4 my-8">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent to-white/10" />
          <span className="text-gray-500 text-xs font-medium uppercase tracking-widest">or continue with</span>
          <div className="flex-1 h-px bg-gradient-to-l from-transparent to-white/10" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => startOAuthLogin(API_ENDPOINTS.GITHUB_LOGIN)}
            className="flex items-center justify-center gap-3 py-3 bg-white/[0.03] border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all duration-300 group"
          >
            <Github size={18} className="text-gray-300 group-hover:text-white transition-colors" />
            <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">GitHub</span>
          </Motion.button>

          <Motion.button
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={() => startOAuthLogin(API_ENDPOINTS.GOOGLE_LOGIN)}
            className="flex items-center justify-center gap-3 py-3 bg-white/[0.03] border border-white/10 rounded-xl hover:bg-white/10 hover:border-white/20 transition-all duration-300 group"
          >
            <FcGoogle size={18} />
            <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">Google</span>
          </Motion.button>
        </div>

        <p className="text-center text-sm text-gray-400 mt-8 font-light">
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-white hover:text-purple-400 font-medium transition-colors"
                style={{ textDecorationColor: 'rgba(168,85,247,0.5)', textUnderlineOffset: '4px' }}
              >
                <span className="hover:underline">Sign up now</span>
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-white hover:text-purple-400 font-medium transition-colors"
                style={{ textDecorationColor: 'rgba(168,85,247,0.5)', textUnderlineOffset: '4px' }}
              >
                <span className="hover:underline">Log in instead</span>
              </button>
            </>
          )}
        </p>
      </Motion.div>
    </AuthFormLayout>
  );
}
