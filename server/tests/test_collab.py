"""The CRDT document: concurrent edits must merge, not overwrite."""
from __future__ import annotations

from pycrdt import Doc, Map, Text


def _text(doc: Doc) -> Map:
  return doc.get("files", type=Map)


def test_two_peers_editing_the_same_file_both_survive():
  """The property the old last-write-wins path could not provide."""
  server = Doc()
  alice = Doc()
  bob = Doc()

  _text(server)["main.py"] = "print(1)\n"
  state = server.get_update()
  alice.apply_update(state)
  bob.apply_update(state)

  # Both edit the same document without seeing each other first.
  _text(alice)["notes.md"] = Text("alice was here")
  _text(bob)["test.txt"] = Text("bob was here")

  alice_update = alice.get_update()
  bob_update = bob.get_update()

  # Exchange in the worst order: each applies the other's work last.
  server.apply_update(alice_update)
  server.apply_update(bob_update)

  merged = _text(server)
  assert str(merged["main.py"]) == "print(1)\n"
  assert str(merged["notes.md"]) == "alice was here"
  assert str(merged["test.txt"]) == "bob was here"


def test_a_late_joiner_receives_the_whole_document():
  server = Doc()
  _text(server)["a.py"] = Text("first")
  _text(server)["b.py"] = Text("second")

  latecomer = Doc()
  latecomer.apply_update(server.get_update())

  assert {k: str(v) for k, v in _text(latecomer).items()} == {"a.py": "first", "b.py": "second"}


def test_updates_are_deltas_not_whole_documents():
  """The reason typing feels instant: the wire payload stays small."""
  doc = Doc()
  files = _text(doc)

  # A file big enough that a full-document payload would be obvious.
  files["big.py"] = Text("x = 1\n" * 5000)
  full_size = len(doc.get_update())

  before = doc.get_state()
  # Mutate the Text in place. Reassigning files["big.py"] would replace the map
  # entry and ship the whole file again — which is what the old path did.
  text = files["big.py"]
  text += "y = 2\n"
  delta_size = len(doc.get_update(before))

  assert full_size > 20_000, "the fixture should be large enough to be meaningful"
  assert delta_size < 500, f"a one-line edit produced {delta_size} bytes"


def test_seeding_flattens_a_nested_workspace_tree():
  from services.collab import RoomDoc

  room = RoomDoc("TESTRM")
  room.seed_from_tree(
    [
      {"type": "file", "name": "main.py", "content": "print(1)"},
      {
        "type": "folder",
        "name": "src",
        "children": [{"type": "file", "name": "app.js", "content": "console.log(1)"}],
      },
    ],
  )

  assert room.snapshot() == {"main.py": "print(1)", "src/app.js": "console.log(1)"}


# ── The websocket endpoint, end to end ────────────────────────────────────────
#
# These speak the real y-protocol over the real route, using the library's own
# framing helpers rather than slicing bytes by hand — a test that parses the
# wire format itself only proves my parsing matches my parsing.


def _open(socket, doc):
  """Perform the client half of the handshake and return the synced doc."""
  from pycrdt import create_sync_message, handle_sync_message

  socket.send_bytes(create_sync_message(doc))
  reply = socket.receive_bytes()
  handle_sync_message(reply[1:], doc)
  return doc


def _push(socket, doc, before):
  """Send everything this doc has learned since `before`."""
  from pycrdt import create_update_message

  socket.send_bytes(create_update_message(doc.get_update(before)))


def _pull_until(socket, doc, path, limit=5):
  """Read frames until `path` shows up, or give up.

  More than one frame can be waiting: the server may answer our own push before
  it relays a peer's, so reading exactly one frame is a race the test would
  lose intermittently.
  """
  from pycrdt import Map, handle_sync_message

  for _ in range(limit):
    handle_sync_message(socket.receive_bytes()[1:], doc)

    if path in doc.get("files", type=Map):
      return True

  return False


def _files(doc):
  from pycrdt import Map

  return {key: str(value) for key, value in doc.get("files", type=Map).items()}


def _create_room(client, account, **overrides):
  payload = {"name": "Live", "is_public": False, "templateId": "blank"}
  payload.update(overrides)
  response = client.post("/api/rooms/create", json=payload, headers=account["headers"])
  assert response.status_code == 200, response.text
  return response.json()


def test_two_clients_type_at_once_and_neither_loses_work(client, register):
  """The whole point of the change, exercised through the real socket."""
  from pycrdt import Doc, Map, Text

  owner = register("owner")
  room = _create_room(client, owner)
  url = f"/api/rooms/{room['id']}/crdt?token={owner['token']}"

  with client.websocket_connect(url) as alice_ws, client.websocket_connect(url) as bob_ws:
    alice = _open(alice_ws, Doc())
    bob = _open(bob_ws, Doc())

    alice_before = alice.get_state()
    bob_before = bob.get_state()

    # Neither has seen the other's edit when it is made.
    alice.get("files", type=Map)["a.py"] = Text("alice")
    bob.get("files", type=Map)["b.py"] = Text("bob")

    _push(alice_ws, alice, alice_before)
    _push(bob_ws, bob, bob_before)

    assert _pull_until(alice_ws, alice, "b.py"), "alice never saw bob's edit"
    assert _pull_until(bob_ws, bob, "a.py"), "bob never saw alice's edit"

    assert _files(alice) == {"a.py": "alice", "b.py": "bob"}
    assert _files(bob) == {"a.py": "alice", "b.py": "bob"}


def test_a_viewer_cannot_change_the_document(client, register):
  from pycrdt import Doc, Map, Text

  owner = register("owner")
  viewer = register("viewer")
  room = _create_room(client, owner, name="Locked", is_public=True)

  client.post("/api/rooms/join", json={"roomId": room["id"]}, headers=viewer["headers"])
  client.put(
    f"/api/rooms/{room['id']}/members/{viewer['user']['id']}/access",
    json={"accessRole": "viewer"},
    headers=owner["headers"],
  )

  with client.websocket_connect(
    f"/api/rooms/{room['id']}/crdt?token={viewer['token']}",
  ) as socket:
    doc = _open(socket, Doc())
    before = doc.get_state()
    doc.get("files", type=Map)["sneaky.py"] = Text("viewer wrote this")
    _push(socket, doc, before)

  # Reconnect as the owner: the write must never have landed.
  with client.websocket_connect(
    f"/api/rooms/{room['id']}/crdt?token={owner['token']}",
  ) as socket:
    fresh = _open(socket, Doc())

  assert "sneaky.py" not in _files(fresh)


def test_an_outsider_is_refused(client, register):
  from starlette.websockets import WebSocketDisconnect

  owner = register("owner")
  outsider = register("outsider")
  room = _create_room(client, owner, name="Private")

  refused = False

  try:
    with client.websocket_connect(f"/api/rooms/{room['id']}/crdt?token={outsider['token']}"):
      pass
  except WebSocketDisconnect:
    refused = True

  assert refused, "a non-member must not be able to open the document"
