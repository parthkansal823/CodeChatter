import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

// ── Animation config ───────────────────────────────────────────────────────────
const EASE_EXPO  = [0.22, 1, 0.36, 1];
const SPRING     = { type: "spring", stiffness: 380, damping: 28 };
const SPRING_POP = { type: "spring", stiffness: 480, damping: 22 };

const slideVariant = {
  hidden: (dir) => ({
    opacity: 0,
    x: dir * 22,
    scale: 0.97,
  }),
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 340,
      damping: 26,
      opacity: { duration: 0.22 },
      filter: { duration: 0.2 },
    },
  },
  exit: (dir) => ({
    opacity: 0,
    x: dir * -18,
    scale: 0.97,
    transition: { duration: 0.18, ease: "easeIn" },
  }),
};

const RESEND_COOLDOWN = 30;

// ── OTP Input ─────────────────────────────────────────────────────────────────
function OtpInput({ value, onChange }) {
  const inputs = useRef([]);

  const handleChange = (index, e) => {
    const digit = e.target.value.replace(/\D/g, "").slice(-1);
    const next = value.split("");
    next[index] = digit;
    const updated = next.join("");
    onChange(updated);
    if (digit && index < 5) inputs.current[index + 1]?.focus();
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
    inputs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.55, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ ...SPRING_POP, delay: 0.08 + i * 0.07 }}
        >
          <input
            ref={(el) => (inputs.current[i] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={value[i] || ""}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="h-12 w-10 rounded-md border border-edge bg-field text-center text-lg font-bold text-fg caret-transparent transition-all duration-150 focus:scale-105 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none sm:h-[3.25rem] sm:w-11 sm:text-xl"
            autoComplete="one-time-code"
          />
        </Motion.div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Auth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode]               = useState(
    () => (searchParams.get("mode") === "signup" ? "signup" : "login")
  );
  const [loading, setLoading]         = useState(false);
  const [loginEmail, setLoginEmail]   = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirm, setSignupConfirm]   = useState("");
  const [step, setStep]               = useState("credentials");
  const [mfaToken, setMfaToken]       = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp]                 = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const navigate = useNavigate();
  const { login, signup, verifyOtp, resendOtp } = useAuth();

  useEffect(() => {
    const requestedMode = searchParams.get("mode") === "signup" ? "signup" : "login";
    setMode((currentMode) => (currentMode === requestedMode ? currentMode : requestedMode));
  }, [searchParams]);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const changeMode = (nextMode) => {
    setMode(nextMode);
    const nextSearchParams = new URLSearchParams(searchParams);

    if (nextMode === "signup") {
      nextSearchParams.set("mode", "signup");
    } else {
      nextSearchParams.delete("mode");
    }

    setSearchParams(nextSearchParams, { replace: true });
  };

  const startResendCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
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
      if (!result.success)       toast.error(result.error || "Login failed");
      else if (result.requires_mfa) enterMfaStep(result);
      else { toast.success("Logged in!"); navigate("/home"); }
    } finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (signupPassword !== signupConfirm) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    try {
      const result = await signup(signupEmail, signupUsername, signupPassword);
      if (!result.success)       toast.error(result.error || "Signup failed");
      else if (result.requires_mfa) enterMfaStep(result);
      else { toast.success("Welcome to CodeChatter!"); navigate("/home"); }
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.replace(/\D/g, "").length < 6) { toast.error("Enter the 6-digit code"); return; }
    setLoading(true);
    try {
      const result = await verifyOtp(mfaToken, otp.replace(/\D/g, ""));
      if (result.success) {
        toast.success(mode === "login" ? "Logged in!" : "Welcome to CodeChatter!");
        navigate("/home");
      } else {
        toast.error(result.error || "Incorrect code");
        if (result.error?.includes("sign in again") || result.error?.includes("expired")) {
          setStep("credentials"); setOtp("");
        }
      }
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    const result = await resendOtp(mfaToken);
    if (result.success) { toast.success("New code sent!"); startResendCooldown(); }
    else toast.error(result.error || "Could not resend code");
  };

  const handleBackToCredentials = () => {
    setStep("credentials"); setOtp(""); setMfaToken(""); setMaskedEmail("");
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(0);
  };

  const startOAuth = (url) => {
    window.location.href = `${url}?redirect_uri=${encodeURIComponent(`${window.location.origin}/auth/callback`)}`;
  };

  // ── OTP step ────────────────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <AuthFormLayout>
        <div className="lg:hidden mb-8">
          <BrandLogo size="md" />
        </div>

        <AnimatePresence mode="wait">
          <Motion.div
            key="otp-step"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE_EXPO }}
            className="w-full"
          >
            {/* Back */}
            <Motion.button
              onClick={handleBackToCredentials}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.2, ease: EASE_EXPO }}
              whileHover={{ x: -3 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors mb-8"
            >
              <ArrowLeft size={15} />
              Back
            </Motion.button>

            {/* Icon + heading */}
            <div className="flex flex-col items-center text-center mb-8">
              <Motion.div
                initial={{ scale: 0, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ ...SPRING_POP, delay: 0.12 }}
                className="w-14 h-14 rounded-md bg-accent-subtle border border-edge-subtle flex items-center justify-center mb-4"
              >
                <ShieldCheck size={26} className="text-accent" />
              </Motion.div>

              <Motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.2, ease: EASE_EXPO }}
                className="text-2xl font-bold tracking-tight text-fg"
              >
                Check your email
              </Motion.h1>
              <Motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.27, duration: 0.2, ease: EASE_EXPO }}
                className="text-[13px] text-fg-muted mt-1.5 max-w-xs leading-relaxed"
              >
                We sent a 6-digit code to{" "}
                <span className="text-fg font-medium">{maskedEmail}</span>
              </Motion.p>
            </div>

            {/* OTP form */}
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <OtpInput value={otp} onChange={setOtp} />

              <Motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.52, duration: 0.2, ease: EASE_EXPO }}
                
                whileTap={{ scale: 0.97 }}
                type="submit"
                disabled={loading || otp.replace(/\D/g, "").length < 6}
                className="w-full py-2.5 rounded-md font-semibold text-sm text-fg-accent bg-accent hover:bg-accent-hover transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Verifying…
                  </span>
                ) : "Verify code"}
              </Motion.button>
            </form>

            {/* Resend */}
            <Motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.2 }}
              className="flex items-center justify-center gap-1.5 mt-6 text-[12.5px] text-fg-muted"
            >
              <span>Didn't receive it?</span>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="flex items-center gap-1 text-fg hover:text-accent disabled:text-fg-subtle disabled:cursor-not-allowed transition-colors font-medium"
              >
                <RotateCcw size={11} />
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </Motion.div>

            <Motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65, duration: 0.2 }}
              className="text-center text-[11px] text-fg-subtle mt-5"
            >
              Code expires in 5 minutes
            </Motion.p>
          </Motion.div>
        </AnimatePresence>
      </AuthFormLayout>
    );
  }

  // ── Credentials step ────────────────────────────────────────────────────────
  return (
    <AuthFormLayout>
      <div className="lg:hidden mb-8">
        <BrandLogo size="md" />
      </div>

      {/* Tab switcher */}
      <div className="flex gap-6 mb-8 border-b border-edge-subtle">
        {[
          { key: "login",  label: "Sign in" },
          { key: "signup", label: "Create account" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => changeMode(key)}
            className={`pb-3 text-sm font-semibold transition-colors duration-200 relative ${
              mode === key ? "text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            {label}
            {mode === key && (
              <Motion.span
                layoutId="tab-indicator"
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-full"
              />
            )}
          </button>
        ))}
      </div>

      {/* Heading */}
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
          <h1 className="text-2xl font-bold tracking-tight text-fg">
            {mode === "login" ? "Welcome back" : "Get started free"}
          </h1>
          <p className="text-[13px] text-fg-muted mt-1.5">
            {mode === "login"
              ? "Sign in to your CodeChatter workspace"
              : "Create your account — no credit card required"}
          </p>
        </Motion.div>
      </AnimatePresence>

      {/* OAuth buttons */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { icon: Github,   label: "GitHub", color: "text-fg", action: () => startOAuth(API_ENDPOINTS.GITHUB_LOGIN) },
          { icon: FcGoogle, label: "Google", color: "",              action: () => startOAuth(API_ENDPOINTS.GOOGLE_LOGIN) },
        ].map(({ icon: Icon, label, action }, i) => (
          <Motion.button
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.06, duration: 0.2, ease: EASE_EXPO }}
            
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={action}
            className="flex items-center justify-center gap-2.5 py-2.5 rounded-md bg-panel border border-edge hover:bg-hovered hover:border-edge-strong transition-colors duration-200"
          >
            <Icon size={16} className={label === "GitHub" ? "text-fg" : ""} />
            <span className="text-sm font-medium text-fg">
              {label}
            </span>
          </Motion.button>
        ))}
      </div>

      {/* Divider */}
      <Motion.div
        initial={{ opacity: 0, scaleX: 0.6 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 0.18, duration: 0.2, ease: EASE_EXPO }}
        className="relative mb-6"
      >
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-edge-subtle" />
        </div>
        <div className="relative flex justify-center">
          <span className="px-3 bg-canvas text-[11px] text-fg-muted uppercase tracking-wider">
            or with email
          </span>
        </div>
      </Motion.div>

      {/* Forms */}
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
                <label className="flex items-center gap-2 text-[12.5px] text-fg-muted cursor-pointer hover:text-fg transition-colors select-none">
                  <input type="checkbox" className="w-3.5 h-3.5 rounded accent-brand-500" />
                  Remember me
                </label>
                <button type="button" className="text-[12.5px] text-fg-muted hover:text-accent transition-colors">
                  Forgot password?
                </button>
              </div>
            </div>

            <Motion.button
              
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-md font-semibold text-sm text-fg-accent bg-accent hover:bg-accent-hover transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Signing in…
                </span>
              ) : "Sign in to workspace"}
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
            <FloatingInput id="signup-email" label="Email address" type="email" required
              value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} icon={Mail} />
            <FloatingInput id="signup-username" label="Username" type="text" required
              value={signupUsername} onChange={(e) => setSignupUsername(e.target.value)}
              icon={User} placeholder="e.g. johndoe" />
            <PasswordInput id="signup-password" label="Password" required
              value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} icon={Lock} />
            <PasswordInput id="signup-confirm" label="Confirm password" required
              value={signupConfirm} onChange={(e) => setSignupConfirm(e.target.value)} icon={Lock} />

            <Motion.button
              
              whileTap={{ scale: 0.97 }}
              transition={SPRING}
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 rounded-md font-semibold text-sm text-fg-accent bg-accent hover:bg-accent-hover transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Creating account…
                </span>
              ) : "Create free account"}
            </Motion.button>
          </Motion.form>
        )}
      </AnimatePresence>

      {/* Footer */}
      <Motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.2 }}
        className="text-center text-[12.5px] text-fg-muted mt-7"
      >
        {mode === "login" ? (
          <>
            No account?{" "}
            <button onClick={() => changeMode("signup")} className="text-fg hover:text-accent font-medium transition-colors">
              Sign up for free
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button onClick={() => changeMode("login")} className="text-fg hover:text-accent font-medium transition-colors">
              Sign in
            </button>
          </>
        )}
      </Motion.p>

      <Motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.2 }}
        className="text-center text-[11px] text-fg-subtle mt-4"
      >
        By continuing, you agree to our{" "}
        <span className="text-fg-muted hover:text-fg cursor-pointer transition-colors">Terms</span>{" "}
        and{" "}
        <span className="text-fg-muted hover:text-fg cursor-pointer transition-colors">Privacy Policy</span>.
      </Motion.p>
    </AuthFormLayout>
  );
}
