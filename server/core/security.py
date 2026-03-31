from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import math
import os
from pathlib import PurePosixPath
import re
from threading import Lock
import time
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException, Request, WebSocket, status
from jose import JWTError, jwt

try:
  from .settings import (
    ALLOWED_ORIGIN_SET,
    ENVIRONMENT,
    JWT_ALGORITHM,
    JWT_EXPIRATION_DAYS,
    SECRET_KEY,
    repository,
  )
except ImportError:
  from core.settings import (
    ALLOWED_ORIGIN_SET,
    ENVIRONMENT,
    JWT_ALGORITHM,
    JWT_EXPIRATION_DAYS,
    SECRET_KEY,
    repository,
  )

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{3,32}$")
ROOM_ID_PATTERN = re.compile(r"^[A-Z0-9]{6,20}$")
TEMPLATE_ID_PATTERN = re.compile(r"^[a-z0-9-]{3,40}$")
TERMINAL_SHELL_PATTERN = re.compile(r"^(bash|powershell|cmd|sh)$")
INVITE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{12,120}$")


class SlidingWindowRateLimiter:
  def __init__(self) -> None:
    self._requests: dict[str, deque[float]] = defaultdict(deque)
    self._lock = Lock()

  def hit(self, key: str, *, limit: int, window_seconds: int) -> float | None:
    now = time.monotonic()

    with self._lock:
      attempts = self._requests[key]

      while attempts and now - attempts[0] >= window_seconds:
        attempts.popleft()

      if len(attempts) >= limit:
        retry_after = max(0.0, window_seconds - (now - attempts[0]))
        return retry_after

      attempts.append(now)
      return None


rate_limiter = SlidingWindowRateLimiter()


def utc_now() -> datetime:
  return datetime.now(timezone.utc)


def get_default_terminal_shell() -> str:
  return "powershell" if os.name == "nt" else "bash"


def normalize_terminal_shell(value: str | None) -> str:
  normalized = (value or get_default_terminal_shell()).strip().lower()

  if not TERMINAL_SHELL_PATTERN.fullmatch(normalized):
    raise ValueError("Unsupported terminal shell")

  return normalized


def normalize_invite_token(value: str | None) -> str | None:
  if value is None:
    return None

  normalized = value.strip()

  if not normalized:
    return None

  if not INVITE_TOKEN_PATTERN.fullmatch(normalized):
    raise ValueError("Invalid invite token")

  return normalized


def get_client_identifier(request: Request) -> str:
  forwarded_for = request.headers.get("x-forwarded-for", "")
  if forwarded_for:
    first_hop = forwarded_for.split(",")[0].strip()
    if first_hop:
      return first_hop

  return request.client.host if request.client else "unknown-client"


def enforce_rate_limit(*, bucket: str, key: str, limit: int, window_seconds: int) -> None:
  retry_after = rate_limiter.hit(
    f"{bucket}:{key}",
    limit=limit,
    window_seconds=window_seconds,
  )

  if retry_after is not None:
    retry_seconds = max(1, math.ceil(retry_after))
    raise HTTPException(
      status_code=status.HTTP_429_TOO_MANY_REQUESTS,
      detail=f"Too many requests. Try again in {retry_seconds} seconds.",
    )


def is_allowed_origin(origin: str | None) -> bool:
  if not origin:
    return ENVIRONMENT != "production"

  parsed_origin = urlparse(origin)
  normalized_origin = f"{parsed_origin.scheme}://{parsed_origin.netloc}".rstrip("/")
  return normalized_origin in ALLOWED_ORIGIN_SET


def validate_websocket_origin(websocket: WebSocket) -> None:
  origin = websocket.headers.get("origin")

  if is_allowed_origin(origin):
    return

  raise HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="WebSocket origin is not allowed",
  )


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
  salt = bytes.fromhex(salt_hex) if salt_hex else os.urandom(16)
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


def decode_access_token(token: str) -> dict[str, Any]:
  """Decode a JWT without fetching the user from the database."""
  try:
    return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
  except JWTError as error:
    raise ValueError("Invalid or expired token") from error


def normalize_workspace_path(value: str) -> str:
  raw_value = value.strip().replace("\\", "/")
  path = PurePosixPath(raw_value)

  if path.is_absolute():
    raise ValueError("Workspace paths must be relative")

  parts = [part for part in path.parts if part not in {"", "."}]

  if not parts or any(part == ".." for part in parts):
    raise ValueError("Invalid workspace path")

  return "/".join(parts)


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
