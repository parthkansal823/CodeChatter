import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import CodeRoom from "./pages/CodeRoom";
import Home from "./pages/Home"; // NEW

function App() {
  return (
    <BrowserRouter>

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

        {/* Auth */}
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Home Dashboard */}
        <Route path="/home" element={<Home />} />

        {/* Code Rooms */}
        <Route path="/room" element={<CodeRoom />} />
        <Route path="/room/:roomId" element={<CodeRoom />} />

      </Routes>

    </BrowserRouter>
  );
}

export default App;