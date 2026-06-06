from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode, urlparse

try:
  from ..core.settings import (
    ALLOWED_ORIGINS,
    CLIENT_DIST_DIR,
    CLIENT_INDEX_FILE,
    DEFAULT_CALLBACK_URL,
    DEFAULT_FRONTEND_URL,
  )
except ImportError:
  from core.settings import (
    ALLOWED_ORIGINS,
    CLIENT_DIST_DIR,
    CLIENT_INDEX_FILE,
    DEFAULT_CALLBACK_URL,
    DEFAULT_FRONTEND_URL,
  )


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
