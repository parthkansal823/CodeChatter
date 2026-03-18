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

/**
 * Get password strength score (0-4)
 */
export const getPasswordStrength = (password) => {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (SPECIAL_CHAR_PATTERN.test(password)) score++;
  return Math.min(score, 4);
};

// ============================================================================
// INPUT SANITIZATION
// ============================================================================

/**
 * Sanitize HTML to prevent XSS attacks
 * Removes all HTML tags and special characters
 */
export const sanitizeHTML = (input) => {
  if (typeof input !== 'string') return '';

  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
};

/**
 * Sanitize user input for safe display
 * Removes potentially dangerous characters
 */
export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';

  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers (onclick=, etc)
    .trim();
};

/**
 * Escape special characters for safe use in URLs
 */
export const escapeUrlParam = (param) => {
  if (typeof param !== 'string') return '';
  return encodeURIComponent(param);
};

/**
 * Sanitize room name/code content
 */
export const sanitizeCode = (code) => {
  if (typeof code !== 'string') return '';
  // Remove potentially harmful patterns but preserve code structure
  return code.replace(/[<]\s*script[^>]*>[^<]*<\s*\/\s*script\s*>/gi, '');
};

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

/**
 * Securely store auth token in memory (not localStorage)
 * Use sessionStorage as fallback (cleared on browser close)
 */
export const setSecureToken = (token) => {
  if (!token) return;

  try {
    // Try to use sessionStorage first (more secure than localStorage)
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
    const exp = decoded.exp * 1000; // Convert to milliseconds

    return Date.now() >= exp;
  } catch (e) {
    console.error('Failed to validate token expiration:', e);
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
    'X-Requested-With': 'XMLHttpRequest', // CSRF protection
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
};

/**
 * Setup Content Security Policy
 * Prevents inline scripts and external script injection
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

  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com", // Google OAuth needs some exceptions
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' http://localhost:8000 http://127.0.0.1:8000 ws: wss: https:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://accounts.google.com",
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
    // Remove old attempts outside the window
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
    const remaining = this.windowMs - (Date.now() - oldestAttempt);
    return Math.max(0, remaining);
  }
}

// ============================================================================
// CSRF PROTECTION
// ============================================================================

/**
 * Generate CSRF token
 */
export const generateCSRFToken = () => {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
};

/**
 * Store CSRF token
 */
export const setCSRFToken = (token) => {
  sessionStorage.setItem('__csrf_token', token);
};

/**
 * Get CSRF token
 */
export const getCSRFToken = () => {
  return sessionStorage.getItem('__csrf_token');
};

// ============================================================================
// SECURE API CALLS
// ============================================================================

/**
 * Secure fetch wrapper with error handling and timeout
 */
export const secureFetch = async (url, options = {}, token = null) => {
  const timeout = options.timeout || 10000;

  try {
    // Validate URL
    if (!url.startsWith('http://localhost') && !url.startsWith('https://')) {
      throw new Error('Invalid URL protocol. Only http/https allowed.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = getSecureHeaders(token);
    const response = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
      signal: controller.signal,
      credentials: 'same-origin', // Only send credentials for same-origin requests
    });

    clearTimeout(timeoutId);

    // Handle non-2xx responses
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
        // Unauthorized - token likely expired
        clearSecureData();
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

// ============================================================================
// URL SAFETY
// ============================================================================

/**
 * Validate redirect URL to prevent open redirect attacks
 */
export const isValidRedirectUrl = (url) => {
  try {
    const urlObj = new URL(url, window.location.origin);
    // Only allow same-origin redirects
    return urlObj.origin === window.location.origin;
  } catch {
    return false;
  }
};

/**
 * Safe redirect
 */
export const safeRedirect = (url, defaultUrl = '/') => {
  if (isValidRedirectUrl(url)) {
    window.location.href = url;
  } else {
    window.location.href = defaultUrl;
  }
};
