import { API_BASE_URL } from "../config/security";

/**
 * Security utility functions for input validation, sanitization, and protection
 */
const SPECIAL_CHAR_PATTERN = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Validates email format
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
};

/**
 * Validates username format
 * - Length: 3-32 characters
 * - Alphanumeric, underscores, hyphens only
 */
export const validateUsername = (username) => {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,32}$/;
  return usernameRegex.test(username);
};

/**
 * Validates password strength
 * - Minimum 8 characters
 * - At least 1 uppercase, 1 lowercase, 1 number, 1 special character
 */
export const validatePassword = (password) => {
  if (password.length < 8) return false;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = SPECIAL_CHAR_PATTERN.test(password);

  return hasUppercase && hasLowercase && hasNumber && hasSpecialChar;
};

/**
 * Validates room ID format
 * - Alphanumeric, 6-20 characters
 */
export const validateRoomId = (roomId) => {
  const roomRegex = /^[a-zA-Z0-9]{6,20}$/;
  return roomRegex.test(roomId);
};

// ============================================================================
// INPUT SANITIZATION
// ============================================================================

/**
 * Sanitize user input for safe display
 * Removes potentially dangerous characters
 */
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
};

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

/**
 * Securely store auth token in sessionStorage
 */
export const setSecureToken = (token) => {
  if (!token) return;

  try {
    sessionStorage.setItem('__auth_token', token);
  } catch (e) {
    console.error('Failed to store token securely:', e);
  }
};

/**
 * Retrieve securely stored token
 */
export const getSecureToken = () => {
  try {
    return sessionStorage.getItem('__auth_token');
  } catch (e) {
    console.error('Failed to retrieve token:', e);
    return null;
  }
};

/**
 * Clear sensitive data
 */
export const clearSecureData = () => {
  try {
    sessionStorage.removeItem('__auth_token');
    sessionStorage.removeItem('__user_data');
  } catch (e) {
    console.error('Failed to clear secure data:', e);
  }
};

/**
 * Check if token is expired
 */
export const isTokenExpired = (token) => {
  if (!token) return true;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;

    const decoded = JSON.parse(atob(parts[1]));
    return Date.now() >= decoded.exp * 1000;
  } catch {
    return true;
  }
};

// ============================================================================
// SECURITY HEADERS & POLICIES
// ============================================================================

/**
 * Inject security headers into fetch requests
 */
export const getSecureHeaders = (token) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
};

/**
 * Setup Content Security Policy
 */
export const setupCSP = () => {
  if (typeof document === "undefined") {
    return;
  }

  const existingPolicy = document.querySelector(
    'meta[http-equiv="Content-Security-Policy"]'
  );

  if (existingPolicy) {
    return;
  }

  const connectSources = Array.from(new Set([
    "'self'",
    new URL(API_BASE_URL).origin,
    import.meta.env.DEV ? "http://localhost:8000" : null,
    import.meta.env.DEV ? "http://127.0.0.1:8000" : null,
    new URL(API_BASE_URL.replace(/^http/, "ws")).origin,
    "https://accounts.google.com",
  ].filter(Boolean)));

  const scriptSources = [
    "'self'",
    import.meta.env.DEV ? "'unsafe-inline'" : null,
    import.meta.env.DEV ? "'unsafe-eval'" : null,
    "https://accounts.google.com",
  ].filter(Boolean);

  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  document.head.appendChild(meta);
};

// ============================================================================
// RATE LIMITING
// ============================================================================

/**
 * Simple client-side rate limiter
 */
export class RateLimiter {
  constructor(maxAttempts = 5, windowMs = 60000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.attempts = [];
  }

  isAllowed() {
    const now = Date.now();
    this.attempts = this.attempts.filter(time => now - time < this.windowMs);

    if (this.attempts.length >= this.maxAttempts) {
      return false;
    }

    this.attempts.push(now);
    return true;
  }

  getRemainingTime() {
    if (this.attempts.length === 0) return 0;
    const oldestAttempt = this.attempts[0];
    return Math.max(0, this.windowMs - (Date.now() - oldestAttempt));
  }
}

// ============================================================================
// SECURE API CALLS
// ============================================================================

/**
 * Secure fetch wrapper with error handling and timeout
 */
export const secureFetch = async (url, options = {}, token = null) => {
  const timeout = options.timeout || 10000;
  let timeoutId = null;

  try {
    const resolvedUrl = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : undefined
    );

    if (!["http:", "https:"].includes(resolvedUrl.protocol)) {
      throw new Error("Invalid URL protocol. Only http/https allowed.");
    }

    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = getSecureHeaders(token);
    const response = await fetch(resolvedUrl.toString(), {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
      credentials: "include",
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorPayload = await response.clone().json();

        if (typeof errorPayload?.detail === "string" && errorPayload.detail.trim()) {
          errorMessage = errorPayload.detail;
        }
      } catch {
        // Ignore JSON parse failures and fall back to status text.
      }

      if (response.status === 401) {
        clearSecureData();
        if (token && typeof window !== "undefined") {
          window.dispatchEvent(new Event("codechatter:auth-expired"));
        }
      }

      const requestError = new Error(errorMessage);
      requestError.status = response.status;
      throw requestError;
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
