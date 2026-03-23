from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlencode, urlparse

from authlib.integrations.starlette_client import OAuth
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
import httpx
from jose import JWTError, jwt
from pydantic import BaseModel, Field, field_validator
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.gzip import GZipMiddleware

try:
  from .database import MongoRepository
except ImportError:
  from database import MongoRepository

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("codechatter.server")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_DAYS = int(os.getenv("JWT_EXPIRATION_DAYS", "7"))
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(32)
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY") or secrets.token_urlsafe(32)
ALLOWED_ORIGINS = [
  origin.strip()
  for origin in os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000"
  ).split(",")
  if origin.strip()
]
DEFAULT_FRONTEND_URL = os.getenv(
  "FRONTEND_URL",
  ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "http://localhost:5173"
)
DEFAULT_CALLBACK_URL = f"{DEFAULT_FRONTEND_URL.rstrip('/')}/auth/callback"
RUN_TIMEOUT_SECONDS = int(os.getenv("CODE_RUN_TIMEOUT_SECONDS", "15"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30"))
GEMINI_API_BASE_URL = os.getenv(
  "GEMINI_API_BASE_URL",
  "https://generativelanguage.googleapis.com/v1beta",
).rstrip("/")

APP_DIR = Path(__file__).resolve().parent
CLIENT_DIST_DIR = APP_DIR.parent / "client" / "dist"
CLIENT_INDEX_FILE = CLIENT_DIST_DIR / "index.html"
repository = MongoRepository(
  mongo_uri=os.getenv("MONGODB_URI", "mongodb://localhost:27017"),
  database_name=os.getenv("MONGODB_DB_NAME", "codechatter"),
  legacy_data_file=APP_DIR / "data" / "storage.json",
)

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{3,32}$")
ROOM_ID_PATTERN = re.compile(r"^[A-Z0-9]{6,20}$")
TEMPLATE_ID_PATTERN = re.compile(r"^[a-z0-9-]{3,40}$")
TERMINAL_SHELL_PATTERN = re.compile(r"^(bash|powershell|cmd|sh)$")
_UNSET = object()


@asynccontextmanager
async def lifespan(_: FastAPI):
  repository.initialize()
  yield
  repository.close()


app = FastAPI(title="CodeChatter API", lifespan=lifespan)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

    if ENVIRONMENT == "production":
      response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response


class CollaborationManager:
  def __init__(self) -> None:
    self._rooms: dict[str, dict[str, dict[str, Any]]] = {}
    self._lock = asyncio.Lock()

  @staticmethod
  def _serialize_connection(connection: dict[str, Any]) -> dict[str, Any]:
    return {
      "sessionId": connection["session_id"],
      "userId": connection["user_id"],
      "username": connection["username"],
      "email": connection["email"],
      "activeFilePath": connection.get("active_file_path"),
      "cursor": connection.get("cursor"),
      "typing": connection.get("typing"),
    }

  async def connect(
    self,
    room_id: str,
    websocket: WebSocket,
    user: dict[str, Any],
  ) -> dict[str, Any]:
    connection = {
      "session_id": secrets.token_hex(8),
      "room_id": room_id,
      "user_id": user["id"],
      "username": user["username"],
      "email": user["email"],
      "websocket": websocket,
      "active_file_path": None,
      "cursor": None,
      "typing": {
        "isTyping": False,
        "filePath": None,
        "updatedAt": None,
      },
    }

    async with self._lock:
      room_connections = self._rooms.setdefault(room_id, {})
      room_connections[connection["session_id"]] = connection

    return connection

  async def disconnect(self, room_id: str, session_id: str) -> None:
    async with self._lock:
      room_connections = self._rooms.get(room_id)
      if not room_connections:
        return

      room_connections.pop(session_id, None)

      if not room_connections:
        self._rooms.pop(room_id, None)

  async def list_presence(self, room_id: str) -> list[dict[str, Any]]:
    async with self._lock:
      room_connections = self._rooms.get(room_id, {})
      presence = [
        self._serialize_connection(connection)
        for connection in room_connections.values()
      ]

    presence.sort(key=lambda item: (item["username"].lower(), item["sessionId"]))
    return presence

  async def update_presence(
    self,
    room_id: str,
    session_id: str,
    *,
    active_file_path: str | None | object = _UNSET,
    cursor: dict[str, Any] | None | object = _UNSET,
    typing: dict[str, Any] | None | object = _UNSET,
  ) -> list[dict[str, Any]]:
    async with self._lock:
      room_connections = self._rooms.get(room_id, {})
      connection = room_connections.get(session_id)

      if connection is None:
        return []

      if active_file_path is not _UNSET:
        connection["active_file_path"] = active_file_path

      if cursor is not _UNSET:
        connection["cursor"] = cursor

      if typing is not _UNSET:
        connection["typing"] = typing

      presence = [
        self._serialize_connection(item)
        for item in room_connections.values()
      ]

    presence.sort(key=lambda item: (item["username"].lower(), item["sessionId"]))
    return presence

  async def broadcast(
    self,
    room_id: str,
    payload: dict[str, Any],
    *,
    exclude_session_id: str | None = None,
  ) -> None:
    async with self._lock:
      room_connections = list(self._rooms.get(room_id, {}).items())

    stale_session_ids: list[str] = []

    for session_id, connection in room_connections:
      if exclude_session_id and session_id == exclude_session_id:
        continue

      try:
        await connection["websocket"].send_json(payload)
      except Exception as error:
        logger.warning(
          "Could not deliver collaboration payload to session %s in room %s: %s",
          session_id,
          room_id,
          error,
        )
        stale_session_ids.append(session_id)

    if stale_session_ids:
      for session_id in stale_session_ids:
        await self.disconnect(room_id, session_id)

      updated_presence = await self.list_presence(room_id)
      if updated_presence:
        await self.broadcast(
          room_id,
          {
            "type": "presence_snapshot",
            "presence": updated_presence,
          },
        )


collaboration_manager = CollaborationManager()


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_credentials=True,
  allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
  max_age=3600,
)
app.add_middleware(
  SessionMiddleware,
  secret_key=SESSION_SECRET_KEY,
  same_site="lax",
  https_only=ENVIRONMENT == "production",
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

oauth = OAuth()
REGISTERED_OAUTH_PROVIDERS: set[str] = set()


def register_oauth_providers() -> None:
  google_client_id = os.getenv("GOOGLE_CLIENT_ID")
  google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

  if google_client_id and google_client_secret:
    oauth.register(
      name="google",
      client_id=google_client_id,
      client_secret=google_client_secret,
      server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
      client_kwargs={"scope": "openid email profile"},
    )
    REGISTERED_OAUTH_PROVIDERS.add("google")

  github_client_id = os.getenv("GITHUB_CLIENT_ID")
  github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")

  if github_client_id and github_client_secret:
    oauth.register(
      name="github",
      client_id=github_client_id,
      client_secret=github_client_secret,
      access_token_url="https://github.com/login/oauth/access_token",
      authorize_url="https://github.com/login/oauth/authorize",
      api_base_url="https://api.github.com/",
      client_kwargs={"scope": "user:email"},
    )
    REGISTERED_OAUTH_PROVIDERS.add("github")


register_oauth_providers()


def get_default_terminal_shell() -> str:
  return "powershell" if os.name == "nt" else "bash"


def normalize_terminal_shell(value: str | None) -> str:
  normalized = (value or get_default_terminal_shell()).strip().lower()

  if not TERMINAL_SHELL_PATTERN.fullmatch(normalized):
    raise ValueError("Unsupported terminal shell")

  return normalized


class LoginRequest(BaseModel):
  email: str = Field(min_length=3, max_length=254)
  password: str = Field(min_length=8, max_length=128)

  @field_validator("email")
  @classmethod
  def normalize_identifier(cls, value: str) -> str:
    normalized = value.strip()

    if "@" in normalized:
      if not EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid email address")
      return normalized.lower()

    if not USERNAME_PATTERN.fullmatch(normalized):
      raise ValueError("Enter a valid email address or username")

    return normalized


class SignupRequest(BaseModel):
  email: str = Field(min_length=5, max_length=254)
  username: str = Field(min_length=3, max_length=32)
  password: str = Field(min_length=8, max_length=128)

  @field_validator("email")
  @classmethod
  def validate_email(cls, value: str) -> str:
    normalized = value.strip().lower()

    if not EMAIL_PATTERN.fullmatch(normalized):
      raise ValueError("Enter a valid email address")

    return normalized

  @field_validator("username")
  @classmethod
  def validate_username(cls, value: str) -> str:
    normalized = value.strip()

    if not USERNAME_PATTERN.fullmatch(normalized):
      raise ValueError("Username must be 3-32 characters and use only letters, numbers, _ and -")

    return normalized

  @field_validator("password")
  @classmethod
  def validate_password(cls, value: str) -> str:
    has_upper = any(character.isupper() for character in value)
    has_lower = any(character.islower() for character in value)
    has_number = any(character.isdigit() for character in value)
    has_special = any(not character.isalnum() for character in value)

    if not (has_upper and has_lower and has_number and has_special):
      raise ValueError(
        "Password must contain uppercase, lowercase, number, and special character"
      )

    return value


class RoomCreateRequest(BaseModel):
  name: str | None = Field(default=None, max_length=80)
  description: str | None = Field(default=None, max_length=240)
  is_public: bool = False
  templateId: str | None = Field(default="blank", max_length=40)
  terminalShell: str | None = Field(default=None, max_length=20)
  dsaLanguage: str | None = Field(default="python", max_length=20)

  @field_validator("dsaLanguage")
  @classmethod
  def validate_dsa_language(cls, value: str | None) -> str:
    allowed = {"python","javascript","typescript","cpp","java","c","go","rust"}
    if not value:
      return "python"
    if value.lower() not in allowed:
      raise ValueError(f"Unsupported DSA language. Choose from: {', '.join(sorted(allowed))}")
    return value.lower()

  @field_validator("name", "description")
  @classmethod
  def normalize_optional_text(cls, value: str | None) -> str | None:
    if value is None:
      return None

    stripped = value.strip()
    return stripped or None

  @field_validator("templateId")
  @classmethod
  def normalize_template_id(cls, value: str | None) -> str:
    normalized = (value or "blank").strip().lower()

    if not TEMPLATE_ID_PATTERN.fullmatch(normalized):
      raise ValueError("Invalid room template")

    return normalized

  @field_validator("terminalShell")
  @classmethod
  def validate_terminal_shell(cls, value: str | None) -> str:
    return normalize_terminal_shell(value)


class RoomJoinRequest(BaseModel):
  roomId: str = Field(min_length=6, max_length=20)

  @field_validator("roomId")
  @classmethod
  def validate_room_id(cls, value: str) -> str:
    normalized = value.strip().upper()

    if not ROOM_ID_PATTERN.fullmatch(normalized):
      raise ValueError("Room ID must be 6-20 uppercase letters or numbers")

    return normalized


class RoomSettingsUpdateRequest(BaseModel):
  name: str | None = Field(default=None, max_length=80)
  description: str | None = Field(default=None, max_length=240)
  terminalShell: str | None = Field(default=None, max_length=20)

  @field_validator("terminalShell")
  @classmethod
  def validate_terminal_shell(cls, value: str | None) -> str | None:
    if value is None:
      return None

    return normalize_terminal_shell(value)


class RoomWorkspaceUpdateRequest(BaseModel):
  tree: list[dict[str, Any]] = Field(default_factory=list)


class RoomRunRequest(BaseModel):
  filePath: str = Field(min_length=1, max_length=260)
  stdin: str | None = Field(default="", max_length=20_000)

  @field_validator("filePath")
  @classmethod
  def normalize_file_path(cls, value: str) -> str:
    return normalize_workspace_path(value)

  @field_validator("stdin")
  @classmethod
  def normalize_stdin(cls, value: str | None) -> str:
    return value or ""


class GeminiAssistRequest(BaseModel):
  prompt: str = Field(min_length=1, max_length=4000)
  roomId: str | None = Field(default=None, min_length=6, max_length=20)
  roomName: str | None = Field(default=None, max_length=80)
  activeFilePath: str | None = Field(default=None, max_length=260)
  activeCode: str | None = Field(default="", max_length=40_000)
  runResult: dict[str, Any] | None = None

  @field_validator("prompt")
  @classmethod
  def normalize_prompt(cls, value: str) -> str:
    normalized = value.strip()

    if not normalized:
      raise ValueError("Prompt cannot be empty")

    return normalized

  @field_validator("roomId")
  @classmethod
  def normalize_room_id(cls, value: str | None) -> str | None:
    if value is None:
      return None

    normalized = value.strip().upper()

    if not ROOM_ID_PATTERN.fullmatch(normalized):
      raise ValueError("Room ID must be 6-20 uppercase letters or numbers")

    return normalized

  @field_validator("roomName", "activeFilePath")
  @classmethod
  def normalize_optional_text(cls, value: str | None) -> str | None:
    if value is None:
      return None

    normalized = value.strip()
    return normalized or None

  @field_validator("activeCode")
  @classmethod
  def normalize_code(cls, value: str | None) -> str | None:
    if value is None:
      return None

    return value


def utc_now() -> datetime:
  return datetime.now(timezone.utc)


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
  salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
  password_hash = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt,
    150_000,
  )
  return salt.hex(), password_hash.hex()


def verify_password(password: str, password_hash: str, salt_hex: str) -> bool:
  _, calculated_hash = hash_password(password, salt_hex)
  return hmac.compare_digest(password_hash, calculated_hash)


def create_access_token(user: dict[str, Any]) -> str:
  issued_at = utc_now()
  expires_at = issued_at + timedelta(days=JWT_EXPIRATION_DAYS)
  payload = {
    "sub": user["id"],
    "email": user["email"],
    "username": user["username"],
    "iat": int(issued_at.timestamp()),
    "exp": int(expires_at.timestamp()),
  }
  return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_bearer_token(request: Request) -> str:
  auth_header = request.headers.get("Authorization", "")
  scheme, _, token = auth_header.partition(" ")

  if scheme.lower() != "bearer" or not token:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Missing or invalid authorization header",
    )

  return token


