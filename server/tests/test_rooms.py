"""Room lifecycle, access control, chat history, and uploads."""
from __future__ import annotations

import io


def create_room(client, account, **overrides):
  payload = {"name": "Test Room", "is_public": False, "templateId": "python-starter"}
  payload.update(overrides)
  response = client.post("/api/rooms/create", json=payload, headers=account["headers"])
  assert response.status_code == 200, response.text
  return response.json()


def test_create_room_seeds_template_files(client, register):
  owner = register("owner")
  room = create_room(client, owner)

  assert room["accessRole"] == "owner"
  assert room["canManage"] is True
  assert room["fileCount"] == 2  # main.py + README.md
  assert len(room["id"]) == 6


def test_each_room_gets_a_distinct_invite_token(client, register):
  owner = register("owner")
  tokens = {create_room(client, owner)["inviteToken"] for _ in range(4)}

  # A shared invite token would let one link unlock every private room.
  assert len(tokens) == 4
  assert all(tokens)


def test_private_room_is_hidden_without_an_invite(client, register):
  owner = register("owner")
  outsider = register("outsider")
  room = create_room(client, owner)

  assert client.get(f"/api/rooms/{room['id']}", headers=outsider["headers"]).status_code == 403

  joined = client.post(
    "/api/rooms/join",
    json={"roomId": room["id"]},
    headers=outsider["headers"],
  )
  assert joined.status_code == 403


def test_valid_invite_token_grants_access(client, register):
  owner = register("owner")
  guest = register("guest")
  room = create_room(client, owner)

  joined = client.post(
    "/api/rooms/join",
    json={"roomId": room["id"], "inviteToken": room["inviteToken"]},
    headers=guest["headers"],
  )
  assert joined.status_code == 200
  assert client.get(f"/api/rooms/{room['id']}", headers=guest["headers"]).status_code == 200


def test_only_an_owner_can_delete_a_room(client, register):
  owner = register("owner")
  guest = register("guest")
  room = create_room(client, owner, is_public=True)

  client.post("/api/rooms/join", json={"roomId": room["id"]}, headers=guest["headers"])

  assert client.delete(f"/api/rooms/{room['id']}", headers=guest["headers"]).status_code == 403
  assert client.delete(f"/api/rooms/{room['id']}", headers=owner["headers"]).status_code == 200


def test_viewer_role_cannot_edit_the_workspace(client, register):
  owner = register("owner")
  viewer = register("viewer")
  room = create_room(client, owner, is_public=True)

  client.post("/api/rooms/join", json={"roomId": room["id"]}, headers=viewer["headers"])
  demote = client.put(
    f"/api/rooms/{room['id']}/members/{viewer['user']['id']}/access",
    json={"accessRole": "viewer"},
    headers=owner["headers"],
  )
  assert demote.status_code == 200

  blocked = client.put(
    f"/api/rooms/{room['id']}/workspace",
    json={"tree": [{"type": "file", "name": "hack.py", "content": "print(1)"}]},
    headers=viewer["headers"],
  )
  assert blocked.status_code == 403


def test_the_last_owner_cannot_be_demoted(client, register):
  owner = register("owner")
  room = create_room(client, owner)

  response = client.put(
    f"/api/rooms/{room['id']}/members/{owner['user']['id']}/access",
    json={"accessRole": "viewer"},
    headers=owner["headers"],
  )
  assert response.status_code == 403


def test_malformed_room_ids_are_rejected(client, register):
  owner = register("owner")
  # Note: values with "/" or "." segments never reach this route; the HTTP
  # client normalises them away and the SPA catch-all answers instead. Those
  # are covered by test_spa_fallback_cannot_serve_files_outside_the_build.
  for bad_id in ("abc", "TOO-LONG-ROOM-ID-VALUE-HERE", "room!!", "ROOM%20X"):
    response = client.get(f"/api/rooms/{bad_id}", headers=owner["headers"])
    assert response.status_code in (404, 422), f"{bad_id} -> {response.status_code}"


def test_spa_fallback_cannot_serve_files_outside_the_build(client):
  from services.frontend import resolve_frontend_asset

  for escape in ("../../server/.env.local", "../../../etc/passwd", "..\\..\\secrets.txt"):
    assert resolve_frontend_asset(escape) is None, escape


def test_workspace_paths_cannot_escape_the_room(client, register):
  owner = register("owner")
  room = create_room(client, owner)

  response = client.post(
    f"/api/rooms/{room['id']}/run",
    json={"filePath": "../../../../etc/passwd"},
    headers=owner["headers"],
  )
  assert response.status_code == 422


