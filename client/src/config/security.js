/**
 * Security configuration and environment settings
 * Keep API endpoints in one place
 */

const trimTrailingSlash = (value = "") => value.replace(/\/+$/, "");

const resolveApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();

  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl);
  }

  if (import.meta.env.DEV) {
    return "http://127.0.0.1:8000";
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }

  return "http://127.0.0.1:8000";
};

export const API_BASE_URL = resolveApiBaseUrl();

export const getWebSocketBaseUrl = () => {
  const apiUrl = new URL(API_BASE_URL);
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  return apiUrl.origin;
};

export const API_ENDPOINTS = {
  // Authentication
  LOGIN: `${API_BASE_URL}/api/auth/login`,
  SIGNUP: `${API_BASE_URL}/api/auth/signup`,
  LOGOUT: `${API_BASE_URL}/api/auth/logout`,
  ME: `${API_BASE_URL}/api/auth/me`,
  DELETE_ACCOUNT: `${API_BASE_URL}/api/auth/account`,

  // Rooms
  CREATE_ROOM: `${API_BASE_URL}/api/rooms/create`,
  JOIN_ROOM: `${API_BASE_URL}/api/rooms/join`,
  GET_ROOMS: `${API_BASE_URL}/api/rooms`,
  GET_ROOM_TEMPLATES: `${API_BASE_URL}/api/rooms/templates`,
  GET_PUBLIC_ROOMS: `${API_BASE_URL}/api/rooms/public`,
  GET_ROOM: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}`,
  GET_ROOM_JOIN_STATUS: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/join-status`,
  UPDATE_ROOM_WORKSPACE: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/workspace`,
  UPDATE_ROOM_SETTINGS: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/settings`,
  APPROVE_JOIN_REQUEST: (roomId, requestId) => `${API_BASE_URL}/api/rooms/${roomId}/join-requests/${requestId}/approve`,
  REJECT_JOIN_REQUEST: (roomId, requestId) => `${API_BASE_URL}/api/rooms/${roomId}/join-requests/${requestId}/reject`,
  UPDATE_MEMBER_ACCESS: (roomId, memberId) => `${API_BASE_URL}/api/rooms/${roomId}/members/${memberId}/access`,
  RUN_ROOM_FILE: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/run`,
  DELETE_ROOM: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}`,

  // Collaborators
  GET_COLLABORATORS: `${API_BASE_URL}/api/collaborators`,
  INVITE_COLLABORATOR: `${API_BASE_URL}/api/collaborators/invite`,

  // AI
  AI_ASSIST: `${API_BASE_URL}/api/ai/gemini`,

  // MFA
  VERIFY_OTP: `${API_BASE_URL}/api/auth/verify-otp`,
  RESEND_OTP: `${API_BASE_URL}/api/auth/resend-otp`,

  // OAuth
  GOOGLE_LOGIN: `${API_BASE_URL}/auth/google`,
  GITHUB_LOGIN: `${API_BASE_URL}/auth/github`,
};
