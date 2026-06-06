from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, RedirectResponse

try:
  from ..services.frontend import (
    build_frontend_error_redirect,
    frontend_is_built,
    get_safe_redirect_uri,
    resolve_frontend_asset,
  )
  from ..core.security import create_access_token, decode_access_token
  from ..services.oauth import REGISTERED_OAUTH_PROVIDERS, oauth
  from ..core.settings import CLIENT_INDEX_FILE, DEFAULT_CALLBACK_URL, logger, repository
except ImportError:
  from services.frontend import (
    build_frontend_error_redirect,
    frontend_is_built,
    get_safe_redirect_uri,
    resolve_frontend_asset,
  )
  from core.security import create_access_token, decode_access_token
  from services.oauth import REGISTERED_OAUTH_PROVIDERS, oauth
  from core.settings import CLIENT_INDEX_FILE, DEFAULT_CALLBACK_URL, logger, repository

router = APIRouter()


def build_oauth_success_redirect(redirect_uri: str, user: dict[str, Any]) -> str:
  query_string = urlencode(
    {
      "token": create_access_token(user),
      "user": user["username"],
      "email": user["email"],
      "id": user["id"],
      "githubConnected": "1" if user.get("githubConnected") else "0",
      "githubUsername": user.get("githubUsername") or "",
    },
  )
  return f"{redirect_uri}?{query_string}"


def build_github_connect_redirect(redirect_uri: str, github_username: str) -> str:
  query_string = urlencode({"github_linked": "1", "githubUsername": github_username})
  return f"{redirect_uri}?{query_string}"


@router.get("/")
def home() -> Any:
  if frontend_is_built():
    return FileResponse(CLIENT_INDEX_FILE)

  return {
    "status": "server running",
    "oauthProviders": sorted(REGISTERED_OAUTH_PROVIDERS),
    "database": repository.health(),
  }


@router.get("/auth/google")
async def login_google(request: Request, redirect_uri: str | None = None):
  if "google" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("google_not_configured"))

  request.session["redirect_uri"] = get_safe_redirect_uri(redirect_uri)
  
  # ── Build callback URL with proper scheme and host ──────────────────
  # Use X-Forwarded-Proto and X-Forwarded-Host if behind a proxy
  scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
  host = request.headers.get("x-forwarded-host", request.url.netloc)
  redirect_url = f"{scheme}://{host}/auth/google/callback"
  
  return await oauth.google.authorize_redirect(request, redirect_url)


@router.get("/auth/google/callback")
async def auth_google_callback(request: Request):
  if "google" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("google_not_configured"))

  try:
    token = await oauth.google.authorize_access_token(request)
    
    # ── Fetch user profile from Google's userinfo endpoint ──────────────
    # Important: When using server_metadata_url, profile is not auto-included
    userinfo_response = await oauth.google.get(
      "https://openidconnect.googleapis.com/v1/userinfo",
      token=token
    )
    profile = userinfo_response.json()

    email = str(profile.get("email", "")).strip().lower()
    name = str(profile.get("name", "")).strip()
    provider_user_id = str(profile.get("sub", "")).strip()

    if not email or not provider_user_id:
      raise ValueError("Google OAuth response did not include the required fields")

    username = name.split()[0] if name else email.split("@")[0]
    user = repository.upsert_oauth_user("google", provider_user_id, email, username)

    redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
    return RedirectResponse(url=build_oauth_success_redirect(redirect_uri, user))
  except Exception as error:
    logger.exception("Google OAuth error: %s", error)
    return RedirectResponse(build_frontend_error_redirect("google_auth_failed"))


@router.get("/auth/github")
async def login_github(
  request: Request,
  redirect_uri: str | None = None,
  connect_token: str | None = None,
):
  if "github" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("github_not_configured"))

  request.session["redirect_uri"] = get_safe_redirect_uri(redirect_uri)
  # If connecting an existing account, store the user's current JWT
  if connect_token:
    request.session["github_connect_token"] = connect_token
  else:
    request.session.pop("github_connect_token", None)

  # ── Build callback URL with proper scheme and host ──────────────────
  # Use X-Forwarded-Proto and X-Forwarded-Host if behind a proxy
  scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
  host = request.headers.get("x-forwarded-host", request.url.netloc)
  redirect_url = f"{scheme}://{host}/auth/github/callback"
  
  return await oauth.github.authorize_redirect(request, redirect_url)


@router.get("/auth/github/callback")
async def auth_github_callback(request: Request):
  if "github" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("github_not_configured"))

  try:
    token = await oauth.github.authorize_access_token(request)
    access_token = token.get("access_token", "")

    profile_response = await oauth.github.get("user", token=token)
    profile = profile_response.json()

    github_login = str(profile.get("login", "")).strip()
    provider_user_id = str(profile.get("id", "")).strip()
    avatar_url = str(profile.get("avatar_url", "")).strip()
    email = str(profile.get("email", "")).strip().lower()

    if not email:
      emails_response = await oauth.github.get("user/emails", token=token)
      emails = emails_response.json()
      email = next(
        (
          item.get("email", "").strip().lower()
          for item in emails
          if item.get("primary") or item.get("verified")
        ),
        "",
      )

    if not github_login or not provider_user_id or not email:
      raise ValueError("GitHub OAuth response did not include the required fields")

    connect_token = request.session.pop("github_connect_token", None)

    # ── Connect-to-existing-account flow ─────────────────────────────
    if connect_token:
      try:
        payload = decode_access_token(connect_token)
        user_id = payload.get("sub") or payload.get("id") or payload.get("user_id")
        if not user_id:
          raise ValueError("Invalid connect token")
        repository.connect_oauth_to_user(
          user_id=user_id,
          provider="github",
          provider_user_id=provider_user_id,
          access_token=access_token,
          provider_username=github_login,
          provider_avatar_url=avatar_url,
        )
        redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
        return RedirectResponse(url=build_github_connect_redirect(redirect_uri, github_login))
      except Exception as connect_error:
        logger.warning("GitHub connect error: %s", connect_error)
        # Fall through to normal login flow

    # ── Normal sign-in / sign-up flow ────────────────────────────────
    user = repository.upsert_oauth_user(
      "github",
      provider_user_id,
      email,
      github_login,
      access_token=access_token,
      provider_username=github_login,
      provider_avatar_url=avatar_url,
    )

    redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
    return RedirectResponse(url=build_oauth_success_redirect(redirect_uri, user))
  except Exception as error:
    logger.exception("GitHub OAuth error: %s", error)
    return RedirectResponse(build_frontend_error_redirect("github_auth_failed"))


@router.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str) -> Any:
  if not frontend_is_built():
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  if full_path.startswith("api/"):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  asset_path = resolve_frontend_asset(full_path)
  if asset_path is not None:
    return FileResponse(asset_path)

  if "." in full_path.split("/")[-1]:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

  return FileResponse(CLIENT_INDEX_FILE)
