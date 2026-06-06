from __future__ import annotations

from typing import Any
import secrets
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status, UploadFile, File

try:
  from ..services.ai import build_gemini_prompt, request_gemini_completion
  from ..core.schemas import (
    GeminiAssistRequest,
    RoomCreateRequest,
    RoomJoinRequestApprovalRequest,
    RoomJoinRequest,
    RoomMemberAccessUpdateRequest,
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
  from ..core.settings import GEMINI_MODEL, repository
  from ..services.workspace_runtime import clear_room_workspace_snapshot, execute_code_snippet, execute_workspace_file
except ImportError:
  from services.ai import build_gemini_prompt, request_gemini_completion
  from core.schemas import (
    GeminiAssistRequest,
    RoomCreateRequest,
    RoomJoinRequestApprovalRequest,
    RoomJoinRequest,
    RoomMemberAccessUpdateRequest,
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
  from core.settings import GEMINI_MODEL, repository
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
      status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
      detail=str(error),
    ) from error

  prompt = build_gemini_prompt(
    payload,
    current_user=current_user,
    active_file_path=active_file_path,
  )
  answer = await request_gemini_completion(prompt)

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
  file: UploadFile = File(...),
  current_user: dict[str, Any] = Depends(get_current_user)
) -> dict[str, Any]:
  normalized_room_id = validate_room_id_value(room_id)
  room = repository.get_room_by_id(normalized_room_id)
  if not room or not repository.user_can_access_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

  upload_dir = Path(__file__).parent.parent / "data" / "uploads" / normalized_room_id
  upload_dir.mkdir(parents=True, exist_ok=True)
  
  file_ext = Path(file.filename).suffix if file.filename else ""
  unique_filename = f"{secrets.token_hex(8)}{file_ext}"
  file_path = upload_dir / unique_filename
  
  with open(file_path, "wb") as buffer:
    shutil.copyfileobj(file.file, buffer)
     
  return {
    "url": f"/api/uploads/{normalized_room_id}/{unique_filename}",
    "filename": file.filename,
    "size": file.size
  }
