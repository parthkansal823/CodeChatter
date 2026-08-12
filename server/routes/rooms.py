from __future__ import annotations

import secrets
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

try:
  from ..core.schemas import (
    GeminiAssistRequest,
    RoomCreateRequest,
    RoomJoinRequest,
    RoomJoinRequestApprovalRequest,
    RoomMemberAccessUpdateRequest,
    RoomMemberInviteRequest,
    RoomRunRequest,
    RoomSettingsUpdateRequest,
    RoomWorkspaceUpdateRequest,
    RunSnippetRequest,
  )
  from ..core.security import (
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    get_default_terminal_shell,
    normalize_optional_workspace_path,
    validate_room_id_value,
  )
  from ..core.settings import (
    ALLOWED_UPLOAD_EXTENSIONS,
    DEFAULT_FRONTEND_URL,
    GEMINI_MODEL,
    MAX_UPLOAD_BYTES,
    UPLOADS_DIR,
    repository,
  )
  from ..services.ai import build_gemini_prompt, request_ai_completion
  from ..services.email import send_room_share_email
  from ..services.workspace_runtime import clear_room_workspace_snapshot, execute_code_snippet, execute_workspace_file
except ImportError:
  from core.schemas import (
    GeminiAssistRequest,
    RoomCreateRequest,
    RoomJoinRequest,
    RoomJoinRequestApprovalRequest,
    RoomMemberAccessUpdateRequest,
    RoomMemberInviteRequest,
    RoomRunRequest,
    RoomSettingsUpdateRequest,
    RoomWorkspaceUpdateRequest,
    RunSnippetRequest,
  )
  from core.security import (
    enforce_rate_limit,
    get_client_identifier,
    get_current_user,
    get_default_terminal_shell,
    normalize_optional_workspace_path,
    validate_room_id_value,
  )
  from core.settings import (
    ALLOWED_UPLOAD_EXTENSIONS,
    DEFAULT_FRONTEND_URL,
    GEMINI_MODEL,
    MAX_UPLOAD_BYTES,
    UPLOADS_DIR,
    repository,
  )
  from services.ai import build_gemini_prompt, request_ai_completion
  from services.email import send_room_share_email
  from services.workspace_runtime import clear_room_workspace_snapshot, execute_code_snippet, execute_workspace_file

router = APIRouter()


@router.get("/api/rooms/templates")
def get_room_templates() -> list[dict[str, Any]]:
  return repository.list_room_templates()


@router.post("/api/rooms/create")
def create_room(
  payload: RoomCreateRequest,
  request: Request,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="room-create",
    key=f"{current_user['id']}:{get_client_identifier(request)}",
    limit=12,
    window_seconds=60,
  )

  try:
    return repository.create_room(
      owner_id=current_user["id"],
      name=payload.name,
      description=payload.description,
      is_public=payload.is_public,
      template_id=payload.templateId,
      terminal_shell=payload.terminalShell or get_default_terminal_shell(),
      dsa_language=payload.dsaLanguage or "python",
      require_join_approval=payload.requireJoinApproval,
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=str(error),
    ) from error


@router.post("/api/rooms/join")
def join_room(
  payload: RoomJoinRequest,
  request: Request,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="room-join",
    key=f"{current_user['id']}:{get_client_identifier(request)}",
    limit=25,
    window_seconds=60,
  )

  try:
    return repository.join_room(
      user_id=current_user["id"],
      room_id=payload.roomId,
      invite_token=payload.inviteToken,
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error
  except PermissionError as error:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=str(error),
    ) from error


@router.get("/api/rooms")
def get_rooms(current_user: dict[str, Any] = Depends(get_current_user)) -> list[dict[str, Any]]:
  return repository.list_user_rooms(current_user["id"])


@router.get("/api/rooms/public")
def get_public_rooms() -> list[dict[str, Any]]:
  return repository.list_public_rooms()


@router.delete("/api/rooms/{room_id}")
def delete_room(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    repository.delete_room(current_user["id"], normalized_room_id)
    clear_room_workspace_snapshot(normalized_room_id)
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error
  except PermissionError as error:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=str(error),
    ) from error

  return {"success": True}


@router.get("/api/rooms/{room_id}")
def get_room(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_for_user(current_user["id"], normalized_room_id)

  if room:
    return room

  if repository.get_room_by_id(normalized_room_id) is None:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="Room not found",
    )

  raise HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="You do not have access to this room",
  )


@router.get("/api/rooms/{room_id}/join-status")
def get_room_join_status(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.get_room_join_status(current_user["id"], normalized_room_id)
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@router.put("/api/rooms/{room_id}/settings")
def update_room_settings(
  room_id: str,
  payload: RoomSettingsUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  try:
    return repository.update_room_settings(
      user_id=current_user["id"],
      room_id=normalized_room_id,
      name=payload.name,
      description=payload.description,
      terminal_shell=payload.terminalShell,
      require_join_approval=payload.requireJoinApproval,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error


@router.put("/api/rooms/{room_id}/workspace")
def save_room_workspace(
  room_id: str,
  payload: RoomWorkspaceUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.update_room_workspace(
      user_id=current_user["id"],
      room_id=normalized_room_id,
      workspace_tree=payload.tree,
    )
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=str(error),
    ) from error
  except PermissionError as error:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=str(error),
    ) from error


@router.post("/api/rooms/{room_id}/run")
def run_room_file(
  room_id: str,
  payload: RoomRunRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="room-run",
    key=current_user["id"],
    limit=20,
    window_seconds=60,
  )

  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)

  if room is None:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="Room not found",
    )

  if not repository.user_can_run_room(current_user["id"], room):
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="You need at least runner access to execute files in this room",
    )

  result = execute_workspace_file(
    room.get("workspace_tree", []),
    payload.filePath,
    payload.stdin or "",
  )
  repository.touch_room(normalized_room_id)
  return result


