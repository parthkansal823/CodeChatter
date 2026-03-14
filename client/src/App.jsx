import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import CodeRoom from "./pages/CodeRoom";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Code Editor Page */}
        <Route path="/room" element={<CodeRoom />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;