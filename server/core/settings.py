from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

try:
  from ..database import MongoRepository
except ImportError:
  from database import MongoRepository

CORE_DIR = Path(__file__).resolve().parent
APP_DIR = CORE_DIR.parent
load_dotenv(APP_DIR / ".env.local")
load_dotenv(APP_DIR / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("codechatter.server")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_EXPIRATION_DAYS = int(os.getenv("JWT_EXPIRATION_DAYS", "7"))


def _require_secret(name: str) -> str:
  """Read a signing secret, generating an ephemeral one only outside production.

  A generated key changes on every restart and differs between workers, which
  silently invalidates every issued token. That is tolerable locally and a
  serious outage in production, so production must supply the value.
  """
  configured = (os.getenv(name) or "").strip()

  if configured:
    return configured

  if ENVIRONMENT == "production":
    raise RuntimeError(
      f"{name} must be set when ENVIRONMENT=production. "
      'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )

  logger.warning(
    "%s is not set — using a random key for this process. Sessions will not survive a restart.",
    name,
  )
  return secrets.token_urlsafe(32)


SECRET_KEY = _require_secret("SECRET_KEY")
SESSION_SECRET_KEY = _require_secret("SESSION_SECRET_KEY")

ALLOWED_ORIGINS = [
  origin.strip()
  for origin in os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000",
  ).split(",")
  if origin.strip()
]
DEFAULT_FRONTEND_URL = os.getenv(
  "FRONTEND_URL",
  ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "http://localhost:5173",
)
DEFAULT_CALLBACK_URL = f"{DEFAULT_FRONTEND_URL.rstrip('/')}/auth/callback"

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER
SMTP_TIMEOUT_SECONDS = float(os.getenv("SMTP_TIMEOUT_SECONDS", "5"))

RUN_TIMEOUT_SECONDS = int(os.getenv("CODE_RUN_TIMEOUT_SECONDS", "15"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30"))
GEMINI_API_BASE_URL = os.getenv(
  "GEMINI_API_BASE_URL",
  "https://generativelanguage.googleapis.com/v1beta",
).rstrip("/")

CLIENT_DIST_DIR = APP_DIR.parent / "client" / "dist"
CLIENT_INDEX_FILE = CLIENT_DIST_DIR / "index.html"
DATA_DIR = Path(os.getenv("CODECHATTER_DATA_DIR", str(APP_DIR / "data"))).resolve()
WORKSPACES_DIR = DATA_DIR / "workspaces"
UPLOADS_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)
WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Chat attachment limits. Uploads are served back from the API origin, so the
# extension allow-list deliberately excludes anything a browser will render as
# markup (.html, .svg, ...) — those would be stored XSS against our own origin.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_UPLOAD_EXTENSIONS = {
  ".txt", ".md", ".log", ".csv", ".json", ".yaml", ".yml", ".toml",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".tgz", ".7z",
  ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".c", ".h",
  ".cpp", ".cc", ".hpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt",
  ".sh", ".lua", ".pl", ".sql", ".css", ".scss", ".ipynb",
}

repository = MongoRepository(
  mongo_uri=os.getenv("MONGODB_URI", "mongodb://localhost:27017"),
  database_name=os.getenv("MONGODB_DB_NAME", "codechatter"),
  legacy_data_file=DATA_DIR / "storage.json",
)

def normalize_origin(value: str | None) -> str | None:
  """Reduce a URL to its `scheme://host[:port]` origin, or None if unusable."""
  if not value or not value.strip():
    return None

  parsed = urlparse(value.strip())

  if not parsed.scheme or not parsed.netloc:
    return None

  return f"{parsed.scheme}://{parsed.netloc}"


ALLOWED_ORIGIN_SET = {
  origin
  for origin in (
    normalize_origin(candidate) for candidate in [*ALLOWED_ORIGINS, DEFAULT_FRONTEND_URL]
  )
  if origin
}

# Hostnames (with optional port) we are willing to build absolute callback URLs
# for. Used to reject spoofed X-Forwarded-Host headers.
ALLOWED_HOST_SET = {urlparse(origin).netloc for origin in ALLOWED_ORIGIN_SET}
