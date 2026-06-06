import { useEffect, useState } from "react";
import {
  clearSecureData,
  getSecureToken,
  isTokenExpired,
  RateLimiter,
  sanitizeInput,
  secureFetch,
  setSecureToken,
  setupCSP,
  validateEmail,
  validatePassword,
  validateUsername,
} from "../utils/security";
import { API_ENDPOINTS } from "../config/security";
import {
  clearJWT,
  extractUserFromJWT,
  getValidJWT,
  logJWTInfo,
  storeJWT,
  validateJWTBeforeUse,
} from "../utils/jwt";
import { AuthContext } from "./auth-context";

const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);
const signupLimiter = new RateLimiter(3, 60 * 60 * 1000);

setupCSP();

const getStoredAuthToken = () => {
  const storedJwt = getValidJWT();

  if (storedJwt) {
    return storedJwt;
  }

  const secureToken = getSecureToken();

  if (!secureToken || isTokenExpired(secureToken)) {
    return null;
  }

  const validation = validateJWTBeforeUse(secureToken);
  return validation.valid ? secureToken : null;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState(null);

  const clearData = () => {
    clearSecureData();
    clearJWT();
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  const applyAuthenticatedState = (nextToken, fallbackUser) => {
    const jwtValidation = validateJWTBeforeUse(nextToken);

    if (!jwtValidation.valid) {
      console.error("Invalid JWT from server:", jwtValidation.error);
      return {
        success: false,
        error: "Invalid token received from server",
      };
    }

    const userFromJWT = extractUserFromJWT(nextToken);
    const authenticatedUser = userFromJWT || fallbackUser;

    storeJWT(nextToken);
    setSecureToken(nextToken);
    setToken(nextToken);
    setUser(authenticatedUser);
    setIsAuthenticated(true);

    logJWTInfo(nextToken);

    return {
      success: true,
      user: authenticatedUser,
    };
  };

  useEffect(() => {
    let isMounted = true;

    const handleAuthExpired = () => {
      if (!isMounted) {
        return;
      }

      clearData();
      window.location.href = "/auth";
    };

    window.addEventListener("codechatter:auth-expired", handleAuthExpired);

    const initializeAuth = async () => {
      try {
        const storedToken = getStoredAuthToken();

        if (!storedToken) {
          clearJWT();
          return;
        }

        const userInfo = extractUserFromJWT(storedToken);

        if (!isMounted) {
          return;
        }

        setToken(storedToken);
        setUser(userInfo);
        setIsAuthenticated(true);

        logJWTInfo(storedToken);

        try {
          const userData = await secureFetch(API_ENDPOINTS.ME, {}, storedToken);

          if (isMounted && userData) {
            setUser(userData);
          }
        } catch (error) {
          // 401 = token is invalid/expired — clear it and redirect to login
          if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
            console.warn("Stored token rejected by server (401) — clearing auth state.");
            if (isMounted) {
              clearData();
              window.location.href = "/auth";
            }
          } else {
            console.warn("Could not verify JWT with backend:", error.message);
          }
        }
      } catch (error) {
        console.error("Auth initialization failed:", error);

        if (isMounted) {
          clearData();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      window.removeEventListener("codechatter:auth-expired", handleAuthExpired);
    };
  }, []);

  const login = async (emailOrUsername, password) => {
    setIsLoading(true);

    try {
      if (!loginLimiter.isAllowed()) {
        const remainingTime = Math.ceil(loginLimiter.getRemainingTime() / 1000);

        return {
          success: false,
          error: `Too many login attempts. Please try again in ${remainingTime} seconds.`,
        };
      }

      if (!emailOrUsername || !password) {
        return {
          success: false,
          error: "Email/username and password are required",
        };
      }

      if (!validateEmail(emailOrUsername) && !validateUsername(emailOrUsername)) {
        return {
          success: false,
          error: "Invalid email or username format",
        };
      }

      if (password.length < 8) {
        return {
          success: false,
          error: "Password must be at least 8 characters",
        };
      }

      const response = await secureFetch(API_ENDPOINTS.LOGIN, {
        method: "POST",
        body: JSON.stringify({
          email: sanitizeInput(emailOrUsername),
          password,
        }),
      });

      if (response?.requires_mfa) {
        return {
          success: true,
          requires_mfa: true,
          mfa_token: response.mfa_token,
          masked_email: response.masked_email,
        };
      }

      if (!response?.token || !response?.user) {
        return {
          success: false,
          error: "Invalid response from server",
        };
      }

      return applyAuthenticatedState(response.token, response.user);
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
      if (!signupLimiter.isAllowed()) {
        const remainingTime = Math.ceil(signupLimiter.getRemainingTime() / 1000 / 60);

        return {
          success: false,
          error: `Too many signup attempts. Please try again in ${remainingTime} minutes.`,
        };
      }

      if (!email || !username || !password) {
        return {
          success: false,
          error: "All fields are required",
        };
      }

      if (!validateEmail(email)) {
        return {
          success: false,
          error: "Invalid email format",
        };
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

      const response = await secureFetch(API_ENDPOINTS.SIGNUP, {
        method: "POST",
        body: JSON.stringify({
          email: sanitizeInput(email),
          username: sanitizeInput(username),
          password,
        }),
      });

      if (response?.requires_mfa) {
        return {
          success: true,
          requires_mfa: true,
          mfa_token: response.mfa_token,
          masked_email: response.masked_email,
        };
      }

      if (!response?.token || !response?.user) {
        return {
          success: false,
          error: "Invalid response from server",
        };
      }

      return applyAuthenticatedState(response.token, response.user);
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

  const verifyOtp = async (mfaToken, otp) => {
    try {
      const response = await secureFetch(API_ENDPOINTS.VERIFY_OTP, {
        method: "POST",
        body: JSON.stringify({ mfa_token: mfaToken, otp }),
      });

      if (!response?.token || !response?.user) {
        return { success: false, error: "Invalid response from server" };
      }

      return applyAuthenticatedState(response.token, response.user);
    } catch (error) {
      return { success: false, error: error.message || "Verification failed" };
    }
  };

  const resendOtp = async (mfaToken) => {
    try {
      await secureFetch(API_ENDPOINTS.RESEND_OTP, {
        method: "POST",
        body: JSON.stringify({ mfa_token: mfaToken }),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || "Could not resend code" };
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await secureFetch(API_ENDPOINTS.LOGOUT, { method: "POST" }, token);
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      clearData();
    }
  };

  const deleteAccount = async () => {
    try {
      if (!token) {
        throw new Error("You are not logged in");
      }

      await secureFetch(API_ENDPOINTS.DELETE_ACCOUNT, { method: "DELETE" }, token);
      clearData();
      return { success: true };
    } catch (error) {
      console.error("Delete account error:", error);
      return {
        success: false,
        error: error.message || "Could not delete account",
      };
    }
  };

  const oauthLogin = async (oauthToken, userData) => {
    try {
      if (!oauthToken || !userData?.username) {
        throw new Error("Invalid OAuth response");
      }

      return applyAuthenticatedState(oauthToken, userData);
    } catch (error) {
      console.error("OAuth login error:", error);
      clearData();

      return {
        success: false,
        error: error.message || "OAuth login failed",
      };
    }
  };

  const refreshUser = async () => {
    if (!token) return;
    try {
      const userData = await secureFetch(API_ENDPOINTS.ME, {}, token);
      if (userData) setUser(userData);
    } catch {
      // ignore silently
    }
  };

  const value = {
    user,
    isAuthenticated,
    isLoading,
    token,
    login,
    signup,
    verifyOtp,
    resendOtp,
    logout,
    deleteAccount,
    oauthLogin,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
