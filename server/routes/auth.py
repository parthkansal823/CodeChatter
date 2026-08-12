from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

try:
  from ..core.schemas import (
    LoginRequest,
    ProfileUpdateRequest,
    ResendOTPRequest,
    SignupRequest,
    VerifyOTPRequest,
  )
  from ..core.security import (
    create_access_token,
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    hash_password,
    utc_now,
    verify_password,
  )
  from ..core.settings import (
    AI_PROVIDER,
    DATA_DIR,
    ENVIRONMENT,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    MAIL_PROVIDER,
    SMTP_HOST,
    SMTP_USER,
    repository,
  )
  from ..services.ai import check_ollama
  from ..services.email import gmail_is_configured
  from ..services.oauth import REGISTERED_OAUTH_PROVIDERS
  from ..services.workspace_runtime import LANGUAGE_TOOLCHAINS, is_language_runnable
  from ..services.email import mask_email, send_otp_email
except ImportError:
  from core.schemas import (
    LoginRequest,
    ProfileUpdateRequest,
    ResendOTPRequest,
    SignupRequest,
    VerifyOTPRequest,
  )
  from core.security import (
    create_access_token,
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    hash_password,
    utc_now,
    verify_password,
  )
  from core.settings import (
    AI_PROVIDER,
    DATA_DIR,
    ENVIRONMENT,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    MAIL_PROVIDER,
    SMTP_HOST,
    SMTP_USER,
    repository,
  )
  from services.ai import check_ollama
  from services.email import gmail_is_configured
  from services.oauth import REGISTERED_OAUTH_PROVIDERS
  from services.workspace_runtime import LANGUAGE_TOOLCHAINS, is_language_runnable
  from services.email import mask_email, send_otp_email

router = APIRouter()

OTP_EXPIRY_SECONDS = 300  # 5 minutes
OTP_MAX_ATTEMPTS = 5


def _generate_otp() -> str:
  return str(secrets.randbelow(900000) + 100000)  # 100000–999999


def _hash_otp(otp: str) -> str:
  return hashlib.sha256(otp.encode()).hexdigest()


def _signed_in_response(user: dict[str, Any]) -> dict[str, Any]:
  return {
    "token": create_access_token(user),
    "user": repository.serialize_user(user),
  }


def _issue_mfa_challenge(
  challenge_type: str,
  email: str,
  user_id: str | None = None,
  pending_signup: dict | None = None,
) -> dict[str, Any]:
  otp = _generate_otp()
  otp_hash = _hash_otp(otp)
  mfa_token = secrets.token_hex(24)  # 48 hex chars
  expires_at = utc_now() + timedelta(seconds=OTP_EXPIRY_SECONDS)

  repository.store_otp_challenge(
    mfa_token=mfa_token,
    challenge_type=challenge_type,
    email=email,
    otp_hash=otp_hash,
    expires_at=expires_at,
    user_id=user_id,
    pending_signup=pending_signup,
  )

  send_otp_email(email, otp, action=challenge_type)

  return {
    "requires_mfa": True,
    "mfa_token": mfa_token,
    "masked_email": mask_email(email),
  }


@router.get("/api/health")
def health() -> dict[str, Any]:
  """Liveness only — cheap enough for a container healthcheck to hit on a loop."""
  return {
    "status": "ok",
    "database": repository.health(),
  }


@router.get("/api/health/full")
async def health_full() -> dict[str, Any]:
  """Every subsystem, with a reason whenever one is not usable.

  Separate from /api/health because this one talks to the model server and the
  filesystem: fine to open in a browser, too slow to run every 30 seconds.
  """
  checks: dict[str, Any] = {}

  # ── Database ───────────────────────────────────────────────────────────────
  try:
    database = repository.health()
    checks["database"] = {"ok": True, **database}
  except Exception as error:  # noqa: BLE001 - report any driver failure verbatim
    checks["database"] = {"ok": False, "error": str(error)}

  # ── AI assistant ───────────────────────────────────────────────────────────
  if AI_PROVIDER == "gemini":
    checks["ai"] = {
      "ok": bool(GEMINI_API_KEY),
      "provider": "gemini",
      "model": GEMINI_MODEL,
      "hint": None if GEMINI_API_KEY else "Set GEMINI_API_KEY in server/.env",
    }
  else:
    probe = await check_ollama()

    if not probe["reachable"]:
      hint = f"Start it with `ollama serve` (expected at {OLLAMA_BASE_URL})"
    elif not probe.get("modelInstalled"):
      hint = f"Run `ollama pull {OLLAMA_MODEL}`"
    else:
      hint = None

    checks["ai"] = {
      "ok": probe["reachable"] and bool(probe.get("modelInstalled")),
      "provider": "ollama",
      "model": OLLAMA_MODEL,
      "endpoint": OLLAMA_BASE_URL,
      "installedModels": probe.get("models", []),
      "hint": hint,
    }

  # ── Code runner ────────────────────────────────────────────────────────────
  runnable = sorted(lang for lang in LANGUAGE_TOOLCHAINS if is_language_runnable(lang))
  missing = sorted(set(LANGUAGE_TOOLCHAINS) - set(runnable))
  checks["codeRunner"] = {
    "ok": bool(runnable),
    "runnable": runnable,
    "unavailable": missing,
  }

  # ── Email ──────────────────────────────────────────────────────────────────
  if MAIL_PROVIDER == "gmail":
    configured = gmail_is_configured()
    checks["email"] = {
      "ok": configured,
      "provider": "gmail",
      "hint": None if configured else "Run: python scripts/gmail_authorize.py",
    }
  else:
    configured = bool(SMTP_HOST and SMTP_USER)
    checks["email"] = {
      "ok": configured,
      "provider": "smtp",
      "host": SMTP_HOST or None,
      "hint": None if configured else "Set SMTP_HOST / SMTP_USER, or switch MAIL_PROVIDER=gmail",
    }

  # ── OAuth ──────────────────────────────────────────────────────────────────
  providers = sorted(REGISTERED_OAUTH_PROVIDERS)
  checks["oauth"] = {
    "ok": bool(providers),
    "providers": providers,
    "hint": None if providers else "Set GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID to enable",
  }

  # ── Storage ────────────────────────────────────────────────────────────────
  try:
    probe_file = DATA_DIR / ".health-probe"
    probe_file.write_text("ok", encoding="utf-8")
    probe_file.unlink()
    checks["storage"] = {"ok": True, "path": str(DATA_DIR)}
  except OSError as error:
    checks["storage"] = {"ok": False, "path": str(DATA_DIR), "error": str(error)}

  degraded = [name for name, value in checks.items() if not value.get("ok")]

  return {
    "status": "ok" if not degraded else "degraded",
    "environment": ENVIRONMENT,
    "degraded": degraded,
    "checks": checks,
  }


