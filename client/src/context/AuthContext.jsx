import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState(null);

  // Initialize auth state from localStorage
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const storedToken = localStorage.getItem("authToken");
        const storedUser = localStorage.getItem("user");

        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Auth initialization failed:", error);
        localStorage.removeItem("authToken");
        localStorage.removeItem("user");
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (emailOrUsername, password) => {
    setIsLoading(true);
    try {
      // Try backend first
      try {
        const response = await fetch("http://localhost:8000/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailOrUsername, password })
        });

        if (response.ok) {
          const data = await response.json();
          const { token: newToken, user: userData } = data;

          localStorage.setItem("authToken", newToken);
          localStorage.setItem("user", JSON.stringify(userData));
          setToken(newToken);
          setUser(userData);
          setIsAuthenticated(true);

          return { success: true, user: userData };
        }
      } catch (backendError) {
        console.warn("Backend login failed, using mock auth:", backendError.message);
      }

      // Mock auth fallback - use any email/password
      const mockUser = {
        id: Math.random(),
        email: emailOrUsername,
        username: emailOrUsername.split("@")[0] || emailOrUsername
      };
      const mockToken = "mock_token_" + Date.now();

      localStorage.setItem("authToken", mockToken);
      localStorage.setItem("user", JSON.stringify(mockUser));
      setToken(mockToken);
      setUser(mockUser);
      setIsAuthenticated(true);

      return { success: true, user: mockUser };
    } catch (error) {
      console.error("Login error:", error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email, username, password) => {
    setIsLoading(true);
    try {
      // Try backend first
      try {
        const response = await fetch("http://localhost:8000/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, username, password })
        });

        if (response.ok) {
          const data = await response.json();
          const { token: newToken, user: userData } = data;

          localStorage.setItem("authToken", newToken);
          localStorage.setItem("user", JSON.stringify(userData));
          setToken(newToken);
          setUser(userData);
          setIsAuthenticated(true);

          return { success: true, user: userData };
        }
      } catch (backendError) {
        console.warn("Backend signup failed, using mock auth:", backendError.message);
      }

      // Mock signup fallback
      const mockUser = {
        id: Math.random(),
        email,
        username
      };
      const mockToken = "mock_token_" + Date.now();

      localStorage.setItem("authToken", mockToken);
      localStorage.setItem("user", JSON.stringify(mockUser));
      setToken(mockToken);
      setUser(mockUser);
      setIsAuthenticated(true);

      return { success: true, user: mockUser };
    } catch (error) {
      console.error("Signup error:", error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await fetch("http://localhost:8000/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      localStorage.removeItem("authToken");
      setToken(null);
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const value = {
    user,
    isAuthenticated,
    isLoading,
    token,
    login,
    signup,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
