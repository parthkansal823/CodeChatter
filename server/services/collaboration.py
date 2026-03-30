from __future__ import annotations

import asyncio
import secrets
from typing import Any

try:
  from ..core.settings import logger
except ImportError:
  from core.settings import logger

_UNSET = object()


class CollaborationManager:
  def __init__(self) -> None:
    self._rooms: dict[str, dict[str, dict[str, Any]]] = {}
    self._lock = asyncio.Lock()

  @staticmethod
  def _serialize_connection(connection: dict[str, Any]) -> dict[str, Any]:
    return {
      "sessionId": connection["session_id"],
      "userId": connection["user_id"],
      "username": connection["username"],
      "email": connection["email"],
      "activeFilePath": connection.get("active_file_path"),
      "cursor": connection.get("cursor"),
      "typing": connection.get("typing"),
    }

  async def connect(
    self,
    room_id: str,
    websocket,
    user: dict[str, Any],
  ) -> dict[str, Any]:
    connection = {
      "session_id": secrets.token_hex(8),
      "room_id": room_id,
      "user_id": user["id"],
      "username": user["username"],
      "email": user["email"],
      "websocket": websocket,
      "active_file_path": None,
      "cursor": None,
      "typing": {
        "isTyping": False,
        "filePath": None,
        "updatedAt": None,
      },
    }

    async with self._lock:
      room_connections = self._rooms.setdefault(room_id, {})
      room_connections[connection["session_id"]] = connection

    return connection

  async def disconnect(self, room_id: str, session_id: str) -> None:
    async with self._lock:
      room_connections = self._rooms.get(room_id)
      if not room_connections:
        return

      room_connections.pop(session_id, None)

      if not room_connections:
        self._rooms.pop(room_id, None)

  async def list_presence(self, room_id: str) -> list[dict[str, Any]]:
    async with self._lock:
      room_connections = self._rooms.get(room_id, {})
      presence = [
        self._serialize_connection(connection)
        for connection in room_connections.values()
      ]

    presence.sort(key=lambda item: (item["username"].lower(), item["sessionId"]))
    return presence

  async def update_presence(
    self,
    room_id: str,
    session_id: str,
    *,
    active_file_path: str | None | object = _UNSET,
    cursor: dict[str, Any] | None | object = _UNSET,
    typing: dict[str, Any] | None | object = _UNSET,
  ) -> tuple[list[dict[str, Any]], bool]:
    async with self._lock:
      room_connections = self._rooms.get(room_id, {})
      connection = room_connections.get(session_id)

      if connection is None:
        return [], False

      changed = False

      if active_file_path is not _UNSET and connection.get("active_file_path") != active_file_path:
        connection["active_file_path"] = active_file_path
        changed = True

      if cursor is not _UNSET and connection.get("cursor") != cursor:
        connection["cursor"] = cursor
        changed = True

      if typing is not _UNSET and connection.get("typing") != typing:
        connection["typing"] = typing
        changed = True

      presence = [
        self._serialize_connection(item)
        for item in room_connections.values()
      ]

    presence.sort(key=lambda item: (item["username"].lower(), item["sessionId"]))
    return presence, changed

  async def broadcast(
    self,
    room_id: str,
    payload: dict[str, Any],
    *,
    exclude_session_id: str | None = None,
  ) -> None:
    async with self._lock:
      room_connections = list(self._rooms.get(room_id, {}).items())

    stale_session_ids: list[str] = []

    for session_id, connection in room_connections:
      if exclude_session_id and session_id == exclude_session_id:
        continue

      try:
        await connection["websocket"].send_json(payload)
      except Exception as error:
        logger.warning(
          "Could not deliver collaboration payload to session %s in room %s: %s",
          session_id,
          room_id,
          error,
        )
        stale_session_ids.append(session_id)

    if stale_session_ids:
      for session_id in stale_session_ids:
        await self.disconnect(room_id, session_id)

      updated_presence = await self.list_presence(room_id)
      if updated_presence:
        await self.broadcast(
          room_id,
          {
            "type": "presence_snapshot",
            "presence": updated_presence,
          },
        )


  async def send_to_session(
    self,
    room_id: str,
    session_id: str,
    payload: dict[str, Any],
  ) -> None:
    async with self._lock:
      room_connections = self._rooms.get(room_id, {})
      connection = room_connections.get(session_id)

    if connection is None:
      return

    try:
      await connection["websocket"].send_json(payload)
    except Exception as error:
      logger.warning(
        "Could not send to session %s in room %s: %s",
        session_id,
        room_id,
        error,
      )
      await self.disconnect(room_id, session_id)


collaboration_manager = CollaborationManager()
