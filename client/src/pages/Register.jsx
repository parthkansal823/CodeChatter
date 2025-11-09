import React, { useState, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const { register } = useContext(AuthContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const nav = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await register(name, email, password);
      nav("/");
    } catch (err) {
      alert(err?.response?.data?.message || "Registration failed");
    }
  };

  const googleRegister = () => {
    window.location.href = "http://localhost:5000/api/auth/google";
  };

  return (
    <div style={{ margin: "2rem" }}>
      <h2>Register for CodeChatter</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ display: "block", margin: "8px 0" }}
        />
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ display: "block", margin: "8px 0" }}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: "block", margin: "8px 0" }}
        />
        <button type="submit">Register</button>
      </form>
      <button onClick={googleRegister}>Continue with Google</button>
    </div>
  );
}
