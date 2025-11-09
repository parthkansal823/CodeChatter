import "./App.css";
import { Routes, Route } from "react-router-dom";
import Home from "./component/Home";
import EditorPage from "./component/EditorPage";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./component/ProtectedRoute";
import OAuthSuccess from "./pages/OAuthSuccess";

function App() {
  return (
    <AuthProvider>
      <div>
        <Toaster position="top-center" />
      </div>

      <Routes>
        {/* Home page now handles login/signup internally */}
        <Route path="/" element={<Home />} />

        {/* Google OAuth success handler */}
        <Route path="/oauth-success" element={<OAuthSuccess />} />

        {/* Protect the editor route so only logged-in users can access */}
        <Route
          path="/editor/:roomId"
          element={
            <ProtectedRoute>
              <EditorPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
