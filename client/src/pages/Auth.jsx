import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Github, Mail, Lock, User, ArrowLeft, RotateCcw, ShieldCheck } from "lucide-react";
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

const RESEND_COOLDOWN = 30; // seconds

function OtpInput({ value, onChange }) {
  const inputs = useRef([]);

  const handleChange = (index, e) => {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    const next = value.split("");
    next[index] = digit;
    const updated = next.join("");
    onChange(updated);
    if (digit && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (value[index]) {
        const next = value.split("");
        next[index] = "";
        onChange(next.join(""));
      } else if (index > 0) {
        inputs.current[index - 1]?.focus();
        const next = value.split("");
        next[index - 1] = "";
        onChange(next.join(""));
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted.padEnd(6, "").slice(0, 6));
    const focusIdx = Math.min(pasted.length, 5);
    inputs.current[focusIdx]?.focus();
  };

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (inputs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-11 h-13 text-center text-xl font-bold rounded-lg bg-white/[0.05] border border-white/10 text-white focus:outline-none focus:border-purple-500 focus:bg-white/[0.08] transition-all duration-150 caret-transparent"
          style={{ height: "3.25rem" }}
          autoComplete="one-time-code"
        />
      ))}
    </div>
  );
}

export default function Auth() {
  const [mode, setMode] = useState("login");
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");

  // MFA step state
  const [step, setStep] = useState("credentials"); // "credentials" | "otp"
  const [mfaToken, setMfaToken] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const navigate = useNavigate();
  const { login, signup, verifyOtp, resendOtp } = useAuth();

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startResendCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const enterMfaStep = ({ mfa_token, masked_email }) => {
    setMfaToken(mfa_token);
    setMaskedEmail(masked_email);
    setOtp("");
    setStep("otp");
    startResendCooldown();
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(loginEmail, loginPassword);
      if (!result.success) {
        toast.error(result.error || "Login failed");
      } else if (result.requires_mfa) {
        enterMfaStep(result);
      } else {
        toast.success("Logged in successfully!");
        navigate("/home");
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
      if (!result.success) {
        toast.error(result.error || "Signup failed");
      } else if (result.requires_mfa) {
        enterMfaStep(result);
      } else {
        toast.success("Welcome to CodeChatter!");
        navigate("/home");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.replace(/\D/g, "").length < 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(mfaToken, otp.replace(/\D/g, ""));
      if (result.success) {
        toast.success(mode === "login" ? "Logged in successfully!" : "Welcome to CodeChatter!");
        navigate("/home");
      } else {
        toast.error(result.error || "Incorrect code");
        if (result.error?.includes("sign in again") || result.error?.includes("expired")) {
          setStep("credentials");
          setOtp("");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const result = await resendOtp(mfaToken);
    if (result.success) {
      toast.success("New code sent!");
      startResendCooldown();
    } else {
      toast.error(result.error || "Could not resend code");
    }
  };

  const handleBackToCredentials = () => {
    setStep("credentials");
    setOtp("");
    setMfaToken("");
    setMaskedEmail("");
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(0);
  };

  const startOAuth = (url) => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `${url}?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  if (step === "otp") {
    return (
      <AuthFormLayout>
        <div className="lg:hidden mb-8">
          <BrandLogo size="md" />
        </div>

        <Motion.div
          key="otp-step"
          initial={{ opacity: 0, x: 16, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.32, ease: "easeOut" } }}
          className="w-full"
        >
          {/* Back button */}
          <button
            onClick={handleBackToCredentials}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-8"
          >
            <ArrowLeft size={15} />
            Back
          </button>

          {/* Icon + heading */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
              <ShieldCheck size={26} className="text-purple-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Check your email</h1>
            <p className="text-[13px] text-gray-400 mt-1.5 max-w-xs leading-relaxed">
              We sent a 6-digit code to{" "}
              <span className="text-gray-200 font-medium">{maskedEmail}</span>
            </p>
          </div>

          {/* OTP form */}
          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <OtpInput value={otp} onChange={setOtp} />

            <Motion.button
              whileHover={{ scale: 1.015, y: -1 }}
              whileTap={{ scale: 0.985 }}
              type="submit"
              disabled={loading || otp.replace(/\D/g, "").length < 6}
              className="w-full py-2.5 rounded-lg font-semibold text-sm text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all duration-200 shadow-[0_0_20px_rgba(124,58,237,0.2)] hover:shadow-[0_0_28px_rgba(124,58,237,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Verifying…" : "Verify code"}
            </Motion.button>
          </form>

          {/* Resend */}
          <div className="flex items-center justify-center gap-1.5 mt-6 text-[12.5px] text-gray-500">
            <span>Didn't receive it?</span>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendCooldown > 0}
              className="flex items-center gap-1 text-gray-300 hover:text-purple-400 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors font-medium"
            >
              <RotateCcw size={11} />
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>

          <p className="text-center text-[11px] text-gray-600 mt-5">
            Code expires in 5 minutes
          </p>
        </Motion.div>
      </AuthFormLayout>
    );
  }

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
