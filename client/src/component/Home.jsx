import React, { useState, useContext } from "react";
import { v4 as uuid } from "uuid";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import "./Home.css";
import { AuthContext } from "../context/AuthContext";

function Home() {
  const [roomId, setRoomId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const navigate = useNavigate();

  const { user, login, register, logout } = useContext(AuthContext);

  const generateRoomId = (e) => {
    e.preventDefault();
    const Id = uuid();
    setRoomId(Id);
    toast.success("✅ New Room ID generated!");
  };

  const joinRoom = () => {
    if (!roomId.trim()) {
      toast.error("⚠️ Please enter Room ID!");
      return;
    }
    const username = user?.name || user?.email?.split("@")[0] || "Guest";
    navigate(`/editor/${roomId}`, { state: { username } });
    toast.success(`🚀 Welcome, ${username}!`);
  };

  const handleInputEnter = (e) => {
    if (e.key === "Enter") joinRoom();
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await register(email.split("@")[0], email, password);
        toast.success("🎉 Account created successfully!");
      } else {
        await login(email, password);
        toast.success("✅ Logged in successfully!");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Authentication failed");
    }
  };

  const googleAuth = () => {
    window.location.href = "http://localhost:5000/api/auth/google";
  };

  return (
    <div className="home-wrapper">
      {/* === LEFT HERO SECTION === */}
      <div className="home-left">
        <div className="branding">
          <div className="logo-box">
            <img
              src="/images/codechatter.png"
              alt="CodeChatter"
              className="logo"
            />
          </div>
          <h1 className="title">
            Code<span>Chatter</span>
          </h1>
          <p className="tagline">Collaborate. Code. Converse. Create.</p>
        </div>
      </div>

      {/* === RIGHT AUTH + ROOM SECTION === */}
      <div className="home-right">
        <div className="form-box">
          {!user ? (
            <>
              <h2>{isRegister ? "Create Account" : "Sign In"}</h2>
              <form onSubmit={handleAuth}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  required
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                />
                <button type="submit" className="join-btn">
                  {isRegister ? "Register" : "Login"}
                </button>
              </form>
              <button onClick={googleAuth} className="join-btn google-btn">
                Continue with Google
              </button>
              <p className="create-text">
                {isRegister ? "Already have an account?" : "New user?"}{" "}
                <span
                  onClick={() => setIsRegister(!isRegister)}
                  className="create-link"
                >
                  {isRegister ? "Sign In" : "Create one"}
                </span>
              </p>
            </>
          ) : (
            <>
              <div className="welcome-box">
                <h2>Welcome, {user.name || user.email} 👋</h2>
                <button onClick={logout} className="logout-btn">
                  Logout
                </button>
              </div>

              <h3>Join or Create a Room</h3>
              <div className="input-group">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="Enter Room ID"
                  onKeyUp={handleInputEnter}
                />
              </div>

              <button className="join-btn" onClick={joinRoom}>
                Join Room
              </button>

              <p className="create-text">
                Don’t have a Room ID?{" "}
                <span onClick={generateRoomId} className="create-link">
                  Generate One
                </span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default Home;
