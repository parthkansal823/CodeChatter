import React, { createContext, useState, useEffect } from "react";
import api from "../api";

export const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const refresh = async () => {
      try {
        const { data } = await api.post("/auth/refresh");
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    refresh();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data.user);
    setAccessToken(data.accessToken);
  };

  const register = async (name, email, password) => {
    const { data } = await api.post("/auth/register", { name, email, password });
    setUser(data.user);
    setAccessToken(data.accessToken);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
    setAccessToken(null);
  };

  const authHeader = () => ({
    headers: { Authorization: `Bearer ${accessToken}` },
  });

return (
  <AuthContext.Provider
    value={{
      user,
      setUser,
      accessToken,
      setAccessToken,
      loading,
      login,
      register,
      logout,
      authHeader,
    }}
  >
    {children}
  </AuthContext.Provider>
);

}
