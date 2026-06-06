from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

try:
  from ..core.security import (
    build_cursor_payload,
    get_current_user_from_token,
    get_default_terminal_shell,
    normalize_optional_workspace_path,
    utc_now,
    validate_room_id_value,
    validate_websocket_origin,
  )
  from ..services.collaboration import collaboration_manager
  from ..core.settings import logger, repository
  from ..services.workspace_runtime import sync_workspace_to_disk
except ImportError:
  from core.security import (
    build_cursor_payload,
    get_current_user_from_token,
    get_default_terminal_shell,
    normalize_optional_workspace_path,
    utc_now,
    validate_room_id_value,
    validate_websocket_origin,
  )
  from services.collaboration import collaboration_manager
  from core.settings import logger, repository
  from services.workspace_runtime import sync_workspace_to_disk

router = APIRouter()


@router.websocket("/api/rooms/{room_id}/collaborate")
async def collaboration_websocket(websocket: WebSocket, room_id: str, token: str):
  connection: dict[str, Any] | None = None
  normalized_room_id: str | None = None

  try:
    validate_websocket_origin(websocket)
    current_user = get_current_user_from_token(token)
    normalized_room_id = validate_room_id_value(room_id)
    room = repository.get_room_by_id(normalized_room_id)

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

    await websocket.accept()
    connection = await collaboration_manager.connect(normalized_room_id, websocket, current_user)
    logger.info("Collaboration WebSocket established for user %s in room %s", current_user["username"], normalized_room_id)
  except HTTPException as error:
    logger.warning("Collaboration WebSocket rejection: %s", error.detail)
    try:
      await websocket.close(code=1008, reason=str(error.detail))
    except Exception:
      pass
    return
  except Exception as error:
    logger.exception("Unexpected error during collaboration WebSocket handshake: %s", error)
    try:
      await websocket.close(code=1008)
    except Exception:
      pass
    return

  try:
    initial_room = repository.get_room_for_user(current_user["id"], normalized_room_id)
    if initial_room is None:
      await websocket.send_json({"type": "error", "detail": "Room not found"})
      await websocket.close(code=1008)
      return

    await websocket.send_json(
      {
        "type": "session_ready",
        "sessionId": connection["session_id"],
        "room": initial_room,
        "presence": await collaboration_manager.list_presence(normalized_room_id),
      },
    )

    await collaboration_manager.broadcast(
      normalized_room_id,
      {
        "type": "presence_snapshot",
        "presence": await collaboration_manager.list_presence(normalized_room_id),
      },
    )

    while True:
      message = await websocket.receive_json()
      message_type = str(message.get("type", "")).strip().lower()

      if message_type == "presence_update":
        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence, changed = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
        )
        if changed:
          await collaboration_manager.broadcast(
            normalized_room_id,
            {
              "type": "presence_snapshot",
              "presence": presence,
            },
          )
        continue

      if message_type == "cursor_update":
        try:
          cursor = build_cursor_payload(message)
          active_file_path = cursor["filePath"] if cursor else None
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence, changed = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
          cursor=cursor,
        )
        if changed:
          await collaboration_manager.broadcast(
            normalized_room_id,
            {
              "type": "presence_snapshot",
              "presence": presence,
            },
          )
        continue

      if message_type == "typing_update":
        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
        except ValueError as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        typing_payload = {
          "isTyping": bool(message.get("isTyping")),
          "filePath": active_file_path,
          "updatedAt": utc_now().isoformat(),
        }
        presence, changed = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
          typing=typing_payload,
        )
        if changed:
          await collaboration_manager.broadcast(
            normalized_room_id,
            {
              "type": "presence_snapshot",
              "presence": presence,
            },
          )
        continue

      if message_type == "workspace_update":
        workspace_tree = message.get("tree")

        if not isinstance(workspace_tree, list):
          await websocket.send_json(
            {
              "type": "error",
              "detail": "Workspace updates must include a valid tree payload",
            },
          )
          continue

        try:
          active_file_path = normalize_optional_workspace_path(message.get("activeFilePath"))
          updated_room = repository.update_room_workspace(
            user_id=current_user["id"],
            room_id=normalized_room_id,
            workspace_tree=workspace_tree,
          )
        except (PermissionError, ValueError) as error:
          await websocket.send_json({"type": "error", "detail": str(error)})
          continue

        presence, changed = await collaboration_manager.update_presence(
          normalized_room_id,
          connection["session_id"],
          active_file_path=active_file_path,
        )

        await websocket.send_json(
          {
            "type": "workspace_ack",
            "requestId": message.get("requestId"),
            "room": updated_room,
          },
        )
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": "workspace_updated",
            "requestId": message.get("requestId"),
            "sessionId": connection["session_id"],
            "room": updated_room,
          },
          exclude_session_id=connection["session_id"],
        )
        if changed:
          await collaboration_manager.broadcast(
            normalized_room_id,
            {
              "type": "presence_snapshot",
              "presence": presence,
            },
          )
        continue

      if message_type == "chat_message":
        text = str(message.get("text", "")).strip()
        msg_type = message.get("msgType", "text")
        file_url = message.get("fileUrl")
        file_name = message.get("fileName")
        file_size = message.get("fileSize")

        if not text and not file_url:
          continue
          
        chat_payload = {
          "type": msg_type,
          "id": message.get("id"),
          "text": text,
          "sender": current_user["username"],
          "userId": current_user["id"],
          "fileUrl": file_url,
          "fileName": file_name,
          "fileSize": file_size,
        }
        
        # Persist to database
        saved_msg = repository.insert_room_message(normalized_room_id, chat_payload)
        saved_msg["type"] = "chat_message" # For the UI websocket event type
        saved_msg["msgType"] = chat_payload["type"]
        
        await collaboration_manager.broadcast(
          normalized_room_id,
          saved_msg
        )
        continue

      if message_type in ("video_join", "video_leave"):
        await collaboration_manager.broadcast(
          normalized_room_id,
          {
            "type": message_type,
            "fromSessionId": connection["session_id"],
            "username": current_user["username"],
          },
          exclude_session_id=connection["session_id"],
        )
        continue

      if message_type in ("video_offer", "video_answer", "video_ice_candidate"):
        target_session_id = str(message.get("targetSessionId", "")).strip()
        if not target_session_id:
          continue
        await collaboration_manager.send_to_session(
          normalized_room_id,
          target_session_id,
          {
            "type": message_type,
            "fromSessionId": connection["session_id"],
            "username": current_user["username"],
            "payload": message.get("payload"),
          },
        )
        continue

      if message_type == "ping":
        await websocket.send_json({"type": "pong"})
        continue

      await websocket.send_json(
        {
          "type": "error",
          "detail": "Unsupported collaboration event",
        },
      )
  except WebSocketDisconnect:
    pass
  except Exception as error:
    logger.exception("Collaboration websocket error for room %s: %s", normalized_room_id, error)
  finally:
    if connection and normalized_room_id:
      await collaboration_manager.disconnect(normalized_room_id, connection["session_id"])
      await collaboration_manager.broadcast(
        normalized_room_id,
        {
          "type": "presence_snapshot",
          "presence": await collaboration_manager.list_presence(normalized_room_id),
        },
      )


