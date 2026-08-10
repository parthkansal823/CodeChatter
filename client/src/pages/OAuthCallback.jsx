import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import toast from "react-hot-toast";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { oauthLogin, refreshUser } = useAuth();
  const hasCalledRef = useRef(false);

  useEffect(() => {
    if (hasCalledRef.current) return;
    hasCalledRef.current = true;

    const handleCallback = async () => {
      // The backend returns the sign-in credentials in the URL fragment so the
      // token never reaches a server log or Referer header. Query params are
      // still read as a fallback for the GitHub-connect redirect.
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const readParam = (key) => hashParams.get(key) ?? searchParams.get(key);

      // Drop the credentials from the address bar as soon as they are read.
      const clearHash = () => {
        if (window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      };

      try {
        const error = readParam("error");
        if (error) {
          clearHash();
          toast.error(`OAuth Error: ${error}`);
          navigate("/auth");
          return;
        }

        // ── GitHub connect flow (linking to existing account) ─────────
        const githubLinked = readParam("github_linked");
        if (githubLinked === "1") {
          const githubUsername = readParam("githubUsername") || "";
          clearHash();
          await refreshUser();
          toast.success(`GitHub connected${githubUsername ? ` as @${githubUsername}` : ""}!`);
          navigate("/settings", { replace: true });
          return;
        }

        // ── Normal OAuth sign-in ───────────────────────────────────────
        const token = readParam("token");
        const username = readParam("user");
        const email = readParam("email");
        const id = readParam("id");
        const githubConnected = readParam("githubConnected") === "1";
        const githubUsername = readParam("githubUsername") || null;

        clearHash();

        if (!token || !username) {
          toast.error("Invalid OAuth response");
          navigate("/auth");
          return;
        }

        const userData = { id, email, username, githubConnected, githubUsername };
        const result = await oauthLogin(token, userData);

        if (result.success) {
          toast.success("Logged in successfully!");
          navigate("/home", { replace: true });
        } else {
          toast.error(result.error || "Login failed");
          navigate("/auth");
        }
      } catch (error) {
        clearHash();
        console.error("OAuth callback error:", error);
        toast.error("Login failed. Please try again.");
        navigate("/auth");
      }
    };

    handleCallback();
  }, [searchParams, navigate, oauthLogin, refreshUser]);

  return (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-white text-lg">Processing login...</p>
      </div>
    </div>
  );
}
