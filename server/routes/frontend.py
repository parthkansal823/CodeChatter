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
  from ..core.security import create_access_token
  from ..services.oauth import REGISTERED_OAUTH_PROVIDERS, oauth
  from ..core.settings import CLIENT_INDEX_FILE, DEFAULT_CALLBACK_URL, logger, repository
except ImportError:
  from services.frontend import (
    build_frontend_error_redirect,
    frontend_is_built,
    get_safe_redirect_uri,
    resolve_frontend_asset,
  )
  from core.security import create_access_token
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
    },
  )
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
  redirect_url = request.url_for("auth_google_callback")
  return await oauth.google.authorize_redirect(request, redirect_url)


@router.get("/auth/google/callback")
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

    redirect_uri = request.session.get("redirect_uri", DEFAULT_CALLBACK_URL)
    return RedirectResponse(url=build_oauth_success_redirect(redirect_uri, user))
  except Exception as error:
    logger.exception("Google OAuth error: %s", error)
    return RedirectResponse(build_frontend_error_redirect("google_auth_failed"))


@router.get("/auth/github")
async def login_github(request: Request, redirect_uri: str | None = None):
  if "github" not in REGISTERED_OAUTH_PROVIDERS:
    return RedirectResponse(build_frontend_error_redirect("github_not_configured"))

  request.session["redirect_uri"] = get_safe_redirect_uri(redirect_uri)
  redirect_url = request.url_for("auth_github_callback")
  return await oauth.github.authorize_redirect(request, redirect_url)


@router.get("/auth/github/callback")
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
      email = next(
        (
          item.get("email", "").strip().lower()
          for item in emails
          if item.get("primary") or item.get("verified")
        ),
        "",
      )

    if not username or not provider_user_id or not email:
      raise ValueError("GitHub OAuth response did not include the required fields")

    user = repository.upsert_oauth_user("github", provider_user_id, email, username)

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