@router.post("/api/rooms/{room_id}/run-snippet")
def run_snippet(
  room_id: str,
  payload: RunSnippetRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  """Execute a code snippet directly (used by notebook cells)."""
  enforce_rate_limit(
    bucket="room-run",
    key=current_user["id"],
    limit=20,
    window_seconds=60,
  )

  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)

  if room is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

  if not repository.user_can_run_room(current_user["id"], room):
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="You need at least runner access to execute code in this room",
    )

  result = execute_code_snippet(
    payload.code,
    payload.language,
    payload.stdin or "",
  )
  repository.touch_room(normalized_room_id)
  return result


@router.post("/api/ai/gemini")
async def assist_with_gemini(
  payload: GeminiAssistRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="ai-assist",
    key=current_user["id"],
    limit=12,
    window_seconds=60,
  )

  if payload.roomId:
    room = repository.get_room_by_id(payload.roomId)

    if room is None:
      raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Room not found",
      )

    if not repository.user_can_access_room(current_user["id"], room):
      raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this room",
      )

  try:
    active_file_path = normalize_optional_workspace_path(payload.activeFilePath)
  except ValueError as error:
    raise HTTPException(
      status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
      detail=str(error),
    ) from error

  prompt = build_gemini_prompt(
    payload,
    current_user=current_user,
    active_file_path=active_file_path,
  )
  answer = await request_ai_completion(prompt)

  return {
    "answer": answer,
    "source": "gemini",
    "model": GEMINI_MODEL,
  }


@router.post("/api/rooms/{room_id}/join-requests/{request_id}/approve")
def approve_join_request(
  room_id: str,
  request_id: str,
  payload: RoomJoinRequestApprovalRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.approve_room_join_request(
      owner_id=current_user["id"],
      room_id=normalized_room_id,
      request_id=request_id,
      access_role=payload.accessRole,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error


@router.post("/api/rooms/{room_id}/join-requests/{request_id}/reject")
def reject_join_request(
  room_id: str,
  request_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.reject_room_join_request(
      owner_id=current_user["id"],
      room_id=normalized_room_id,
      request_id=request_id,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error


@router.post("/api/rooms/{room_id}/members", status_code=status.HTTP_201_CREATED)
def add_room_member(
  room_id: str,
  payload: RoomMemberInviteRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    room, invited_user = repository.add_room_member_by_email(
      owner_id=current_user["id"],
      room_id=normalized_room_id,
      email=payload.email,
      access_role=payload.accessRole,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error

  # Access is already granted at this point. A dead SMTP server should not undo
  # that, so delivery failure is reported alongside the success, not raised.
  email_sent = send_room_share_email(
    to_email=invited_user["email"],
    inviter_name=current_user.get("username") or "Someone",
    room_name=room.get("name") or "a workspace",
    room_url=f"{DEFAULT_FRONTEND_URL.rstrip('/')}/room/{normalized_room_id}",
    access_role=payload.accessRole,
  )

  return {"room": room, "emailSent": email_sent}


@router.put("/api/rooms/{room_id}/members/{member_id}/access")
def update_member_access(
  room_id: str,
  member_id: str,
  payload: RoomMemberAccessUpdateRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)

  try:
    return repository.update_room_member_access(
      owner_id=current_user["id"],
      room_id=normalized_room_id,
      member_id=member_id,
      access_role=payload.accessRole,
    )
  except ValueError as error:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
  except PermissionError as error:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error

@router.get("/api/rooms/{room_id}/messages")
def get_room_messages(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)
  if not room or not repository.user_can_access_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
  return repository.get_room_messages(normalized_room_id)


@router.post("/api/rooms/{room_id}/messages/upload")
def upload_room_message_file(
  room_id: str,
  request: Request,
  file: UploadFile = File(...),
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
  enforce_rate_limit(
    bucket="room-upload",
    key=f"{current_user['id']}:{get_client_identifier(request)}",
    limit=20,
    window_seconds=60,
  )

  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)
  if not room or not repository.user_can_access_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

  original_name = (file.filename or "").strip()
  file_ext = PurePosixPath(original_name.replace("\\", "/")).suffix.lower()

  if file_ext not in ALLOWED_UPLOAD_EXTENSIONS:
    raise HTTPException(
      status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
      detail=f"`{file_ext or 'files without an extension'}` cannot be shared in room chat.",
    )

  upload_dir = UPLOADS_DIR / normalized_room_id
  upload_dir.mkdir(parents=True, exist_ok=True)

  unique_filename = f"{secrets.token_hex(8)}{file_ext}"
  file_path = upload_dir / unique_filename

  # Copy in bounded chunks so an oversized body is rejected while streaming
  # rather than after it has already filled the disk.
  written = 0
  try:
    with open(file_path, "wb") as buffer:
      while chunk := file.file.read(64 * 1024):
        written += len(chunk)
        if written > MAX_UPLOAD_BYTES:
          raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Files must be {MAX_UPLOAD_BYTES // (1024 * 1024)} MB or smaller.",
          )
        buffer.write(chunk)
  except BaseException:
    file_path.unlink(missing_ok=True)
    raise

  return {
    "url": f"/api/uploads/{normalized_room_id}/{unique_filename}",
    "filename": Path(original_name).name or unique_filename,
    "size": written,
  }
