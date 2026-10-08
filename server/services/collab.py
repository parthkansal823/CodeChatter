"""Conflict-free collaborative editing, one shared document per room.

Why this exists
---------------
The older `workspace_update` path sent the entire workspace tree on every
keystroke, wrote it to MongoDB, and only then broadcast it. Three costs, all on
the typing path: a full-tree payload, an Atlas round trip, and a full-tree
re-render on every peer. It was also last-write-wins, so two people typing in
one file meant one of them silently lost work.

Here the room owns a CRDT document. Clients apply their own edits immediately
and exchange small binary deltas; merges are resolved by the data structure
rather than by arrival order, so no edit can overwrite another. Persistence is
debounced and happens off the edit path entirely.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from pycrdt import (
  Doc,
  Map,
  Text,
  YMessageType,
  YSyncMessageType,
  create_sync_message,
  create_update_message,
  handle_sync_message,
  read_message,
)

try:
  from ..core.settings import logger, repository
except ImportError:
  from core.settings import logger, repository

# How long the document sits idle before it is written back to Mongo. Typing
# never waits on this; it only decides how much is lost in a hard crash.
PERSIST_DEBOUNCE_SECONDS = 2.0

# Documents for rooms nobody is in are dropped after this, so a long-lived
# server does not accumulate every room ever opened.
IDLE_EVICTION_SECONDS = 300.0


class RoomDoc:
  """One room's CRDT document plus the sockets currently attached to it."""

  def __init__(self, room_id: str) -> None:
    self.room_id = room_id
    self.doc = Doc()
    # path -> Text. Each file is its own text CRDT, which is what makes an
    # edit travel as the characters typed rather than as the whole file — and
    # what lets two people edit one file at once without either losing work.
    # A plain string here would put last-write-wins straight back.
    self.files: Map = self.doc.get("files", type=Map)
    self.sockets: set[Any] = set()
    self.dirty = False
    self.last_touched = time.monotonic()
    self._persist_task: asyncio.Task | None = None
    self._lock = asyncio.Lock()

  def seed_from_tree(self, tree: list[dict[str, Any]]) -> None:
    """Load the stored workspace into the document, once, on first open."""
    flat: dict[str, str] = {}

    def walk(nodes: list[dict[str, Any]], prefix: str = "") -> None:
      for node in nodes or []:
        name = node.get("name") or ""
        path = f"{prefix}{name}"

        if node.get("type") == "folder":
          walk(node.get("children") or [], f"{path}/")
        else:
          flat[path] = node.get("content") or ""

    walk(tree)

    with self.doc.transaction():
      for path, content in flat.items():
        if path not in self.files:
          self.files[path] = Text(content)

  def snapshot(self) -> dict[str, str]:
    return {path: str(value) for path, value in self.files.items()}


class CollaborationDocs:
  """Registry of live room documents."""

  def __init__(self) -> None:
    self._rooms: dict[str, RoomDoc] = {}
    self._lock = asyncio.Lock()

  async def acquire(self, room_id: str, seed_tree: list[dict[str, Any]] | None = None) -> RoomDoc:
    async with self._lock:
      room = self._rooms.get(room_id)

      if room is None:
        room = RoomDoc(room_id)

        if seed_tree:
          room.seed_from_tree(seed_tree)

        self._rooms[room_id] = room
        logger.info("[collab] opened document for room %s", room_id)

      room.last_touched = time.monotonic()
      return room

  async def release(self, room_id: str) -> None:
    """Drop the document once the last socket leaves, after a final save."""
    async with self._lock:
      room = self._rooms.get(room_id)

      if room is None or room.sockets:
        return

      if room.dirty:
        await self._persist(room)

      self._rooms.pop(room_id, None)
      logger.info("[collab] closed document for room %s", room_id)

  async def _persist(self, room: RoomDoc) -> None:
    files = room.snapshot()

    if not files:
      return

    try:
      # PyMongo is synchronous; off-thread so a slow write cannot stall the
      # event loop and with it every other room's socket.
      await asyncio.to_thread(repository.replace_room_file_contents, room.room_id, files)
      room.dirty = False
    except Exception as error:  # noqa: BLE001 - a failed save must not kill the room
      logger.warning("[collab] could not persist room %s: %s", room.room_id, error)

  def mark_dirty(self, room: RoomDoc) -> None:
    """Schedule a debounced save. Called on every applied update."""
    room.dirty = True
    room.last_touched = time.monotonic()

    if room._persist_task and not room._persist_task.done():
      return

    async def _later() -> None:
      await asyncio.sleep(PERSIST_DEBOUNCE_SECONDS)
      if room.dirty:
        await self._persist(room)

    room._persist_task = asyncio.create_task(_later())


docs = CollaborationDocs()


async def broadcast(room: RoomDoc, payload: bytes, exclude: Any = None) -> None:
  """Relay a protocol frame to everyone else in the room."""
  dead = []

  for socket in list(room.sockets):
    if socket is exclude:
      continue

    try:
      await socket.send_bytes(payload)
    except Exception:  # noqa: BLE001 - a closing socket must not stop the rest
      dead.append(socket)

  for socket in dead:
    room.sockets.discard(socket)


async def send_initial_sync(room: RoomDoc, socket: Any) -> None:
  """Step 1 of the y-protocol: tell the peer what we already have."""
  await socket.send_bytes(create_sync_message(room.doc))


async def handle_client_message(room: RoomDoc, socket: Any, message: bytes) -> None:
  """Apply one inbound frame and fan it out.

  Two frame kinds matter. Sync frames carry document state and are applied to
  the room's document; awareness frames carry cursors and presence and are
  relayed untouched — they are ephemeral and must never be persisted.
  """
  if not message:
    return

  message_type = message[0]
  payload = message[1:]

  if message_type == YMessageType.SYNC:
    reply = handle_sync_message(payload, room.doc)

    if reply is not None:
      await socket.send_bytes(reply)

    # Only a step-2 or update frame changes the document; a step-1 request does
    # not, and re-broadcasting it would echo every peer's request to everyone.
    if payload and payload[0] in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
      update = read_message(payload[1:])
      await broadcast(room, create_update_message(update), exclude=socket)
      docs.mark_dirty(room)

    return

  if message_type == YMessageType.AWARENESS:
    await broadcast(room, message, exclude=socket)
