import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import toast from "react-hot-toast";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { oauthLogin } = useAuth();
  const hasCalledRef = useRef(false);

  useEffect(() => {
    // Prevent double calls in development mode (React StrictMode)
    if (hasCalledRef.current) return;
    hasCalledRef.current = true;

    const handleCallback = async () => {
      try {
        // Get token and user data from URL params (backend redirects with these)
        const token = searchParams.get("token");
        const username = searchParams.get("user");
        const email = searchParams.get("email");
        const id = searchParams.get("id");
        const error = searchParams.get("error");

        if (error) {
          toast.error(`OAuth Error: ${error}`);
          navigate("/auth");
          return;
        }

        if (!token || !username) {
          toast.error("Invalid OAuth response");
          navigate("/auth");
          return;
        }

        // Create user object
        const userData = {
          id,
          email,
          username
        };

        // Use OAuth login method from AuthContext
        const result = await oauthLogin(token, userData);

        if (result.success) {
          toast.success("Logged in successfully!");
          // Navigate to home with replace to prevent back button
          navigate("/home", { replace: true });
        } else {
          toast.error(result.error || "Login failed");
          navigate("/auth");
        }
      } catch (error) {
        console.error("OAuth callback error:", error);
        toast.error("Login failed. Please try again.");
        navigate("/auth");
      }
    };

    handleCallback();
  }, [searchParams, navigate, oauthLogin]);

  return (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-white text-lg">Processing login...</p>
      </div>
    </div>
  );
}

