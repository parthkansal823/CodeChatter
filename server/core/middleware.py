from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

try:
  from .settings import ALLOWED_ORIGINS, ENVIRONMENT, SESSION_SECRET_KEY
except ImportError:
  from core.settings import ALLOWED_ORIGINS, ENVIRONMENT, SESSION_SECRET_KEY


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
  async def dispatch(self, request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(self), camera=(self)"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    response.headers["Content-Security-Policy"] = (
      "default-src 'self'; "
      "script-src 'self' https://accounts.google.com; "
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
      "img-src 'self' data: blob: https:; "
      "font-src 'self' data: https://fonts.gstatic.com https://cdn.tldraw.com; "
      "connect-src 'self' wss: ws: https://cdn.tldraw.com; "
      "worker-src 'self' blob:; "
      "child-src 'self' blob:; "
      "frame-src 'self' https://accounts.google.com; "
      "object-src 'none'; "
      "base-uri 'self';"
    )

    if ENVIRONMENT == "production":
      response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    return response


def configure_middleware(app: FastAPI) -> None:
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