def get_current_user(request: Request) -> dict[str, Any]:
  token = get_bearer_token(request)
  return get_current_user_from_token(token)


def get_current_user_from_token(token: str) -> dict[str, Any]:
  try:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
  except JWTError as error:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid or expired token",
    ) from error

  user_id = payload.get("sub")

  if not user_id:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Token is missing a subject",
    )

  user = repository.get_user_by_id(user_id)

  if not user:
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="User no longer exists",
    )

  return user


def normalize_optional_workspace_path(value: Any) -> str | None:
  if value is None:
    return None

  raw_value = str(value).strip()
  if not raw_value:
    return None

  return normalize_workspace_path(raw_value)


def build_cursor_payload(message: dict[str, Any]) -> dict[str, Any] | None:
  file_path = normalize_optional_workspace_path(message.get("activeFilePath"))

  if file_path is None:
    return None

  try:
    line = int(message.get("line", 1))
    column = int(message.get("column", 1))
  except (TypeError, ValueError) as error:
    raise ValueError("Cursor coordinates must be numbers") from error

  if line < 1 or column < 1:
    raise ValueError("Cursor coordinates must be positive")

  return {
    "filePath": file_path,
    "line": line,
    "column": column,
    "updatedAt": utc_now().isoformat(),
  }


def validate_room_id_value(room_id: str) -> str:
  normalized = room_id.strip().upper()

  if not ROOM_ID_PATTERN.fullmatch(normalized):
    raise HTTPException(
      status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
      detail="Room ID must be 6-20 uppercase letters or numbers",
    )

  return normalized


