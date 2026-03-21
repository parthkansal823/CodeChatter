/**
 * Security configuration and environment settings
 * Keep API endpoints in one place
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
  GET_ROOM_TEMPLATES: `${API_BASE_URL}/api/rooms/templates`,
  GET_PUBLIC_ROOMS: `${API_BASE_URL}/api/rooms/public`,
  GET_ROOM: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}`,
  UPDATE_ROOM_WORKSPACE: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/workspace`,
  UPDATE_ROOM_SETTINGS: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/settings`,
  RUN_ROOM_FILE: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}/run`,
  DELETE_ROOM: (roomId) => `${API_BASE_URL}/api/rooms/${roomId}`,

  // Collaborators
  GET_COLLABORATORS: `${API_BASE_URL}/api/collaborators`,
  INVITE_COLLABORATOR: `${API_BASE_URL}/api/collaborators/invite`,

  // OAuth
  GOOGLE_LOGIN: `${API_BASE_URL}/auth/google`,
  GITHUB_LOGIN: `${API_BASE_URL}/auth/github`,
};
