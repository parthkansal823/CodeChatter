import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import toast from "react-hot-toast";
import FloatingInput from "../components/FloatingInput";
import PasswordInput from "../components/PasswordInput";
import AuthFormLayout from "../components/AuthFormLayout";
import { useAuth } from "../context/AuthContext";

export default function Auth() {
  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [cardGlow, setCardGlow] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup fields
  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const navigate = useNavigate();
  const { login, signup } = useAuth();

  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const result = await login(loginEmail, loginPassword);

    if (result.success) {
      toast.success("Logged in successfully!");
      navigate("/home");
    } else {
      toast.error(result.error || "Login failed");
    }

    setLoading(false);
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();

    if (signupPassword !== signupConfirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    const result = await signup(signupEmail, signupUsername, signupPassword);

    if (result.success) {
      toast.success("Account created! Welcome to CodeChatter!");
      navigate("/home");
    } else {
      toast.error(result.error || "Signup failed");
    }

    setLoading(false);
  };

  const handleGithubLogin = () => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `http://localhost:8000/auth/github?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  const handleGoogleLogin = () => {
    const redirectUri = `${window.location.origin}/auth/callback`;
    window.location.href = `http://localhost:8000/auth/google?redirect_uri=${encodeURIComponent(redirectUri)}`;
  };

  return (
    <AuthFormLayout
      title={mode === "login" ? "Welcome Back" : "Create Account"}
      subtitle={mode === "login" ? "Login to continue coding." : "Join CodeChatter today."}
      onMouseMove={handleMouseMove}
      isSignup={mode === "signup"}
    >
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
        {/* Tab Switcher */}
        <div className="flex gap-2 mb-6 border-b border-white/10">
          <button
            onClick={() => setMode("login")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "login"
                ? "text-purple-400 border-b-2 border-purple-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setMode("signup")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === "signup"
                ? "text-purple-400 border-b-2 border-purple-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Sign Up
          </button>
        </div>

        {mode === "login" ? (
          <>
            <h2 className="text-3xl font-semibold mb-2">Welcome Back</h2>
            <p className="text-gray-400 text-sm mb-8">Login to continue coding.</p>

            <form onSubmit={handleLoginSubmit} className="space-y-6">
              <FloatingInput
                id="login-email"
                label="Email or Username"
                type="text"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
              />

              <PasswordInput
                id="login-password"
                label="Password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />

              <div className="flex justify-between text-sm text-gray-400">
                <label className="flex gap-2 items-center hover:text-white cursor-pointer">
                  <input type="checkbox" className="accent-purple-500" />
                  Remember me
                </label>
                <span className="hover:text-purple-400 cursor-pointer">
                  Forgot password?
                </span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium
                bg-gradient-to-r from-purple-500 to-blue-500
                hover:scale-105 active:scale-95 transition duration-200 shadow-lg shadow-purple-500/20
                disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Logging in..." : "Login"}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="text-3xl font-semibold mb-2">Create Account</h2>
            <p className="text-gray-400 text-sm mb-8">Join CodeChatter today.</p>

            <form onSubmit={handleSignupSubmit} className="space-y-6">
              <FloatingInput
                id="signup-email"
                label="Email"
                type="email"
                required
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
              />

              <FloatingInput
                id="signup-username"
                label="Username"
                type="text"
                required
                value={signupUsername}
                onChange={(e) => setSignupUsername(e.target.value)}
              />

              <PasswordInput
                id="signup-password"
                label="Password"
                required
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
              />

              <PasswordInput
                id="signup-confirm-password"
                label="Confirm Password"
                required
                value={signupConfirmPassword}
                onChange={(e) => setSignupConfirmPassword(e.target.value)}
              />

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg font-medium
                bg-gradient-to-r from-purple-500 to-blue-500
                hover:scale-105 active:scale-95 transition duration-200 shadow-lg shadow-purple-500/20
                disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : "Create Account"}
              </button>
            </form>
          </>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-gray-700" />
          <span className="text-gray-500 text-sm">OR</span>
          <div className="flex-1 h-px bg-gray-700" />
        </div>

        {/* OAuth Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleGithubLogin}
            className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
          >
            <Github size={18} />
            GitHub
          </button>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="flex items-center justify-center gap-2 py-3 border border-gray-700 rounded-lg hover:bg-white/5 transition"
          >
            <FcGoogle size={18} />
            Google
          </button>
        </div>

        <p className="text-center text-sm text-gray-400 mt-6">
          {mode === "login" ? (
            <>
              Don't have an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-purple-400 hover:underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-purple-400 hover:underline"
              >
                Login
              </button>
            </>
          )}
        </p>
      </motion.div>
    </AuthFormLayout>
  );
}