def normalize_workspace_path(value: str) -> str:
  raw_value = value.strip().replace("\\", "/")
  path = PurePosixPath(raw_value)

  if path.is_absolute():
    raise ValueError("Workspace paths must be relative")

  parts = [part for part in path.parts if part not in {"", "."}]

  if not parts or any(part == ".." for part in parts):
    raise ValueError("Invalid workspace path")

  return "/".join(parts)


def summarize_run_result_for_ai(run_result: dict[str, Any] | None) -> str:
  if not isinstance(run_result, dict):
    return "No recent run result was provided."

  summary_parts: list[str] = []

  command = str(run_result.get("command", "")).strip()
  if command:
    summary_parts.append(f"Command: {command}")

  exit_code = run_result.get("exitCode")
  if exit_code is not None:
    summary_parts.append(f"Exit code: {exit_code}")

  runtime_ms = run_result.get("runtimeMs")
  if isinstance(runtime_ms, (int, float)):
    summary_parts.append(f"Runtime: {int(runtime_ms)} ms")

  stdout = str(run_result.get("stdout", "")).strip()
  stderr = str(run_result.get("stderr", "")).strip()

  if stdout:
    summary_parts.append(f"Stdout:\n{stdout[:3000]}")

  if stderr:
    summary_parts.append(f"Stderr:\n{stderr[:3000]}")

  return "\n\n".join(summary_parts) if summary_parts else "No recent run result was provided."


