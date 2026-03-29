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
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(32)
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY") or secrets.token_urlsafe(32)

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
DATA_DIR.mkdir(parents=True, exist_ok=True)
WORKSPACES_DIR.mkdir(parents=True, exist_ok=True)

repository = MongoRepository(
  mongo_uri=os.getenv("MONGODB_URI", "mongodb://localhost:27017"),
  database_name=os.getenv("MONGODB_DB_NAME", "codechatter"),
  legacy_data_file=DATA_DIR / "storage.json",
)

ALLOWED_ORIGIN_SET = {
  parsed_origin
  for parsed_origin in {
    urlparse(origin).scheme and f"{urlparse(origin).scheme}://{urlparse(origin).netloc}"
    for origin in [*ALLOWED_ORIGINS, DEFAULT_FRONTEND_URL]
    if origin.strip()
  }
  if parsed_origin
}
