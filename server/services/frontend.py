from __future__ import annotations

from pathlib import Path
from urllib.parse import urlencode, urlparse

try:
  from ..core.settings import (
    ALLOWED_HOST_SET,
    ALLOWED_ORIGIN_SET,
    CLIENT_DIST_DIR,
    CLIENT_INDEX_FILE,
    DEFAULT_CALLBACK_URL,
    DEFAULT_FRONTEND_URL,
  )
except ImportError:
  from core.settings import (
    ALLOWED_HOST_SET,
    ALLOWED_ORIGIN_SET,
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

  # Compare against the normalized origin set so a trailing slash or a
  # FRONTEND_URL that was never repeated in ALLOWED_ORIGINS still matches.
  if parsed.scheme in {"http", "https"} and origin in ALLOWED_ORIGIN_SET:
    return redirect_uri

  return DEFAULT_CALLBACK_URL


def build_oauth_callback_url(request, provider: str) -> str:
  """Build this server's own OAuth callback URL for `provider`.

  X-Forwarded-* is attacker-controlled unless a trusted proxy rewrites it, so
  the forwarded host is only honoured when it is one we already recognise.
  """
  scheme = request.url.scheme
  host = request.url.netloc

  forwarded_host = (request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
  if forwarded_host and forwarded_host in ALLOWED_HOST_SET:
    host = forwarded_host
    forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    if forwarded_proto in {"http", "https"}:
      scheme = forwarded_proto

  return f"{scheme}://{host}/auth/{provider}/callback"


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