def build_gemini_prompt(
  payload: GeminiAssistRequest,
  *,
  current_user: dict[str, Any],
  active_file_path: str | None,
) -> str:
  active_code = (payload.activeCode or "")[:25_000]
  room_label = payload.roomName or payload.roomId or "Current workspace"
  file_label = active_file_path or "No file selected"
  run_result_summary = summarize_run_result_for_ai(payload.runResult)

  sections = [
    "You are the AI assistant inside CodeChatter, a collaborative coding workspace.",
    "Give practical, implementation-focused answers grounded in the provided room context.",
    "Be concise but useful. Prefer actionable debugging and improvement advice over generic theory.",
    "",
    f"Developer: {current_user['username']}",
    f"Workspace: {room_label}",
    f"Active file: {file_label}",
    "",
    "User request:",
    payload.prompt,
    "",
    "Latest run result:",
    run_result_summary,
    "",
    "Active file content:",
    active_code or "No active file content was provided.",
  ]

  return "\n".join(sections)


def extract_gemini_text(response_payload: dict[str, Any]) -> str:
  for candidate in response_payload.get("candidates", []):
    content = candidate.get("content", {})
    parts = content.get("parts", [])
    text_parts = [
      str(part.get("text", "")).strip()
      for part in parts
      if str(part.get("text", "")).strip()
    ]

    if text_parts:
      return "\n\n".join(text_parts)

  raise HTTPException(
    status_code=status.HTTP_502_BAD_GATEWAY,
    detail="Gemini returned an empty response",
  )


async def request_gemini_completion(prompt: str) -> str:
  if not GEMINI_API_KEY:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail="Gemini is not configured yet. Add GEMINI_API_KEY to server/.env and restart the backend.",
    )

  request_payload = {
    "system_instruction": {
      "parts": [
        {
          "text": (
            "You are CodeChatter AI, a collaborative coding assistant. "
            "Focus on code explanation, debugging, and concrete next steps."
          )
        }
      ]
    },
    "contents": [
      {
        "role": "user",
        "parts": [{"text": prompt}],
      }
    ],
    "generationConfig": {
      "temperature": 0.35,
      "maxOutputTokens": 1024,
    },
  }

  try:
    async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as client:
      response = await client.post(
        f"{GEMINI_API_BASE_URL}/models/{GEMINI_MODEL}:generateContent",
        headers={
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        json=request_payload,
      )
      response.raise_for_status()
  except httpx.HTTPStatusError as error:
    detail = "Gemini request failed"

    try:
      error_payload = error.response.json()
      api_message = error_payload.get("error", {}).get("message")
      if isinstance(api_message, str) and api_message.strip():
        detail = api_message.strip()
    except ValueError:
      detail = error.response.text or detail

    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Gemini request failed: {detail}",
    ) from error
  except httpx.HTTPError as error:
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Gemini request failed: {error}",
    ) from error

  return extract_gemini_text(response.json())


def iter_workspace_files(
  nodes: list[dict[str, Any]],
  parent_path: str = "",
) -> list[tuple[str, str]]:
  files: list[tuple[str, str]] = []

  for node in nodes:
    node_name = str(node.get("name", "")).strip()

    if not node_name:
      continue

    current_path = f"{parent_path}/{node_name}" if parent_path else node_name

    if node.get("type") == "file":
      files.append((current_path, str(node.get("content", ""))))
      continue

    if node.get("type") == "folder":
      files.extend(iter_workspace_files(node.get("children", []), current_path))

  return files


def find_installed_command(*candidates: str) -> str | None:
  for candidate in candidates:
    executable_path = shutil.which(candidate)
    if executable_path:
      return executable_path

  return None


def run_process(
  command: list[str],
  cwd: str,
  stdin_text: str = "",
) -> dict[str, Any]:
  start_time = utc_now()

  try:
    completed = subprocess.run(
      command,
      cwd=cwd,
      input=stdin_text,
      text=True,
      capture_output=True,
      timeout=RUN_TIMEOUT_SECONDS,
      shell=False,
      check=False,
    )
  except subprocess.TimeoutExpired as error:
    return {
      "stdout": error.stdout or "",
      "stderr": (error.stderr or "") + f"\nProcess timed out after {RUN_TIMEOUT_SECONDS} seconds.",
      "exitCode": None,
      "runtimeMs": int((utc_now() - start_time).total_seconds() * 1000),
    }
  except OSError as error:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=f"Could not start the configured runner: {error}",
    ) from error

  return {
    "stdout": completed.stdout,
    "stderr": completed.stderr,
    "exitCode": completed.returncode,
    "runtimeMs": int((utc_now() - start_time).total_seconds() * 1000),
  }


