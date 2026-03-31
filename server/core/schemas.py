from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

try:
  from ..database import (
    ASSIGNABLE_ROOM_ACCESS_ROLES,
    DSA_LANGUAGE_IDS,
    ROOM_TEMPLATE_DEFINITIONS,
  )
  from .security import (
    EMAIL_PATTERN,
    ROOM_ID_PATTERN,
    TEMPLATE_ID_PATTERN,
    USERNAME_PATTERN,
    normalize_invite_token,
    normalize_terminal_shell,
    normalize_workspace_path,
  )
except ImportError:
  from database import ASSIGNABLE_ROOM_ACCESS_ROLES, DSA_LANGUAGE_IDS, ROOM_TEMPLATE_DEFINITIONS
  from core.security import (
    EMAIL_PATTERN,
    ROOM_ID_PATTERN,
    TEMPLATE_ID_PATTERN,
    USERNAME_PATTERN,
    normalize_invite_token,
    normalize_terminal_shell,
    normalize_workspace_path,
  )


class LoginRequest(BaseModel):
  email: str = Field(min_length=3, max_length=254)
  password: str = Field(min_length=8, max_length=128)

  @field_validator("email")
  @classmethod
  def normalize_identifier(cls, value: str) -> str:
    normalized = value.strip()

    if "@" in normalized:
      if not EMAIL_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid email address")
      return normalized.lower()

    if not USERNAME_PATTERN.fullmatch(normalized):
      raise ValueError("Enter a valid email address or username")

    return normalized


class SignupRequest(BaseModel):
  email: str = Field(min_length=5, max_length=254)
  username: str = Field(min_length=3, max_length=32)
  password: str = Field(min_length=8, max_length=128)

  @field_validator("email")
  @classmethod
  def validate_email(cls, value: str) -> str:
    normalized = value.strip().lower()

    if not EMAIL_PATTERN.fullmatch(normalized):
      raise ValueError("Enter a valid email address")

    return normalized

  @field_validator("username")
  @classmethod
  def validate_username(cls, value: str) -> str:
    normalized = value.strip()

    if not USERNAME_PATTERN.fullmatch(normalized):
      raise ValueError("Username must be 3-32 characters and use only letters, numbers, _ and -")

    return normalized

  @field_validator("password")
  @classmethod
  def validate_password(cls, value: str) -> str:
    has_upper = any(character.isupper() for character in value)
    has_lower = any(character.islower() for character in value)
    has_number = any(character.isdigit() for character in value)
    has_special = any(not character.isalnum() for character in value)

    if not (has_upper and has_lower and has_number and has_special):
      raise ValueError(
        "Password must contain uppercase, lowercase, number, and special character",
      )

    return value


class VerifyOTPRequest(BaseModel):
  mfa_token: str = Field(min_length=32, max_length=64)
  otp: str = Field(min_length=6, max_length=6)

  @field_validator("otp")
  @classmethod
  def validate_otp(cls, value: str) -> str:
    if not value.isdigit():
      raise ValueError("OTP must be a 6-digit number")
    return value


class ResendOTPRequest(BaseModel):
  mfa_token: str = Field(min_length=32, max_length=64)


class RoomCreateRequest(BaseModel):
  name: str | None = Field(default=None, max_length=80)
  description: str | None = Field(default=None, max_length=240)
  is_public: bool = False
  templateId: str | None = Field(default="blank", max_length=40)
  terminalShell: str | None = Field(default=None, max_length=20)
  dsaLanguage: str | None = Field(default="python", max_length=20)
  requireJoinApproval: bool | None = None

  @field_validator("dsaLanguage")
  @classmethod
  def validate_dsa_language(cls, value: str | None) -> str:
    if not value:
      return "python"
    normalized = value.lower()
    if normalized not in DSA_LANGUAGE_IDS:
      raise ValueError(
        f"Unsupported DSA language. Choose from: {', '.join(sorted(DSA_LANGUAGE_IDS))}",
      )
    return normalized

  @field_validator("name", "description")
  @classmethod
  def normalize_optional_text(cls, value: str | None) -> str | None:
    if value is None:
      return None

    stripped = value.strip()
    return stripped or None

  @field_validator("templateId")
  @classmethod
  def normalize_template_id(cls, value: str | None) -> str:
    normalized = (value or "blank").strip().lower()

    if not TEMPLATE_ID_PATTERN.fullmatch(normalized) or normalized not in ROOM_TEMPLATE_DEFINITIONS:
      raise ValueError("Invalid room template")

    return normalized

  @field_validator("terminalShell")
  @classmethod
  def validate_terminal_shell(cls, value: str | None) -> str:
    return normalize_terminal_shell(value)


