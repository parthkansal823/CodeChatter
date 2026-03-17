/**
 * Security configuration and environment settings
 * Keep API endpoints, security policies in one place
 */

// ============================================================================
// API CONFIGURATION
// ============================================================================

// Get API base URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Get frontend URL from environment
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'http://localhost:5173';

export const API_ENDPOINTS = {
  // Authentication
  LOGIN: `${API_BASE_URL}/api/auth/login`,
  SIGNUP: `${API_BASE_URL}/api/auth/signup`,
  LOGOUT: `${API_BASE_URL}/api/auth/logout`,
  ME: `${API_BASE_URL}/api/auth/me`,

  // Rooms
  CREATE_ROOM: `${API_BASE_URL}/api/rooms/create`,
  JOIN_ROOM: `${API_BASE_URL}/api/rooms/join`,
  GET_ROOMS: `${API_BASE_URL}/api/rooms`,
  GET_PUBLIC_ROOMS: `${API_BASE_URL}/api/rooms/public`,
  DELETE_ROOM: `${API_BASE_URL}/api/rooms/:roomId/delete`,

  // Collaborators
  GET_COLLABORATORS: `${API_BASE_URL}/api/collaborators`,
  INVITE_COLLABORATOR: `${API_BASE_URL}/api/collaborators/invite`,

  // OAuth
  GOOGLE_LOGIN: `${API_BASE_URL}/auth/google`,
  GITHUB_LOGIN: `${API_BASE_URL}/auth/github`,
};

// ============================================================================
// SECURITY POLICIES
// ============================================================================

export const SECURITY_CONFIG = {
  // Token expiration times
  TOKEN_EXPIRATION: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  REFRESH_TOKEN_BUFFER: 5 * 60 * 1000, // Refresh 5 minutes before expiry

  // Rate limiting
  RATE_LIMITS: {
    LOGIN: { attempts: 5, windowMs: 15 * 60 * 1000 }, // 5 per 15 min
    SIGNUP: { attempts: 3, windowMs: 60 * 60 * 1000 }, // 3 per hour
    API_CALL: { attempts: 30, windowMs: 60 * 1000 }, // 30 per minute
  },

  // Password policy
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_REQUIRE_UPPERCASE: true,
  PASSWORD_REQUIRE_LOWERCASE: true,
  PASSWORD_REQUIRE_NUMBERS: true,
  PASSWORD_REQUIRE_SPECIAL_CHARS: true,

  // Session settings
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  REMEMBER_ME_DURATION: 30 * 24 * 60 * 60 * 1000, // 30 days

  // Request settings
  REQUEST_TIMEOUT: 10000, // 10 seconds
  MAX_RETRY_ATTEMPTS: 3,

  // CORS settings
  ALLOWED_ORIGINS: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
};

// ============================================================================
// SECURITY HEADERS
// ============================================================================

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

// ============================================================================
// INPUT CONSTRAINTS
// ============================================================================

export const INPUT_CONSTRAINTS = {
  EMAIL_MAX_LENGTH: 254,
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 32,
  PASSWORD_MAX_LENGTH: 128,
  ROOM_ID_MIN_LENGTH: 6,
  ROOM_ID_MAX_LENGTH: 20,
  CODE_MAX_LENGTH: 1000000, // 1MB
  MESSAGE_MAX_LENGTH: 5000,
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  // Auth errors
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_USERNAME: 'Username must be 3-32 characters (alphanumeric, -, _)',
  INVALID_PASSWORD: 'Password must contain uppercase, lowercase, number, and special character',
  WEAK_PASSWORD: 'Password is too weak',
  PASSWORDS_NOT_MATCH: 'Passwords do not match',
  EMAIL_ALREADY_EXISTS: 'This email is already registered',
  USERNAME_ALREADY_EXISTS: 'This username is already taken',
  INVALID_CREDENTIALS: 'Invalid email/username or password',
  ACCOUNT_DISABLED: 'This account has been disabled',
  SESSION_EXPIRED: 'Your session has expired. Please login again',
  UNAUTHORIZED: 'You do not have permission to access this resource',

  // Rate limiting
  TOO_MANY_LOGIN_ATTEMPTS: 'Too many login attempts. Please try again later',
  TOO_MANY_SIGNUP_ATTEMPTS: 'Too many signup attempts. Please try again later',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Please slow down',

  // Network errors
  NETWORK_ERROR: 'Network error. Please check your connection',
  REQUEST_TIMEOUT: 'Request timed out. Please try again',
  SERVER_ERROR: 'Server error. Please try again later',

  // General
  INVALID_INPUT: 'Invalid input provided',
  REQUIRED_FIELD: 'This field is required',
};

// ============================================================================
// VALIDATION REGEX PATTERNS
// ============================================================================

export const VALIDATION_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  USERNAME: /^[a-zA-Z0-9_-]{3,32}$/,
  ROOM_ID: /^[a-zA-Z0-9]{6,20}$/,
  URL: /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i,
};

// ============================================================================
// ENVIRONMENT CHECK
// ============================================================================

export const IS_PRODUCTION = import.meta.env.PROD;
export const IS_DEVELOPMENT = import.meta.env.DEV;

// Warn if running in production with hardcoded secrets
if (IS_PRODUCTION && !import.meta.env.VITE_API_URL) {
  console.warn('⚠️ Running in production without proper environment configuration');
}