def build_run_plan(workspace_root: Path, relative_path: str) -> dict[str, Any]:
  target_file = workspace_root / PurePosixPath(relative_path)
  extension = target_file.suffix.lower()

  if extension == ".py":
    runner = find_installed_command("python", "py")

    if runner is None:
      raise HTTPException(status_code=400, detail="Python is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension in {".js", ".mjs", ".cjs"}:
    runner = find_installed_command("node")

    if runner is None:
      raise HTTPException(status_code=400, detail="Node.js is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".ts":
    runner = find_installed_command("tsx", "ts-node")

    if runner is None:
      raise HTTPException(
        status_code=400,
        detail="TypeScript execution is not available. Install `tsx` or `ts-node` first.",
      )

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".php":
    runner = find_installed_command("php")

    if runner is None:
      raise HTTPException(status_code=400, detail="PHP is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".rb":
    runner = find_installed_command("ruby")

    if runner is None:
      raise HTTPException(status_code=400, detail="Ruby is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".go":
    runner = find_installed_command("go")

    if runner is None:
      raise HTTPException(status_code=400, detail="Go is not installed on the server")

    return {
      "compile": None,
      "run": [runner, "run", str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".java":
    javac = find_installed_command("javac")
    java = find_installed_command("java")

    if javac is None or java is None:
      raise HTTPException(status_code=400, detail="Java is not installed on the server")

    return {
      "compile": [javac, str(target_file)],
      "run": [java, target_file.stem],
      "cwd": str(target_file.parent),
    }

  if extension == ".c":
    compiler = find_installed_command("gcc", "clang")

    if compiler is None:
      raise HTTPException(status_code=400, detail="A C compiler is not installed on the server")

    binary_name = "codechatter-c.exe" if os.name == "nt" else "codechatter-c"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension in {".cpp", ".cc", ".cxx"}:
    compiler = find_installed_command("g++", "clang++")

    if compiler is None:
      raise HTTPException(status_code=400, detail="A C++ compiler is not installed on the server")

    binary_name = "codechatter-cpp.exe" if os.name == "nt" else "codechatter-cpp"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension == ".rs":
    compiler = find_installed_command("rustc")

    if compiler is None:
      raise HTTPException(status_code=400, detail="Rust is not installed on the server")

    binary_name = "codechatter-rust.exe" if os.name == "nt" else "codechatter-rust"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension == ".sh":
    runner = find_installed_command("bash", "sh")
    if runner is None:
      raise HTTPException(status_code=400, detail="Bash/sh is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".lua":
    runner = find_installed_command("lua")
    if runner is None:
      raise HTTPException(status_code=400, detail="Lua is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".pl":
    runner = find_installed_command("perl")
    if runner is None:
      raise HTTPException(status_code=400, detail="Perl is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".swift":
    runner = find_installed_command("swift")
    if runner is None:
      raise HTTPException(status_code=400, detail="Swift is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".kt":
    kotlinc = find_installed_command("kotlinc")
    java = find_installed_command("java")
    if kotlinc is None or java is None:
      raise HTTPException(status_code=400, detail="Kotlin or Java is not installed on the server")
    return {
      "compile": [kotlinc, str(target_file), "-include-runtime", "-d", "codechatter-kt.jar"],
      "run": [java, "-jar", "codechatter-kt.jar"],
      "cwd": str(target_file.parent)
    }

  if extension in {".html", ".css", ".json", ".md"}:
    raise HTTPException(
      status_code=400,
      detail="This file type is not directly runnable. Use the browser preview or switch to a script file.",
    )

  raise HTTPException(
    status_code=400,
    detail=f"Running `{extension or 'this file type'}` is not supported yet.",
  )


def sync_workspace_to_disk(room_id: str, workspace_tree: list[dict[str, Any]]) -> str:
  workspace_root = APP_DIR / "data" / "workspaces" / room_id
  workspace_root.mkdir(parents=True, exist_ok=True)
  
  workspace_files = iter_workspace_files(workspace_tree)
  for relative_path, content in workspace_files:
    target_path = workspace_root / PurePosixPath(relative_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
      
  return str(workspace_root)


def execute_workspace_file(
  workspace_tree: list[dict[str, Any]],
  file_path: str,
  stdin_text: str,
) -> dict[str, Any]:
  normalized_path = normalize_workspace_path(file_path)
  workspace_files = iter_workspace_files(workspace_tree)
  file_lookup = {relative_path: content for relative_path, content in workspace_files}

  if normalized_path not in file_lookup:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="The selected file does not exist in this room workspace",
    )

  with tempfile.TemporaryDirectory(prefix="codechatter-run-") as temp_dir:
    workspace_root = Path(temp_dir)

    for relative_path, content in workspace_files:
      target_path = workspace_root / PurePosixPath(relative_path)
      target_path.parent.mkdir(parents=True, exist_ok=True)
      target_path.write_text(content, encoding="utf-8")

    run_plan = build_run_plan(workspace_root, normalized_path)
    compile_command = run_plan["compile"]
    run_command = run_plan["run"]
    working_directory = run_plan["cwd"]

    if compile_command is not None:
      compile_result = run_process(compile_command, working_directory)
      compile_result["phase"] = "compile"
      compile_result["command"] = " ".join(compile_command)
      compile_result["filePath"] = normalized_path

      if compile_result["exitCode"] not in {0, None}:
        return compile_result

    run_result = run_process(run_command, working_directory, stdin_text)
    run_result["phase"] = "run"
    run_result["command"] = " ".join(run_command)
    run_result["filePath"] = normalized_path

    if compile_command is not None:
      run_result["compileCommand"] = " ".join(compile_command)

    return run_result


def get_safe_redirect_uri(redirect_uri: str | None) -> str:
  if not redirect_uri:
    return DEFAULT_CALLBACK_URL

  try:
    parsed = urlparse(redirect_uri)
    origin = f"{parsed.scheme}://{parsed.netloc}"
  except ValueError:
    return DEFAULT_CALLBACK_URL

  if parsed.scheme in {"http", "https"} and origin in ALLOWED_ORIGINS:
    return redirect_uri

  return DEFAULT_CALLBACK_URL


def build_frontend_error_redirect(error_code: str) -> str:
  return f"{DEFAULT_FRONTEND_URL.rstrip('/')}/auth?{urlencode({'error': error_code})}"


def frontend_is_built() -> bool:
  return CLIENT_INDEX_FILE.is_file()


def resolve_frontend_asset(full_path: str) -> Path | None:
  normalized_path = full_path.strip().lstrip("/")

  if not normalized_path:
    return CLIENT_INDEX_FILE if frontend_is_built() else None

  candidate = (CLIENT_DIST_DIR / normalized_path).resolve()

  try:
    candidate.relative_to(CLIENT_DIST_DIR.resolve())
  except ValueError:
    return None

  if candidate.is_file():
    return candidate

  return None


@app.get("/")
def home() -> Any:
  if frontend_is_built():
    return FileResponse(CLIENT_INDEX_FILE)

  return {
    "status": "server running",
    "oauthProviders": sorted(REGISTERED_OAUTH_PROVIDERS),
    "database": repository.health(),
  }


@app.get("/api/health")
def health() -> dict[str, Any]:
  return {
    "status": "ok",
    "database": repository.health(),
  }


@app.post("/api/auth/signup")
def signup(payload: SignupRequest) -> dict[str, Any]:
  if repository.get_user_by_email(payload.email):
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="This email is already registered",
    )

  if repository.get_user_by_username(payload.username):
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="This username is already taken",
    )

  salt_hex, password_hash = hash_password(payload.password)
  user = repository.create_user(
    email=payload.email,
    username=payload.username,
    password_hash=password_hash,
    password_salt=salt_hex,
  )

  return {
    "token": create_access_token(user),
    "user": repository.serialize_user(user),
  }


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
  user = (
    repository.get_user_by_email(payload.email)
    if "@" in payload.email
    else repository.get_user_by_username(payload.email)
  )

  if not user or not user.get("password_hash") or not verify_password(
    payload.password,
    user["password_hash"],
    user["password_salt"],
  ):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="Invalid email/username or password",
    )

  return {
    "token": create_access_token(user),
    "user": repository.serialize_user(user),
  }


@app.post("/api/auth/logout")
def logout(_: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
  return {"success": True}


@app.get("/api/auth/me")
def get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
  return repository.serialize_user(current_user)


@app.get("/api/rooms/templates")
def get_room_templates() -> list[dict[str, Any]]:
  return repository.list_room_templates()


@app.post("/api/rooms/create")
def create_room(
  payload: RoomCreateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  try:
    return repository.create_room(
      owner_id=current_user["id"],
      name=payload.name,
      description=payload.description,
      is_public=payload.is_public,
      template_id=payload.templateId,
      terminal_shell=payload.terminalShell or get_default_terminal_shell(),
      dsa_language=payload.dsaLanguage or "python",
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=str(error),
    ) from error


@app.post("/api/rooms/join")
def join_room(
  payload: RoomJoinRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  try:
    return repository.join_room(
      user_id=current_user["id"],
      room_id=payload.roomId,
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error


@app.get("/api/rooms")
def get_rooms(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
  return repository.list_user_rooms(current_user["id"])


@app.get("/api/rooms/public")
def get_public_rooms() -> list[dict[str, Any]]:
  return repository.list_public_rooms()


@app.delete("/api/rooms/{room_id}")
def delete_room(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    repository.delete_room(current_user["id"], normalized_room_id)
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error
  except PermissionError as error:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=str(error),
    ) from error

  return {"success": True}


@app.get("/api/rooms/{room_id}")
def get_room(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_for_user(current_user["id"], normalized_room_id)

  if room:
    return room

  if repository.get_room_by_id(normalized_room_id) is None:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="Room not found",
    )

  raise HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="You do not have access to this room",
  )


@app.put("/api/rooms/{room_id}/settings")
def update_room_settings(
  room_id: str,
  payload: RoomSettingsUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  try:
    return repository.update_room_settings(
      user_id=current_user["id"],
      room_id=normalized_room_id,
      name=payload.name,
      description=payload.description,
      terminal_shell=payload.terminalShell,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error


@app.put("/api/rooms/{room_id}/workspace")
def save_room_workspace(
  room_id: str,
  payload: RoomWorkspaceUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.update_room_workspace(
      user_id=current_user["id"],
      room_id=normalized_room_id,
      workspace_tree=payload.tree,
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error
  except PermissionError as error:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=str(error),
    ) from error


@app.post("/api/rooms/{room_id}/run")
def run_room_file(
  room_id: str,
  payload: RoomRunRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)

  if room is None:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="Room not found",
    )

  if not repository.user_can_access_room(current_user["id"], room):
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="You do not have access to this room",
    )

  result = execute_workspace_file(
    room.get("workspace_tree", []),
    payload.filePath,
    payload.stdin or "",
  )
  repository.touch_room(normalized_room_id)
  return result


@app.post("/api/ai/gemini")
async def assist_with_gemini(
  payload: GeminiAssistRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  if payload.roomId:
    room = repository.get_room_by_id(payload.roomId)

    if room is None:
      raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Room not found",
      )

    if not repository.user_can_access_room(current_user["id"], room):
      raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this room",
      )

  try:
    active_file_path = normalize_optional_workspace_path(payload.activeFilePath)
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
      detail=str(error),
    ) from error

  prompt = build_gemini_prompt(
    payload,
    current_user=current_user,
    active_file_path=active_file_path,
  )
  answer = await request_gemini_completion(prompt)

  return {
    "answer": answer,
    "source": "gemini",
    "model": GEMINI_MODEL,
  }


@app.websocket("/api/rooms/{room_id}/collaborate")
async def collaboration_websocket(websocket: WebSocket, room_id: str, token: str):
  await websocket.accept()

  try:
    current_user = get_current_user_from_token(token)
  except HTTPException as error:
    try:
      await websocket.send_json({"type": "error", "detail": error.detail})
      await websocket.close(code=1008)
    except Exception:
      pass
    return

  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)

  if room is None:
    try:
      await websocket.send_json({"type": "error", "detail": "Room not found"})
      await websocket.close(code=1008)
    except Exception:
      pass
    return

  if not repository.user_can_access_room(current_user["id"], room):
    try:
      await websocket.send_json({"type": "error", "detail": "You do not have access to this room"})
      await websocket.close(code=1008)
    except Exception:
      pass
    return

  connection = await collaboration_manager.connect(normalized_room_id, websocket, current_user)

  try:
    initial_room = repository.get_room_for_user(current_user["id"], normalized_room_id)
    if initial_room is None:
      await websocket.send_json({"type": "error", "detail": "Room not found"})
      await websocket.close(code=1008)
      return

    await websocket.send_json(
      {
        "type": "session_ready",
        "sessionId": connection["session_id"],
        "room": initial_room,
        "presence": await collaboration_manager.list_presence(normalized_room_id),
      }
    )

    await collaboration_manager.broadcast(
      normalized_room_id,
      {
        "type": "presence_snapshot",
        "presence": await collaboration_manager.list_presence(normalized_room_id),
      },
    )

    while True:
      message = await websocket.receive_json()
      message_type = str(message.get("type", "")).strip().lower()

      if message_type == "presence_update":
        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "presence_snapshot",
            "presence": presence,
          },
        )
        continue

      if message_type == "cursor_update":
        try:
          cursor = build_cursor_payload(message)
          active_file_path = cursor["filePath"] if cursor else None
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
          cursor=cursor,
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "presence_snapshot",
            "presence": presence,
          },
        )
        continue

      if message_type == "typing_update":
        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        typing_payload = {
          "isTyping": bool(message.get("isTyping")),
          "filePath": active_file_path,
          "updatedAt": utc_now().isoformat(),
        }
        presence = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
          typing=typing_payload,
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "presence_snapshot",
            "presence": presence,
          },
        )
        continue

      if message_type == "workspace_update":
        workspace_tree = message.get("tree")

        if not isinstance(workspace_tree, list):
          await websocket.send_json(
            {
              "type": "error",
              "detail": "Workspace updates must include a valid tree payload",
            }
          )
          continue

        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
          updated_room = repository.update_room_workspace(
            user_id=current_user["id"],
            room_id=normalized_room_id,
            workspace_tree=workspace_tree,
          )
        except (PermissionError, ValueError) as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
        )

        await websocket.send_json(
          {
            "type": "workspace_ack",
            "requestId": message.get("requestId"),
            "room": updated_room,
          }
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "workspace_updated",
            "requestId": message.get("requestId"),
            "sessionId": connection["session_id"],
            "room": updated_room,
          },
          exclude_session_id=connection["session_id"],
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "presence_snapshot",
            "presence": presence,
          },
        )
        continue

      if message_type == "ping":
        await websocket.send_json({"type": "pong"})
        continue

      await websocket.send_json(
        {
          "type": "error",
          "detail": "Unsupported collaboration event",
        }
      )
  except WebSocketDisconnect:
    pass
  except Exception as error:
    logger.exception("Collaboration websocket error for room %s: %s", normalized_room_id, error)
  finally:
    await collaboration_manager.disconnect(normalized_room_id, connection["session_id"])
    await collaboration_manager.broadcast(
      normalized_room_id,
      {
        "type": "presence_snapshot",
        "presence": await collaboration_manager.list_presence(normalized_room_id),
      },
    )


