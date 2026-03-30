import { lazy, Suspense } from "react";
import { Toaster } from "react-hot-toast";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { NotificationsProvider } from "./context/NotificationsContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CommandPalette from "./components/CommandPalette";
import OnboardingModal from "./components/OnboardingModal";
import { useAuth } from "./hooks/useAuth";
import { usePreferences } from "./hooks/usePreferences";

const Layout   = lazy(() => import("./pages/Layout"));
const Auth     = lazy(() => import("./pages/Auth"));
const OAuthCallback = lazy(() => import("./pages/OAuthCallback"));
const CodeRoom = lazy(() => import("./pages/CodeRoom"));
const Home     = lazy(() => import("./pages/Home"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile  = lazy(() => import("./pages/Profile"));

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

function AppContent() {
  const { preferences, updatePreference } = usePreferences();
  const theme = preferences.theme;
  const onThemeChange = (newTheme) => updatePreference("theme", newTheme);

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: "#18181b", color: "#fff", border: "1px solid #27272a" }
        }}
      />
      <OnboardingModal />
      <Suspense fallback={<RouteFallback />}>
        <CommandPalette theme={theme} onThemeChange={onThemeChange} />
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
                <Layout theme={theme} onThemeChange={onThemeChange}>
                  <Home />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout theme={theme} onThemeChange={onThemeChange}>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Layout theme={theme} onThemeChange={onThemeChange}>
                  <Profile />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/room"
            element={
              <ProtectedRoute>
                <CodeRoom theme={theme} onThemeChange={onThemeChange} />
              </ProtectedRoute>
            }
          />

          <Route
            path="/room/:roomId"
            element={
              <ProtectedRoute>
                <CodeRoom theme={theme} onThemeChange={onThemeChange} />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PreferencesProvider>
          <NotificationsProvider>
            <AppContent />
          </NotificationsProvider>
        </PreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
