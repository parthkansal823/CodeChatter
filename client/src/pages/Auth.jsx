import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Github, Mail, Lock, User } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import toast from "react-hot-toast";
import FloatingInput from "../components/FloatingInput";
import PasswordInput from "../components/PasswordInput";
import AuthFormLayout from "../components/AuthFormLayout";
import BrandLogo from "../components/BrandLogo";
import { API_ENDPOINTS } from "../config/security";
import { useAuth } from "../hooks/useAuth";

const slideVariant = {
  hidden: (dir) => ({ opacity: 0, x: dir * 16, filter: "blur(4px)" }),
  visible: {
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: 0.32, ease: "easeOut" },
  },
  exit: (dir) => ({
    opacity: 0,
    x: dir * -12,
    filter: "blur(4px)",
    transition: { duration: 0.2 },
  }),
};

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");

  const navigate = useNavigate();
  const { login, signup } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
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

  const handleSignup = async (e) => {
    e.preventDefault();
    if (signupPassword !== signupConfirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const result = await signup(signupEmail, signupUsername, signupPassword);
      if (result.success) {
        toast.success("Welcome to CodeChatter!");
        navigate("/home");
      } else {
        toast.error(result.error || "Signup failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const startOAuth = (url) => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `${url}?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  return (
    <AuthFormLayout>
      {/* Mobile-only logo */}
      <div className="lg:hidden mb-8">
        <BrandLogo size="md" />
      </div>

      {/* ── Tab switcher (underline style) ── */}
      <div className="flex gap-6 mb-8 border-b border-white/[0.08]">
        {[
          { key: "login", label: "Sign in" },
          { key: "signup", label: "Create account" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`pb-3 text-sm font-semibold transition-all duration-200 relative ${
              mode === key ? "text-white" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {label}
            {mode === key && (
              <Motion.span
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
              />
            )}
          </button>
        ))}
      </div>

      {/* ── Heading ── */}
      <AnimatePresence mode="wait" initial={false} custom={mode === "login" ? -1 : 1}>
        <Motion.div
          key={mode + "-heading"}
          custom={mode === "login" ? -1 : 1}
          variants={slideVariant}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="mb-7"
        >
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {mode === "login" ? "Welcome back" : "Get started free"}
          </h1>
          <p className="text-[13px] text-gray-400 mt-1.5">
            {mode === "login"
              ? "Sign in to your CodeChatter workspace"
              : "Create your account — no credit card required"}
          </p>
        </Motion.div>
      </AnimatePresence>

      {/* ── OAuth buttons ── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => startOAuth(API_ENDPOINTS.GITHUB_LOGIN)}
          className="flex items-center justify-center gap-2.5 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 group"
        >
          <Github size={16} className="text-gray-300 group-hover:text-white transition-colors" />
          <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
            GitHub
          </span>
        </Motion.button>

        <Motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => startOAuth(API_ENDPOINTS.GOOGLE_LOGIN)}
          className="flex items-center justify-center gap-2.5 py-2.5 rounded-lg bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 group"
        >
          <FcGoogle size={16} />
          <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
            Google
          </span>
        </Motion.button>
      </div>

      {/* ── Divider ── */}
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/[0.08]" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-[#08080f] text-[11px] text-gray-500 uppercase tracking-wider">
            or with email
          </span>
        </div>
      </div>

      {/* ── Forms ── */}
      <AnimatePresence mode="wait" initial={false} custom={mode === "login" ? -1 : 1}>
        {mode === "login" ? (
          <Motion.form
            key="login-form"
            custom={-1}
            variants={slideVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
            onSubmit={handleLogin}
            className="space-y-4"
          >
            <FloatingInput
              id="login-email"
              label="Email or username"
              type="text"
              required
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              icon={Mail}
            />

            <div>
              <PasswordInput
                id="login-password"
                label="Password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                icon={Lock}
              />
              <div className="flex justify-between items-center mt-2.5">
                <label className="flex items-center gap-2 text-[12.5px] text-gray-400 cursor-pointer hover:text-gray-200 transition-colors select-none">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5 rounded accent-purple-500 bg-white/10 border-white/20"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-[12.5px] text-gray-400 hover:text-purple-400 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            <Motion.button
              whileHover={{ scale: 1.015, y: -1 }}
              whileTap={{ scale: 0.985 }}
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-lg font-semibold text-sm text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all duration-200 shadow-[0_0_20px_rgba(124,58,237,0.2)] hover:shadow-[0_0_28px_rgba(124,58,237,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign in to workspace"}
            </Motion.button>
          </Motion.form>
        ) : (
          <Motion.form
            key="signup-form"
            custom={1}
            variants={slideVariant}
            initial="hidden"
            animate="visible"
            exit="exit"
            onSubmit={handleSignup}
            className="space-y-4"
          >
            <FloatingInput
              id="signup-email"
              label="Email address"
              type="email"
              required
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              icon={Mail}
            />

            <FloatingInput
              id="signup-username"
              label="Username"
              type="text"
              required
              value={signupUsername}
              onChange={(e) => setSignupUsername(e.target.value)}
              icon={User}
              placeholder="e.g. johndoe"
            />

            <PasswordInput
              id="signup-password"
              label="Password"
              required
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              icon={Lock}
            />

            <PasswordInput
              id="signup-confirm"
              label="Confirm password"
              required
              value={signupConfirm}
              onChange={(e) => setSignupConfirm(e.target.value)}
              icon={Lock}
            />

            <Motion.button
              whileHover={{ scale: 1.015, y: -1 }}
              whileTap={{ scale: 0.985 }}
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-lg font-semibold text-sm text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all duration-200 shadow-[0_0_20px_rgba(124,58,237,0.2)] hover:shadow-[0_0_28px_rgba(124,58,237,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Creating account…" : "Create free account"}
            </Motion.button>
          </Motion.form>
        )}
      </AnimatePresence>

      {/* ── Footer switch ── */}
      <p className="text-center text-[12.5px] text-gray-500 mt-7">
        {mode === "login" ? (
          <>
            No account?{" "}
            <button
              onClick={() => setMode("signup")}
              className="text-gray-200 hover:text-purple-400 font-medium transition-colors"
            >
              Sign up for free
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              onClick={() => setMode("login")}
              className="text-gray-200 hover:text-purple-400 font-medium transition-colors"
            >
              Sign in
            </button>
          </>
        )}
      </p>

      <p className="text-center text-[11px] text-gray-600 mt-4">
        By continuing, you agree to our{" "}
        <span className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
          Terms
        </span>{" "}
        and{" "}
        <span className="text-gray-500 hover:text-gray-300 cursor-pointer transition-colors">
          Privacy Policy
        </span>
        .
      </p>
    </AuthFormLayout>
  );
}