@app.websocket("/api/rooms/{room_id}/terminal")
async def terminal_websocket(websocket: WebSocket, room_id: str, token: str):
    await websocket.accept()
    
    # Authenticate token manually for websocket
    try:
        current_user = get_current_user_from_token(token)
        user_id = current_user["id"]
    except Exception:
        try:
            await websocket.send_text("\r\n\x1b[31mx Authentication failed \x1b[0m\r\n")
            await websocket.close()
        except Exception:
            pass
        return

    normalized_room_id = validate_room_id_value(room_id)
    room = repository.get_room_by_id(normalized_room_id)
    if not room or not repository.user_can_access_room(user_id, room):
        try:
            await websocket.send_text("\r\n\x1b[31mx Room access denied \x1b[0m\r\n")
            await websocket.close()
        except Exception:
            pass
        return

    # Ensure physical workspace is synced first
    workspace_dir = sync_workspace_to_disk(normalized_room_id, room.get("workspace_tree", []))
    terminal_shell = room.get("terminal_shell") or get_default_terminal_shell()

    # Use pywinpty on Windows, or standard subprocess/pty on other platforms
    if os.name == "nt":
        try:
            import winpty

            git_bash = r"C:\Program Files\Git\bin\bash.exe"
            if terminal_shell == "bash" and os.path.exists(git_bash):
                proc = winpty.PtyProcess.spawn([git_bash, "--login", "-i"], cwd=workspace_dir)
            elif terminal_shell == "powershell":
                proc = winpty.PtyProcess.spawn("powershell.exe", cwd=workspace_dir)
            else:
                proc = winpty.PtyProcess.spawn("cmd.exe", cwd=workspace_dir)

            stop_event = asyncio.Event()

            async def read_from_process():
                try:
                    while not stop_event.is_set():
                        # proc.read() is blocking; run in a thread.
                        # It returns "" between bursts — that is normal, NOT EOF.
                        # It raises EOFError when the shell actually exits.
                        data = await asyncio.to_thread(proc.read, 65536)
                        if data:
                            await websocket.send_text(data)
                except EOFError:
                    # Shell process exited normally
                    pass
                except Exception as e:
                    logger.error(f"Pty read error: {e}")
                finally:
                    stop_event.set()

            async def read_from_websocket():
                try:
                    while not stop_event.is_set():
                        msg = await websocket.receive_json()
                        if msg.get("type") == "input" and "data" in msg:
                            data = msg["data"]
                            if isinstance(data, str):
                                proc.write(data)
                        elif msg.get("type") == "resize":
                            cols = msg.get("cols", 80)
                            rows = msg.get("rows", 24)
                            try:
                                proc.setwinsize(rows, cols)
                            except Exception:
                                pass
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    logger.error(f"WebSocket input error: {e}")
                finally:
                    stop_event.set()

            try:
                await asyncio.gather(
                    read_from_process(),
                    read_from_websocket(),
                )
            finally:
                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    await websocket.close()
                except Exception:
                    pass

        except ImportError:
            await websocket.send_text("\r\n\x1b[31mx Terminal requires 'pywinpty' on Windows. Run: pip install pywinpty\x1b[0m\r\n")
            await websocket.close()
            return
    else:
        # Fallback for Linux/macOS
        # We can use 'pty' module with subprocess, but since typical Unix setup uses bash natively:
        import pty
        import fcntl
        import struct
        import termios
        
        master_fd, slave_fd = pty.openpty()
        
        try:
            cmd = ["bash"] if terminal_shell == "bash" else ["sh"]
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                cwd=workspace_dir,
                preexec_fn=os.setsid
            )
            os.close(slave_fd)
        except Exception as e:
            logger.error(f"Failed to start Unix terminal process: {e}")
            await websocket.send_text(f"\r\n\x1b[31mx Failed to start terminal: {e}\x1b[0m\r\n")
            await websocket.close()
            return

        async def read_from_process():
            loop = asyncio.get_running_loop()
            try:
                while True:
                    data = await loop.run_in_executor(None, os.read, master_fd, 1024)
                    if not data:
                        break
                    await websocket.send_text(data.decode(errors='replace'))
            except OSError: # Usually when process exits
                pass
            except Exception as e:
                logger.error(f"Unix pty read error: {e}")

        async def read_from_websocket():
            try:
                while True:
                    msg = await websocket.receive_json()
                    if msg.get("type") == "input" and "data" in msg:
                        data = msg["data"]
                        if isinstance(data, str):
                            os.write(master_fd, data.encode('utf-8'))
                    elif msg.get("type") == "resize":
                        cols = msg.get("cols", 80)
                        rows = msg.get("rows", 24)
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        try:
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                        except Exception:
                            pass
            except WebSocketDisconnect:
                pass
            except Exception as e:
                logger.error(f"WebSocket input error: {e}")

        try:
            await asyncio.gather(
                read_from_process(),
                read_from_websocket()
            )
        finally:
            try:
                process.terminate()
            except Exception:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass
            try:
                await websocket.close()
            except Exception:
                pass


