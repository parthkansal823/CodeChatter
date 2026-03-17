import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";

import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./pages/Layout";
import Auth from "./pages/Auth";
import OAuthCallback from "./pages/OAuthCallback";
import CodeRoom from "./pages/CodeRoom";
import Home from "./pages/Home";

function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "vs-dark";
  });

  useEffect(() => {
    if (theme === "vs-dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Toast notifications */}
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: "#18181b",
              color: "#fff",
              border: "1px solid #27272a"
            }
          }}
        />

        <Routes>
          {/* Auth Routes - No Layout/Navbar */}
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/callback" element={<OAuthCallback />} />
          <Route path="/login" element={<Navigate to="/auth" replace />} />
          <Route path="/signup" element={<Navigate to="/auth" replace />} />
          <Route path="/" element={<Navigate to="/auth" replace />} />

          {/* Home Dashboard - With Layout/Navbar */}
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <Layout theme={theme} onThemeChange={setTheme}>
                  <Home />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Code Rooms - With Navbar but custom layout */}
          <Route
            path="/room"
            element={
              <ProtectedRoute>
                <CodeRoom theme={theme} onThemeChange={setTheme} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/room/:roomId"
            element={
              <ProtectedRoute>
                <CodeRoom theme={theme} onThemeChange={setTheme} />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;