def test_unknown_snippet_language_is_rejected(client, register):
  """A mislabelled language used to silently execute as Python."""
  owner = register("owner")
  room = create_room(client, owner)

  response = client.post(
    f"/api/rooms/{room['id']}/run-snippet",
    json={"code": "console.log(1)", "language": "not-a-language"},
    headers=owner["headers"],
  )
  assert response.status_code == 422


def test_chat_history_returns_the_most_recent_messages(client, register):
  from core.settings import repository

  owner = register("owner")
  room = create_room(client, owner)

  for index in range(250):
    repository.insert_room_message(room["id"], {"text": f"message-{index}", "sender": "owner"})

  history = client.get(f"/api/rooms/{room['id']}/messages", headers=owner["headers"])
  assert history.status_code == 200
  messages = history.json()

  assert len(messages) == 200
  # Newest window, still in chronological order.
  assert messages[0]["text"] == "message-50"
  assert messages[-1]["text"] == "message-249"


def test_message_ids_are_server_generated_and_unique(client, register):
  from core.settings import repository

  owner = register("owner")
  room = create_room(client, owner)

  # A client supplying a duplicate id must not be able to wedge the write.
  first = repository.insert_room_message(room["id"], {"text": "a", "id": "collide"})
  second = repository.insert_room_message(room["id"], {"text": "b", "id": "collide"})

  assert first["id"] != second["id"]
  assert "collide" not in (first["id"], second["id"])


def test_upload_rejects_renderable_file_types(client, register):
  """HTML/SVG served from our own origin would be stored XSS."""
  owner = register("owner")
  room = create_room(client, owner)

  for filename in ("payload.html", "payload.svg", "payload.xhtml"):
    response = client.post(
      f"/api/rooms/{room['id']}/messages/upload",
      files={"file": (filename, io.BytesIO(b"<script>alert(1)</script>"), "text/html")},
      headers=owner["headers"],
    )
    assert response.status_code == 415, filename


def test_upload_accepts_an_allowed_type_and_randomises_the_name(client, register):
  owner = register("owner")
  room = create_room(client, owner)

  response = client.post(
    f"/api/rooms/{room['id']}/messages/upload",
    files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    headers=owner["headers"],
  )

  assert response.status_code == 200
  body = response.json()
  assert body["size"] == 5
  assert body["filename"] == "notes.txt"
  # Stored name must not be attacker-chosen.
  assert "notes" not in body["url"]
  assert body["url"].startswith(f"/api/uploads/{room['id']}/")


def test_upload_is_size_capped(client, register, monkeypatch):
  import routes.rooms as rooms_routes

  owner = register("owner")
  room = create_room(client, owner)
  monkeypatch.setattr(rooms_routes, "MAX_UPLOAD_BYTES", 1024)

  response = client.post(
    f"/api/rooms/{room['id']}/messages/upload",
    files={"file": ("big.txt", io.BytesIO(b"x" * 5000), "text/plain")},
    headers=owner["headers"],
  )
  assert response.status_code == 413


def test_outsider_cannot_upload_to_a_private_room(client, register):
  owner = register("owner")
  outsider = register("outsider")
  room = create_room(client, owner)

  response = client.post(
    f"/api/rooms/{room['id']}/messages/upload",
    files={"file": ("notes.txt", io.BytesIO(b"hi"), "text/plain")},
    headers=outsider["headers"],
  )
  assert response.status_code == 403


def test_deleting_an_account_removes_its_solely_owned_rooms(client, register):
  from core.settings import repository

  owner = register("owner")
  room = create_room(client, owner)

  assert client.delete("/api/auth/account", headers=owner["headers"]).status_code == 200
  assert repository.get_room_by_id(room["id"]) is None


def test_deleting_an_account_keeps_co_owned_rooms_and_detaches_the_user(client, register):
  from core.settings import repository

  owner = register("owner")
  partner = register("partner")
  room = create_room(client, owner, is_public=True)

  client.post("/api/rooms/join", json={"roomId": room["id"]}, headers=partner["headers"])
  client.put(
    f"/api/rooms/{room['id']}/members/{partner['user']['id']}/access",
    json={"accessRole": "owner"},
    headers=owner["headers"],
  )

  client.delete("/api/auth/account", headers=owner["headers"])

  surviving = repository.get_room_by_id(room["id"])
  assert surviving is not None
  assert owner["user"]["id"] not in surviving.get("owner_ids", [])
  assert owner["user"]["id"] not in surviving.get("participant_ids", [])