@app.get("/api/collaborators")
def get_collaborators(
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
  return repository.list_collaborators(current_user["id"])


@app.get("/auth/google")
async def login_google(request: Request, redirect_uri: str | None = None):
  if "google" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("google_not_configured"))

  request.session["redirect_uri"] = get_safe_redirect_uri(redirect_uri)
  redirect_url = request.url_for("auth_google_callback")
  return await oauth.google.authorize_redirect(request, redirect_url)


@app.get("/auth/google/callback")
async def auth_google_callback(request: Request):
  if "google" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("google_not_configured"))

  try:
    token = await oauth.google.authorize_access_token(request)
    profile = token.get("userinfo", {})

    email = str(profile.get("email", "")).strip().lower()
    name = str(profile.get("name", "")).strip()
    provider_user_id = str(profile.get("sub", "")).strip()

    if not email or not provider_user_id:
      raise ValueError("Google OAuth response did not include the required fields")

    username = name.split()[0] if name else email.split("@")[0]
    user = repository.upsert_oauth_user("google", provider_user_id, email, username)

    jwt_token = create_access_token(user)
    redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
    query_string = urlencode(
      {
        "token": jwt_token,
        "user": user["username"],
        "email": user["email"],
        "id": user["id"],
      }
    )
    return RedirectResponse(url=f"{redirect_uri}?{query_string}")
  except Exception as error:
    logger.exception("Google OAuth error: %s", error)
    return RedirectResponse(build_frontend_error_redirect("google_auth_failed"))


