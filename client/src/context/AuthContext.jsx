import { createContext, useContext, useState, useEffect } from "react";
import {
  getSecureToken,
  setSecureToken,
  clearSecureData,
  isTokenExpired,
  validateEmail,
  validatePassword,
  validateUsername,
  sanitizeInput,
  secureFetch,
  RateLimiter,
  setupCSP,
} from "../utils/security";
import {
  decodeJWT,
  extractUserFromJWT,
  validateJWTBeforeUse,
  logJWTInfo,
  storeJWT,
  getValidJWT,
  clearJWT,
} from "../utils/jwt";

const AuthContext = createContext();

// Initialize rate limiters for login/signup attempts
const loginLimiter = new RateLimiter(5, 15 * 60 * 1000); // 5 attempts per 15 minutes
const signupLimiter = new RateLimiter(3, 60 * 60 * 1000); // 3 attempts per hour

// Setup CSP on app initialization
setupCSP();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState(null);

  // Helper to clear all auth data
  const clearData = () => {
    clearSecureData();
    clearJWT();
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  // Initialize auth state from secure storage
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Try to get valid JWT from storage
        const storedToken = getValidJWT();

        if (storedToken) {
          // JWT is valid, extract user info from token payload
          const decoded = decodeJWT(storedToken);
          const userInfo = extractUserFromJWT(storedToken);

          setToken(storedToken);
          setUser(userInfo);
          setIsAuthenticated(true);

          console.log("🔐 Auth initialized from JWT");
          logJWTInfo(storedToken);

          // Optionally verify token with backend
          try {
            const userData = await secureFetch(
              "http://localhost:8000/api/auth/me",
              {},
              storedToken
            );
            if (userData) {
              setUser(userData);
            }
          } catch (error) {
            // /auth/me endpoint may not exist yet, that's ok
            console.warn("⚠️ Could not verify JWT with backend:", error.message);
          }
        } else {
          // No valid token found
          clearJWT();
          console.log("🔓 No valid JWT found");
        }
      } catch (error) {
        console.error("Auth initialization failed:", error);
        clearData();
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (emailOrUsername, password) => {
    setIsLoading(true);
    try {
      // Rate limiting check
      if (!loginLimiter.isAllowed()) {
        const remainingTime = Math.ceil(loginLimiter.getRemainingTime() / 1000);
        return {
          success: false,
          error: `Too many login attempts. Please try again in ${remainingTime} seconds.`,
        };
      }

      // Input validation
      if (!emailOrUsername || !password) {
        return { success: false, error: "Email/username and password are required" };
      }

      if (!validateEmail(emailOrUsername) && !validateUsername(emailOrUsername)) {
        return { success: false, error: "Invalid email or username format" };
      }

      if (!validatePassword(password)) {
        return {
          success: false,
          error: "Password must be at least 8 characters with uppercase, lowercase, number, and special character",
        };
      }

      // Sanitize inputs
      const sanitizedEmail = sanitizeInput(emailOrUsername);
      const sanitizedPassword = password; // Don't sanitize password

      // Call backend
      const response = await secureFetch("http://localhost:8000/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: sanitizedEmail,
          password: sanitizedPassword,
        }),
      });

      const { token: newToken, user: userData } = response;

      if (!newToken || !userData) {
        return { success: false, error: "Invalid response from server" };
      }

      // Validate JWT token before storing
      const jwtValidation = validateJWTBeforeUse(newToken);
      if (!jwtValidation.valid) {
        console.error("❌ Invalid JWT from server:", jwtValidation.error);
        return { success: false, error: "Invalid token received from server" };
      }

      // Extract user info from JWT payload
      const userFromJWT = extractUserFromJWT(newToken);

      // Store token securely
      storeJWT(newToken);
      setSecureToken(newToken);
      setToken(newToken);
      setUser(userFromJWT || userData);
      setIsAuthenticated(true);

      console.log("✅ Login successful, JWT authenticated");
      logJWTInfo(newToken);

      return { success: true, user: userFromJWT || userData };
    } catch (error) {
      console.error("Login error:", error);
      clearData();
      return {
        success: false,
        error: error.message || "Login failed. Please try again.",
      };
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email, username, password) => {
    setIsLoading(true);
    try {
      // Rate limiting check
      if (!signupLimiter.isAllowed()) {
        const remainingTime = Math.ceil(signupLimiter.getRemainingTime() / 1000 / 60);
        return {
          success: false,
          error: `Too many signup attempts. Please try again in ${remainingTime} minutes.`,
        };
      }

      // Input validation
      if (!email || !username || !password) {
        return { success: false, error: "All fields are required" };
      }

      if (!validateEmail(email)) {
        return { success: false, error: "Invalid email format" };
      }

      if (!validateUsername(username)) {
        return {
          success: false,
          error: "Username must be 3-32 characters, alphanumeric with - and _ only",
        };
      }

      if (!validatePassword(password)) {
        return {
          success: false,
          error: "Password must be at least 8 characters with uppercase, lowercase, number, and special char",
        };
      }

      // Sanitize inputs
      const sanitizedEmail = sanitizeInput(email);
      const sanitizedUsername = sanitizeInput(username);
      const sanitizedPassword = password; // Don't sanitize password

      // Call backend
      const response = await secureFetch("http://localhost:8000/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: sanitizedEmail,
          username: sanitizedUsername,
          password: sanitizedPassword,
        }),
      });

      const { token: newToken, user: userData } = response;

      if (!newToken || !userData) {
        return { success: false, error: "Invalid response from server" };
      }

      // Validate JWT token before storing
      const jwtValidation = validateJWTBeforeUse(newToken);
      if (!jwtValidation.valid) {
        console.error("❌ Invalid JWT from server:", jwtValidation.error);
        return { success: false, error: "Invalid token received from server" };
      }

      // Extract user info from JWT payload
      const userFromJWT = extractUserFromJWT(newToken);

      // Store token securely
      storeJWT(newToken);
      setSecureToken(newToken);
      setToken(newToken);
      setUser(userFromJWT || userData);
      setIsAuthenticated(true);

      console.log("✅ Signup successful, JWT authenticated");
      logJWTInfo(newToken);

      return { success: true, user: userFromJWT || userData };
    } catch (error) {
      console.error("Signup error:", error);
      clearData();
      return {
        success: false,
        error: error.message || "Signup failed. Please try again.",
      };
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await secureFetch(
          "http://localhost:8000/api/auth/logout",
          { method: "POST" },
          token
        );
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearData();
      console.log("🔓 User logged out, all data cleared");
    }
  };

  // Handle OAuth callback - directly set auth state with token from OAuth provider
  const oauthLogin = async (oauthToken, userData) => {
    try {
      // Validate inputs
      if (!oauthToken || !userData || !userData.username) {
        throw new Error("Invalid OAuth response");
      }

      // Store token securely
      setSecureToken(oauthToken);
      setToken(oauthToken);
      setUser(userData);
      setIsAuthenticated(true);

      return { success: true, user: userData };
    } catch (error) {
      console.error("OAuth login error:", error);
      clearSecureData();
      return {
        success: false,
        error: error.message || "OAuth login failed",
      };
    }
  };

  const value = {
    user,
    isAuthenticated,
    isLoading,
    token,
    login,
    signup,
    logout,
    oauthLogin
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
