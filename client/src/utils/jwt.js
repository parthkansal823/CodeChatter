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
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('❌ Invalid JWT format - expected 3 parts');
      return null;
    }

    // Decode the payload
    const decoded = jwtDecode(token);

    // Validate payload structure
    if (!decoded.sub && !decoded.id && !decoded.user_id) {
      console.warn('⚠️ JWT missing user identifier');
    }

    return decoded;
  } catch (error) {
    console.error('❌ JWT decode error:', error.message);
    return null;
  }
};

/**
 * Validate JWT signature (basic check)
 * Note: Full signature validation requires backend verification
 */
export const isValidJWTFormat = (token) => {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    // Try to decode each part (should be base64)
    parts.forEach((part, index) => {
      if (!part) throw new Error(`Empty part at index ${index}`);
      // Attempt base64 decode
      if (index < 2) {
        // Header and payload should be valid JSON when decoded
        const decoded = atob(part);
        JSON.parse(decoded);
      }
    });
    return true;
  } catch (error) {
    console.error('❌ Invalid JWT format:', error.message);
    return false;
  }
};

/**
 * Check if JWT token is expired
 */
export const isJWTExpired = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    console.warn('⚠️ No expiration in token');
    return true;
  }

  // exp is in seconds, convert to milliseconds
  const expirationTime = decoded.exp * 1000;
  const currentTime = Date.now();
  const isExpired = currentTime >= expirationTime;

  if (isExpired) {
    console.log('🔓 JWT token expired');
  }

  return isExpired;
};

/**
 * Get remaining time until JWT expiration (in milliseconds)
 */
export const getJWTExpirationTime = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return 0;
  }

  const expirationTime = decoded.exp * 1000;
  const currentTime = Date.now();
  const remainingTime = expirationTime - currentTime;

  return Math.max(0, remainingTime);
};

/**
 * Check if JWT should be refreshed (within 5 minutes of expiration)
 */
export const shouldRefreshJWT = (token) => {
  const remainingTime = getJWTExpirationTime(token);
  const refreshThreshold = 5 * 60 * 1000; // 5 minutes

  return remainingTime < refreshThreshold && remainingTime > 0;
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
 * Get JWT claims (all payload data)
 */
export const getJWTClaims = (token) => {
  return decodeJWT(token);
};

// ============================================================================
// JWT HEADER GENERATION
// ============================================================================

/**
 * Generate Authorization header for JWT
 */
export const getJWTHeader = (token) => {
  if (!token) return null;

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
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
// JWT REFRESH LOGIC
// ============================================================================

/**
 * Prepare JWT refresh request
 * Backend should accept this and return new token
 */
export const prepareJWTRefreshRequest = (token) => {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      refresh_token: true,
      previous_token: token,
    }),
  };
};

/**
 * Handle JWT refresh response
 */
export const handleJWTRefreshResponse = (response) => {
  if (!response || !response.token) {
    throw new Error('Invalid refresh response - no token');
  }

  return {
    token: response.token,
    expiresAt: response.expires_at,
  };
};

// ============================================================================
// JWT SECURITY CHECKS
// ============================================================================

/**
 * Verify JWT claims match expected values
 */
export const verifyJWTClaims = (token, expectedUserId) => {
  const decoded = decodeJWT(token);
  if (!decoded) return false;

  const userId = decoded.sub || decoded.id || decoded.user_id;

  if (expectedUserId && userId !== expectedUserId) {
    console.warn('⚠️ JWT user ID mismatch');
    return false;
  }

  return true;
};

/**
 * Check JWT issuer (iss claim)
 */
export const verifyJWTIssuer = (token, expectedIssuer) => {
  const decoded = decodeJWT(token);
  if (!decoded) return false;

  if (expectedIssuer && decoded.iss !== expectedIssuer) {
    console.warn('⚠️ JWT issuer mismatch');
    return false;
  }

  return true;
};

/**
 * Check JWT audience (aud claim)
 */