@router.websocket("/api/rooms/{room_id}/terminal")
async def terminal_websocket(websocket: WebSocket, room_id: str, token: str):
  try:
    validate_websocket_origin(websocket)
    current_user = get_current_user_from_token(token)
    user_id = current_user["id"]
    normalized_room_id = validate_room_id_value(room_id)
  except Exception:
    try:
      await websocket.close(code=1008)
    except Exception:
      pass
    return

  await websocket.accept()

  try:
    room = repository.get_room_by_id(normalized_room_id)
    if not room or not repository.user_can_run_room(user_id, room):
      await websocket.send_text("\r\n\x1b[31mx Terminal requires at least runner access in this workspace \x1b[0m\r\n")
      await websocket.close()
      return
  except Exception:
    try:
      await websocket.send_text("\r\n\x1b[31mx Authentication failed \x1b[0m\r\n")
      await websocket.close()
    except Exception:
      pass
    return

  workspace_dir = sync_workspace_to_disk(normalized_room_id, room.get("workspace_tree", []))
  terminal_shell = room.get("terminal_shell") or get_default_terminal_shell()

  if os.name == "nt":
    try:
      import winpty

      git_bash = r"C:\Program Files\Git\bin\bash.exe"
      if terminal_shell == "bash" and os.path.exists(git_bash):
        proc = winpty.PtyProcess.spawn([git_bash, "--login", "-i"], cwd=workspace_dir)
      elif terminal_shell == "powershell":
        proc = winpty.PtyProcess.spawn("powershell.exe", cwd=workspace_dir)
      else:
        proc = winpty.PtyProcess.spawn("cmd.exe", cwd=workspace_dir)

      stop_event = asyncio.Event()

      async def read_from_process():
        try:
          while not stop_event.is_set():
            data = await asyncio.to_thread(proc.read, 65536)
            if data:
              await websocket.send_text(data)
        except EOFError:
          pass
        except Exception as error:
          logger.error("Pty read error: %s", error)
        finally:
          stop_event.set()

      async def read_from_websocket():
        try:
          while not stop_event.is_set():
            msg = await websocket.receive_json()
            if msg.get("type") == "input" and "data" in msg:
              data = msg["data"]
              if isinstance(data, str):
                proc.write(data)
            elif msg.get("type") == "resize":
              cols = msg.get("cols", 80)
              rows = msg.get("rows", 24)
              try:
                proc.setwinsize(rows, cols)
              except Exception:
                pass
        except WebSocketDisconnect:
          pass
        except Exception as error:
          logger.error("WebSocket input error: %s", error)
        finally:
          stop_event.set()

      try:
        await asyncio.gather(
          read_from_process(),
          read_from_websocket(),
        )
      finally:
        try:
          proc.terminate()
        except Exception:
          pass
        try:
          await websocket.close()
        except Exception:
          pass

    except ImportError:
      await websocket.send_text(
        "\r\n\x1b[31mx Terminal requires 'pywinpty' on Windows. Run: pip install pywinpty\x1b[0m\r\n",
      )
      await websocket.close()
      return
  else:
    import fcntl
    import pty
    import struct
    import termios

    master_fd, slave_fd = pty.openpty()

    try:
      cmd = ["bash"] if terminal_shell == "bash" else ["sh"]
      process = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=workspace_dir,
        preexec_fn=os.setsid,
      )
      os.close(slave_fd)
    except Exception as error:
      logger.error("Failed to start Unix terminal process: %s", error)
      await websocket.send_text(f"\r\n\x1b[31mx Failed to start terminal: {error}\x1b[0m\r\n")
      await websocket.close()
      return

    async def read_from_process():
      loop = asyncio.get_running_loop()
      try:
        while True:
          data = await loop.run_in_executor(None, os.read, master_fd, 1024)
          if not data:
            break
          await websocket.send_text(data.decode(errors="replace"))
      except OSError:
        pass
      except Exception as error:
        logger.error("Unix pty read error: %s", error)

    async def read_from_websocket():
      try:
        while True:
          msg = await websocket.receive_json()
          if msg.get("type") == "input" and "data" in msg:
            data = msg["data"]
            if isinstance(data, str):
              os.write(master_fd, data.encode("utf-8"))
          elif msg.get("type") == "resize":
            cols = msg.get("cols", 80)
            rows = msg.get("rows", 24)
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            try:
              fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
            except Exception:
              pass
      except WebSocketDisconnect:
        pass
      except Exception as error:
        logger.error("WebSocket input error: %s", error)

    try:
      await asyncio.gather(
        read_from_process(),
        read_from_websocket(),
      )
    finally:
      try:
        process.terminate()
      except Exception:
        pass
      try:
        os.close(master_fd)
      except OSError:
        pass
      try:
        await websocket.close()
      except Exception:
        pass