@app.get("/auth/github")
async def login_github(request: Request, redirect_uri: str | None = None):
  if "github" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("github_not_configured"))

  request.session["redirect_uri"] = get_safe_redirect_uri(redirect_uri)
  redirect_url = request.url_for("auth_github_callback")
  return await oauth.github.authorize_redirect(request, redirect_url)


@app.get("/auth/github/callback")
async def auth_github_callback(request: Request):
  if "github" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("github_not_configured"))

  try:
    token = await oauth.github.authorize_access_token(request)
    profile_response = await oauth.github.get("user", token=token)
    profile = profile_response.json()

    username = str(profile.get("login", "")).strip()
    provider_user_id = str(profile.get("id", "")).strip()
    email = str(profile.get("email", "")).strip().lower()

    if not email:
      emails_response = await oauth.github.get("user/emails", token=token)
      emails = emails_response.json()
      primary_email = next(
        (
          item.get("email", "").strip().lower()
          for item in emails
          if item.get("primary") or item.get("verified")
        ),
        "",
      )
      email = primary_email

    if not username or not provider_user_id or not email:
      raise ValueError("GitHub OAuth response did not include the required fields")

    user = repository.upsert_oauth_user("github", provider_user_id, email, username)

    jwt_token = create_access_token(user)
    redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
    query_string = urlencode(
      {
        "token": jwt_token,
        "user": user["username"],
        "email": user["email"],
        "id": user["id"],
      }
    )
    return RedirectResponse(url=f"{redirect_uri}?{query_string}")
  except Exception as error:
    logger.exception("GitHub OAuth error: %s", error)
    return RedirectResponse(build_frontend_error_redirect("github_auth_failed"))


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str) -> Any:
  if not frontend_is_built():
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  if full_path.startswith("api/"):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  asset_path = resolve_frontend_asset(full_path)
  if asset_path is not None:
    return FileResponse(asset_path)

  if Path(full_path).suffix:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  return FileResponse(CLIENT_INDEX_FILE)