export const verifyJWTAudience = (token, expectedAudience) => {
  const decoded = decodeJWT(token);
  if (!decoded) return false;

  if (expectedAudience && decoded.aud !== expectedAudience) {
    console.warn('⚠️ JWT audience mismatch');
    return false;
  }

  return true;
};

// ============================================================================
// JWT DEBUGGING & LOGGING
// ============================================================================

/**
 * Log JWT information safely (without exposing full token)
 */
export const logJWTInfo = (token) => {
  const decoded = decodeJWT(token);
  if (!decoded) {
    console.error('❌ Could not decode JWT');
    return;
  }

  const expirationTime = getJWTExpirationTime(token);
  const expirationMinutes = Math.ceil(expirationTime / 60 / 1000);

  console.log('📋 JWT Info:');
  console.log('  User ID:', decoded.sub || decoded.id || 'unknown');
  console.log('  Email:', decoded.email || 'not set');
  console.log('  Username:', decoded.username || 'not set');
  console.log('  Issued At:', new Date((decoded.iat || 0) * 1000).toISOString());
  console.log('  Expires At:', new Date((decoded.exp || 0) * 1000).toISOString());
  console.log('  Time Remaining:', `${expirationMinutes} minutes`);
  console.log('  Expired:', isJWTExpired(token) ? '🔓 Yes' : '🔐 No');
  console.log('  Should Refresh:', shouldRefreshJWT(token) ? '⚠️ Yes' : '✅ No');
};

/**
 * Compare two JWTs
 */
export const compareJWTs = (token1, token2) => {
  const decoded1 = decodeJWT(token1);
  const decoded2 = decodeJWT(token2);

  if (!decoded1 || !decoded2) return false;

  return (
    decoded1.sub === decoded2.sub &&
    decoded1.email === decoded2.email &&
    decoded1.iat === decoded2.iat
  );
};

// ============================================================================
// JWT ERROR HANDLING
// ============================================================================

export class JWTError extends Error {
  constructor(message, token) {
    super(message);
    this.name = 'JWTError';
    this.token = token;
  }
}

export class JWTExpiredError extends JWTError {
  constructor(token) {
    super('JWT token has expired', token);
    this.name = 'JWTExpiredError';
  }
}

export class JWTInvalidError extends JWTError {
  constructor(reason, token) {
    super(`Invalid JWT: ${reason}`, token);
    this.name = 'JWTInvalidError';
  }
}

/**
 * Throw appropriate error for JWT validation failure
 */
export const throwJWTError = (token) => {
  if (!token) {
    throw new JWTError('No JWT token provided');
  }

  if (!isValidJWTFormat(token)) {
    throw new JWTInvalidError('Invalid format', token);
  }

  if (isJWTExpired(token)) {
    throw new JWTExpiredError(token);
  }

  throw new JWTError('JWT validation failed', token);
};

// ============================================================================
// JWT IN LOCAL STORAGE (Secure wrapper)
// ============================================================================

const JWT_STORAGE_KEY = '__auth_jwt';

/**
 * Store JWT token
 */
export const storeJWT = (token) => {
  if (!token || !isValidJWTFormat(token)) {
    console.error('❌ Cannot store invalid JWT');
    return false;
  }

  try {
    sessionStorage.setItem(JWT_STORAGE_KEY, token);
    console.log('🔐 JWT stored securely');
    return true;
  } catch (error) {
    console.error('❌ Failed to store JWT:', error);
    return false;
  }
};

/**
 * Retrieve JWT token
 */
export const retrieveJWT = () => {
  try {
    return sessionStorage.getItem(JWT_STORAGE_KEY);
  } catch (error) {
    console.error('❌ Failed to retrieve JWT:', error);
    return null;
  }
};

/**
 * Clear JWT token
 */
export const clearJWT = () => {
  try {
    sessionStorage.removeItem(JWT_STORAGE_KEY);
    console.log('🔓 JWT cleared');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear JWT:', error);
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
    console.warn('⚠️ Stored JWT invalid:', validation.error);
    clearJWT();
    return null;
  }

  return token;
};
