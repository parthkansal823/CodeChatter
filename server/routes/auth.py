from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

try:
  from ..core.schemas import LoginRequest, SignupRequest
  from ..core.security import (
    create_access_token,
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    hash_password,
    verify_password,
  )
  from ..core.settings import repository
except ImportError:
  from core.schemas import LoginRequest, SignupRequest
  from core.security import (
    create_access_token,
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    hash_password,
    verify_password,
  )
  from core.settings import repository

router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, Any]:
  return {
    "status": "ok",
    "database": repository.health(),
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

  return {
    "token": create_access_token(user),
    "user": repository.serialize_user(user),
  }


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


@router.get("/api/collaborators")
def get_collaborators(
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
  return repository.list_collaborators(current_user["id"])