@router.post("/api/auth/signup")
def signup(payload: SignupRequest, request: Request) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="signup",
    key=get_client_identifier(request),
    limit=6,
    window_seconds=60 * 60,
  )

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

  return _issue_mfa_challenge(
    challenge_type="signup",
    email=payload.email,
    pending_signup={
      "email": payload.email,
      "username": payload.username,
      "password_hash": password_hash,
      "password_salt": salt_hex,
    },
  )


@router.post("/api/auth/login")
def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="login",
    key=f"{get_client_identifier(request)}:{payload.email.lower()}",
    limit=10,
    window_seconds=15 * 60,
  )

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

  return _issue_mfa_challenge(
    challenge_type="login",
    email=user["email"],
    user_id=user["id"],
  )


@router.post("/api/auth/verify-otp")
def verify_otp(payload: VerifyOTPRequest, request: Request) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="verify_otp",
    key=f"{get_client_identifier(request)}:{payload.mfa_token}",
    limit=10,
    window_seconds=10 * 60,
  )

  challenge = repository.get_otp_challenge(payload.mfa_token)

  if not challenge:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="Invalid or expired verification session",
    )

  expires_at = challenge["expires_at"]
  if expires_at.tzinfo is None:
    expires_at = expires_at.replace(tzinfo=UTC)
  if utc_now() > expires_at:
    repository.delete_otp_challenge(payload.mfa_token)
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="Verification code has expired. Please sign in again",
    )

  if challenge["attempts"] >= OTP_MAX_ATTEMPTS:
    repository.delete_otp_challenge(payload.mfa_token)
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="Too many incorrect attempts. Please sign in again",
    )

  attempts = repository.increment_otp_attempts(payload.mfa_token)

  if not hmac.compare_digest(_hash_otp(payload.otp), str(challenge["otp_hash"])):
    remaining = OTP_MAX_ATTEMPTS - attempts
    if remaining <= 0:
      repository.delete_otp_challenge(payload.mfa_token)
      raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Too many incorrect attempts. Please sign in again",
      )
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining",
    )

  repository.delete_otp_challenge(payload.mfa_token)

  if challenge["type"] == "login":
    user = repository.get_user_by_id(challenge["user_id"])
    if not user:
      raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User no longer exists",
      )
    return _signed_in_response(user)

  # signup — create the user now
  pending = challenge["pending_signup"]

  # Double-check uniqueness in case of race condition
  if repository.get_user_by_email(pending["email"]):
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="This email is already registered",
    )
  if repository.get_user_by_username(pending["username"]):
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="This username is already taken",
    )

  user = repository.create_user(
    email=pending["email"],
    username=pending["username"],
    password_hash=pending["password_hash"],
    password_salt=pending["password_salt"],
  )

  return _signed_in_response(user)


@router.post("/api/auth/resend-otp")
def resend_otp(payload: ResendOTPRequest, request: Request) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="resend_otp",
    key=get_client_identifier(request),
    limit=5,
    window_seconds=10 * 60,
  )

  challenge = repository.get_otp_challenge(payload.mfa_token)

  if not challenge:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail="Invalid or expired verification session",
    )

  otp = _generate_otp()
  otp_hash = _hash_otp(otp)
  new_expires_at = utc_now() + timedelta(seconds=OTP_EXPIRY_SECONDS)

  repository.update_otp_challenge(payload.mfa_token, otp_hash, new_expires_at)
  send_otp_email(challenge["email"], otp, action=challenge["type"])

  return {"success": True, "masked_email": mask_email(challenge["email"])}


@router.post("/api/auth/logout")
def logout(_: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
  return {"success": True}


@router.delete("/api/auth/account")
def delete_account(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
  try:
    repository.delete_user_account(current_user["id"])
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error

  return {"success": True}


@router.get("/api/auth/me")
def get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
  return repository.serialize_user(current_user)


@router.put("/api/auth/profile")
def update_profile(
  payload: ProfileUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  try:
    return repository.update_user_profile(
      user_id=current_user["id"],
      avatar_hue=payload.avatarHue,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.get("/api/collaborators")
def get_collaborators(
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
  return repository.list_collaborators(current_user["id"])
