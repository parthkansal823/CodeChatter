import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
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

        // Store token and user data in localStorage
        const user = { id, email, username };
        localStorage.setItem("authToken", token);
        localStorage.setItem("user", JSON.stringify(user));

        toast.success("Logged in successfully!");
        navigate("/home");
      } catch (error) {
        console.error("OAuth callback error:", error);
        toast.error("Login failed. Please try again.");
        navigate("/auth");
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
        <p className="text-white text-lg">Processing login...</p>
      </div>
    </div>
  );
}

