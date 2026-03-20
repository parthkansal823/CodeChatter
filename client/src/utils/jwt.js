/**
 * JWT Authentication Module
 * Handles JWT token validation, decoding, and management
 */

import { jwtDecode } from 'jwt-decode';

// ============================================================================
// JWT VALIDATION & DECODING
// ============================================================================

/**
 * Validate and decode JWT token
 * Returns decoded payload if valid, null if invalid
 */
export const decodeJWT = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    return jwtDecode(token);
  } catch {
    return null;
  }
};

/**
 * Validate JWT format (basic structural check)
 */
const isValidJWTFormat = (token) => {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    parts.forEach((part, index) => {
      if (!part) throw new Error(`Empty part at index ${index}`);
      if (index < 2) {
        JSON.parse(atob(part));
      }
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if JWT token is expired
 */
const isJWTExpired = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  return Date.now() >= decoded.exp * 1000;
};

/**
 * Get remaining time until JWT expiration (in milliseconds)
 */
const getJWTExpirationTime = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return 0;
  }

  return Math.max(0, decoded.exp * 1000 - Date.now());
};

/**
 * Extract user info from JWT payload
 */
export const extractUserFromJWT = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded) return null;

  return {
    id: decoded.sub || decoded.id || decoded.user_id,
    email: decoded.email,
    username: decoded.username || decoded.user,
    iat: decoded.iat ? new Date(decoded.iat * 1000) : null,
    exp: decoded.exp ? new Date(decoded.exp * 1000) : null,
  };
};

/**
 * Validate JWT before using
 */
export const validateJWTBeforeUse = (token) => {
  if (!token) {
    return { valid: false, error: 'No token provided' };
  }

  if (!isValidJWTFormat(token)) {
    return { valid: false, error: 'Invalid JWT format' };
  }

  if (isJWTExpired(token)) {
    return { valid: false, error: 'JWT token expired' };
  }

  return { valid: true, error: null };
};

// ============================================================================
// JWT DEBUGGING & LOGGING
// ============================================================================

/**
 * Log JWT information safely (without exposing full token)
 */
export const logJWTInfo = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded) return;

  const expirationMinutes = Math.ceil(getJWTExpirationTime(token) / 60 / 1000);

  console.log('JWT Info — User:', decoded.sub || decoded.id || 'unknown',
    '| Expires in:', `${expirationMinutes} min`);
};

// ============================================================================
// JWT STORAGE (Secure wrapper)
// ============================================================================

const JWT_STORAGE_KEY = '__auth_jwt';

/**
 * Store JWT token in sessionStorage
 */
export const storeJWT = (token) => {
  if (!token || !isValidJWTFormat(token)) {
    return false;
  }

  try {
    sessionStorage.setItem(JWT_STORAGE_KEY, token);
    return true;
  } catch {
    return false;
  }
};

/**
 * Retrieve JWT token from sessionStorage
 */
const retrieveJWT = () => {
  try {
    return sessionStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
};

/**
 * Clear JWT token from sessionStorage
 */
export const clearJWT = () => {
  try {
    sessionStorage.removeItem(JWT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get stored JWT if still valid
 */
export const getValidJWT = () => {
  const token = retrieveJWT();

  if (!token) {
    return null;
  }

  const validation = validateJWTBeforeUse(token);
  if (!validation.valid) {
    clearJWT();
    return null;
  }

  return token;
};
