import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CommandPalette from "./components/CommandPalette";
import { useAuth } from "./hooks/useAuth";

const Layout = lazy(() => import("./pages/Layout"));
const Auth = lazy(() => import("./pages/Auth"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const CodeRoom = lazy(() => import("./pages/CodeRoom"));
const Home = lazy(() => import("./pages/Home"));
const Settings = lazy(() => import("./pages/Settings"));

function RouteFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-black text-white">
      <p className="text-sm tracking-wide text-zinc-400">Loading page...</p>
    </div>
  );
}

function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <RouteFallback />;
  }

  return <Navigate to={isAuthenticated ? "/home" : "/auth"} replace />;
}

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
        <PreferencesProvider>
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

        <Suspense fallback={<RouteFallback />}>
          <CommandPalette theme={theme} onThemeChange={setTheme} />
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/auth/callback" element={<OAuthCallback />} />
            <Route path="/login" element={<Navigate to="/auth" replace />} />
            <Route path="/signup" element={<Navigate to="/auth" replace />} />
            <Route path="/" element={<RootRedirect />} />

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

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout theme={theme} onThemeChange={setTheme}>
                    <Settings />
                  </Layout>
                </ProtectedRoute>
              }
            />

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

            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </Suspense>
        </PreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