class RoomJoinRequest(BaseModel):
  roomId: str = Field(min_length=6, max_length=20)
  inviteToken: str | None = Field(default=None, max_length=120)

  @field_validator("roomId")
  @classmethod
  def validate_room_id(cls, value: str) -> str:
    normalized = value.strip().upper()

    if not ROOM_ID_PATTERN.fullmatch(normalized):
      raise ValueError("Room ID must be 6-20 uppercase letters or numbers")

    return normalized

  @field_validator("inviteToken")
  @classmethod
  def validate_invite_token(cls, value: str | None) -> str | None:
    return normalize_invite_token(value)


class RoomSettingsUpdateRequest(BaseModel):
  name: str | None = Field(default=None, max_length=80)
  description: str | None = Field(default=None, max_length=240)
  terminalShell: str | None = Field(default=None, max_length=20)
  requireJoinApproval: bool | None = None

  @field_validator("terminalShell")
  @classmethod
  def validate_terminal_shell(cls, value: str | None) -> str | None:
    if value is None:
      return None

    return normalize_terminal_shell(value)


class RoomJoinRequestApprovalRequest(BaseModel):
  accessRole: str | None = Field(default="editor", max_length=20)

  @field_validator("accessRole")
  @classmethod
  def validate_access_role(cls, value: str | None) -> str:
    normalized = (value or "editor").strip().lower()

    if normalized not in ASSIGNABLE_ROOM_ACCESS_ROLES:
      raise ValueError("Access role must be viewer, editor, runner, or owner")

    return normalized


class RoomMemberAccessUpdateRequest(BaseModel):
  accessRole: str = Field(min_length=4, max_length=20)

  @field_validator("accessRole")
  @classmethod
  def validate_access_role(cls, value: str) -> str:
    normalized = value.strip().lower()

    if normalized not in ASSIGNABLE_ROOM_ACCESS_ROLES:
      raise ValueError("Access role must be viewer, editor, runner, or owner")

    return normalized


class RoomWorkspaceUpdateRequest(BaseModel):
  tree: list[dict[str, Any]] = Field(default_factory=list)


class RoomRunRequest(BaseModel):
  filePath: str = Field(min_length=1, max_length=260)
  stdin: str | None = Field(default="", max_length=20_000)

  @field_validator("filePath")
  @classmethod
  def normalize_file_path(cls, value: str) -> str:
    return normalize_workspace_path(value)

  @field_validator("stdin")
  @classmethod
  def normalize_stdin(cls, value: str | None) -> str:
    return value or ""


class GeminiAssistRequest(BaseModel):
  prompt: str = Field(min_length=1, max_length=4000)
  roomId: str | None = Field(default=None, min_length=6, max_length=20)
  roomName: str | None = Field(default=None, max_length=80)
  activeFilePath: str | None = Field(default=None, max_length=260)
  activeCode: str | None = Field(default="", max_length=40_000)
  runResult: dict[str, Any] | None = None

  @field_validator("prompt")
  @classmethod
  def normalize_prompt(cls, value: str) -> str:
    normalized = value.strip()

    if not normalized:
      raise ValueError("Prompt cannot be empty")

    return normalized

  @field_validator("roomId")
  @classmethod
  def normalize_room_id(cls, value: str | None) -> str | None:
    if value is None:
      return None

    normalized = value.strip().upper()

    if not ROOM_ID_PATTERN.fullmatch(normalized):
      raise ValueError("Room ID must be 6-20 uppercase letters or numbers")

    return normalized

  @field_validator("roomName", "activeFilePath")
  @classmethod
  def normalize_optional_text(cls, value: str | None) -> str | None:
    if value is None:
      return None

    normalized = value.strip()
    return normalized or None

  @field_validator("activeCode")
  @classmethod
  def normalize_code(cls, value: str | None) -> str | None:
    if value is None:
      return None

    return value


class RunSnippetRequest(BaseModel):
  code: str = Field(max_length=100_000)
  language: str = Field(default="python", max_length=32)
  stdin: str = Field(default="", max_length=10_000)
