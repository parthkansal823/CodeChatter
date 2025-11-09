import React, { useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";

export default function OAuthSuccess() {
  const { setUser, setAccessToken } = useContext(AuthContext);
  const nav = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("accessToken");
      if (token) {
        // Save token in context
        setAccessToken(token);

        // Decode token to extract user email/id
        const [, payload] = token.split(".");
        const decoded = JSON.parse(atob(payload));
        const user = {
          id: decoded.id,
          email: decoded.email,
          name: decoded.email?.split("@")[0] || "User",
        };
        setUser(user);

        // Redirect back to home
        nav("/");
      }
    }
  }, [setUser, setAccessToken, nav]);

  return (
    <div style={{ color: "#fff", textAlign: "center", marginTop: "3rem" }}>
      <h2>Signing you in with Google...</h2>
    </div>
  );
}
