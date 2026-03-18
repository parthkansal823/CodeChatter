from __future__ import annotations

import json
import logging
import re
import secrets
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import ASCENDING, DESCENDING, MongoClient

logger = logging.getLogger("codechatter.database")


def _node_id() -> str:
  return secrets.token_hex(6)


def _file(name: str, content: str) -> dict[str, Any]:
  return {
    "id": _node_id(),
    "type": "file",
    "name": name,
    "content": content,
  }


def _folder(name: str, children: list[dict[str, Any]] | None = None) -> dict[str, Any]:
  return {
    "id": _node_id(),
    "type": "folder",
    "name": name,
    "children": children or [],
  }


ROOM_TEMPLATE_DEFINITIONS: dict[str, dict[str, Any]] = {
  "blank": {
    "id": "blank",
    "name": "Blank Workspace",
    "description": "Start with an empty project and create your own files and folders.",
    "category": "Empty",
    "starterLanguage": "any",
    "build": lambda: [],
  },
  "python-starter": {
    "id": "python-starter",
    "name": "Python Starter",
    "description": "A small Python project with source, tests, and notes.",
    "category": "Backend",
    "starterLanguage": "python",
    "build": lambda: [
      _folder("src", [
        _file("main.py", """def greet(name: str) -> str:
    return f"Hello, {name}!"


def main() -> None:
    print(greet("CodeChatter"))


if __name__ == "__main__":
    main()
"""),
      ]),
      _folder("tests", [
        _file("test_main.py", """from src.main import greet


def test_greet():
    assert greet("team") == "Hello, team!"
"""),
      ]),
      _file("README.md", "# Python Starter\n\nCreate files, run `src/main.py`, and collaborate from the same room.\n"),
      _file("requirements.txt", "pytest\n"),
    ],
  },
  "web-starter": {
    "id": "web-starter",
    "name": "HTML/CSS/JS Starter",
    "description": "A lightweight front-end project with separated assets.",
    "category": "Frontend",
    "starterLanguage": "html",
    "build": lambda: [
      _file("index.html", """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodeChatter Web Starter</title>
    <link rel="stylesheet" href="styles/main.css" />
  </head>
  <body>
    <main class="app">
      <h1>CodeChatter Web Starter</h1>
      <p>Edit this project together and open <code>index.html</code> in the browser.</p>
      <button id="hello-button">Click me</button>
    </main>
    <script src="scripts/main.js"></script>
  </body>
</html>
"""),
      _folder("styles", [
        _file("main.css", """body {
  margin: 0;
  font-family: sans-serif;
  background: #111827;
  color: #f9fafb;
}

.app {
  max-width: 720px;
  margin: 0 auto;
  padding: 4rem 1.5rem;
}
"""),
      ]),
      _folder("scripts", [
        _file("main.js", """const button = document.getElementById("hello-button");

button?.addEventListener("click", () => {
  button.textContent = "Build something fun";
});
"""),
      ]),
    ],
  },
  "node-api": {
    "id": "node-api",
    "name": "Node API",
    "description": "A tiny HTTP server you can run locally with Node.",
    "category": "Backend",
    "starterLanguage": "javascript",
    "build": lambda: [
      _folder("src", [
        _file("server.js", """const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Hello from CodeChatter" }));
});

server.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
"""),
      ]),
      _file("package.json", """{
  "name": "codechatter-node-api",
  "private": true,
  "scripts": {
    "start": "node src/server.js"
  }
}
"""),
      _file("README.md", "# Node API\n\nRun `src/server.js` to start a simple HTTP server.\n"),
    ],
  },
  "react-component": {
    "id": "react-component",
    "name": "React Component",
    "description": "A small component-oriented front-end starter.",
    "category": "Frontend",
    "starterLanguage": "javascript",
    "build": lambda: [
      _folder("src", [
        _file("App.jsx", """import { WelcomeCard } from "./components/WelcomeCard";
import "./index.css";

export default function App() {
  return <WelcomeCard title="CodeChatter" subtitle="Start building from here." />;
}
"""),
        _folder("components", [
          _file("WelcomeCard.jsx", """export function WelcomeCard({ title, subtitle }) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}
"""),
        ]),
        _file("index.css", """.card {
  padding: 2rem;
  border-radius: 1rem;
  background: #18181b;
  color: white;
}
"""),
      ]),
      _file("package.json", """{
  "name": "codechatter-react-component",
  "private": true
}
"""),
    ],
  },
  "cpp-console": {
    "id": "cpp-console",
    "name": "C++ Console",
    "description": "A simple console program with a source and include folder.",
    "category": "Systems",
    "starterLanguage": "cpp",
    "build": lambda: [
      _folder("src", [
        _file("main.cpp", """#include <iostream>

int main() {
  std::cout << "Hello from CodeChatter C++!" << std::endl;
  return 0;
}
"""),
      ]),
      _folder("include", []),
      _file("README.md", "# C++ Console\n\nUse `src/main.cpp` as your entry point.\n"),
    ],
  },
  "data-notebook": {
    "id": "data-notebook",
    "name": "Notes and Data",
    "description": "Markdown notes plus sample JSON and a Python script.",
    "category": "Analysis",
    "starterLanguage": "markdown",
    "build": lambda: [
      _file("notes.md", "# Workspace Notes\n\n- Add research notes\n- Track ideas\n- Keep todos close to the code\n"),
      _folder("data", [
        _file("sample.json", """{
  "users": [
    { "id": 1, "name": "Ada" },
    { "id": 2, "name": "Linus" }
  ]
}
"""),
      ]),
      _file("analysis.py", """import json
from pathlib import Path

data = json.loads(Path("data/sample.json").read_text(encoding="utf-8"))
print(f"Loaded {len(data['users'])} users")
"""),
    ],
  },
}


class MongoRepository:
  def __init__(
    self,
    mongo_uri: str,
    database_name: str,
    legacy_data_file: Path | None = None,
  ) -> None:
    self.mongo_uri = mongo_uri
    self.database_name = database_name
    self.legacy_data_file = legacy_data_file
    self._client: MongoClient | Any | None = None
    self._database = None
    self._users = None
    self._rooms = None
    self._is_mock = mongo_uri.startswith("mongomock://")

  def initialize(self) -> None:
    if self._client is not None:
      return

    self._client = self._create_client()

    if not self._is_mock:
      self._client.admin.command("ping")

    self._database = self._client[self.database_name]
    self._users = self._database["users"]
    self._rooms = self._database["rooms"]

    self._ensure_indexes()
    self._bootstrap_data()

  def close(self) -> None:
    if self._client is not None:
      self._client.close()
      self._client = None

  def health(self) -> dict[str, Any]:
    self.initialize()

    if not self._is_mock:
      self._client.admin.command("ping")

    return {
      "database": self.database_name,
      "engine": "mongomock" if self._is_mock else "mongodb",
    }

  def list_room_templates(self) -> list[dict[str, Any]]:
    return [
      {
        "id": template["id"],
        "name": template["name"],
        "description": template["description"],
        "category": template["category"],
        "starterLanguage": template["starterLanguage"],
      }
      for template in ROOM_TEMPLATE_DEFINITIONS.values()
    ]

  def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._users.find_one({"id": user_id}))

  def get_user_by_email(self, email: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._users.find_one({"email": email.lower()}))

  def get_user_by_username(self, username: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(
      self._users.find_one({"username_lower": username.lower()})
    )

  def create_user(
    self,
    email: str,
    username: str,
    password_hash: str,
    password_salt: str,
  ) -> dict[str, Any]:
    self.initialize()
    timestamp = self._utc_now()
    document = {
      "id": secrets.token_hex(8),
      "email": email.lower(),
      "username": username,
      "username_lower": username.lower(),
      "password_hash": password_hash,
      "password_salt": password_salt,
      "oauth_accounts": {},
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    self._users.insert_one(document)
    return self._strip_mongo_id(document)

  def upsert_oauth_user(
    self,
    provider: str,
    provider_user_id: str,
    email: str,
    preferred_username: str,
  ) -> dict[str, Any]:
    self.initialize()

    provider_key = f"oauth_accounts.{provider}"
    existing_by_provider = self._strip_mongo_id(
      self._users.find_one({provider_key: provider_user_id})
    )

    if existing_by_provider is not None:
      updates: dict[str, Any] = {
        "email": email.lower(),
        "updated_at": self._utc_now(),
      }

      if not existing_by_provider.get("username"):
        unique_username = self.build_unique_username(preferred_username)
        updates["username"] = unique_username
        updates["username_lower"] = unique_username.lower()

      self._users.update_one({"id": existing_by_provider["id"]}, {"$set": updates})
      return self.get_user_by_id(existing_by_provider["id"])

    existing_by_email = self.get_user_by_email(email)

    if existing_by_email is not None:
      self._users.update_one(
        {"id": existing_by_email["id"]},
        {
          "$set": {
            provider_key: provider_user_id,
            "updated_at": self._utc_now(),
          }
        },
      )
      return self.get_user_by_id(existing_by_email["id"])

    timestamp = self._utc_now()
    unique_username = self.build_unique_username(preferred_username)
    document = {
      "id": secrets.token_hex(8),
      "email": email.lower(),
      "username": unique_username,
      "username_lower": unique_username.lower(),
      "password_hash": "",
      "password_salt": "",
      "oauth_accounts": {
        provider: provider_user_id,
      },
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    self._users.insert_one(document)
    return self._strip_mongo_id(document)

  def create_room(
    self,
    owner_id: str,
    name: str | None,
    description: str | None,
    is_public: bool,
    template_id: str | None = None,
  ) -> dict[str, Any]:
    self.initialize()
    selected_template_id = template_id or "blank"
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(selected_template_id)

    if template_definition is None:
      raise ValueError("Unknown room template")

    room_id = self.generate_room_id()
    timestamp = self._utc_now()
    document = {
      "id": room_id,
      "name": name or f"{template_definition['name']} Room",
      "description": description or template_definition["description"],
      "is_public": is_public,
      "owner_id": owner_id,
      "participant_ids": [owner_id],
      "template_id": selected_template_id,
      "workspace_tree": self.build_workspace_from_template(selected_template_id),
      "created_at": timestamp,
      "updated_at": timestamp,
    }
    self._rooms.insert_one(document)
    return self.serialize_room(document, include_workspace=True)

  def get_room_by_id(self, room_id: str) -> dict[str, Any] | None:
    self.initialize()
    return self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

  def get_room_for_user(self, user_id: str, room_id: str) -> dict[str, Any] | None:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      return None

    if not self.user_can_access_room(user_id, room):
      return None

    return self.serialize_room(room, include_workspace=True)

  def join_room(self, user_id: str, room_id: str) -> dict[str, Any]:
    self.initialize()
    room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))

    if room is None:
      raise ValueError("Room not found")

    timestamp = self._utc_now()
    self._rooms.update_one(
      {"id": room_id},
      {
        "$addToSet": {
          "participant_ids": user_id,
        },
        "$set": {
          "updated_at": timestamp,
        },
      },
    )
    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=True)

  def delete_room(self, user_id: str, room_id: str) -> None:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      raise ValueError("Room not found")

    if room.get("owner_id") != user_id:
      raise PermissionError("Only the room owner can delete this room")

    self._rooms.delete_one({"id": room_id})

  def update_room_workspace(
    self,
    user_id: str,
    room_id: str,
    workspace_tree: list[dict[str, Any]],
  ) -> dict[str, Any]:
    self.initialize()
    room = self.get_room_by_id(room_id)

    if room is None:
      raise ValueError("Room not found")

    if not self.user_can_access_room(user_id, room):
      raise PermissionError("You do not have access to this room")

    normalized_tree = self.normalize_workspace_tree(workspace_tree)
    timestamp = self._utc_now()
    self._rooms.update_one(
      {"id": room_id},
      {
        "$set": {
          "workspace_tree": normalized_tree,
          "updated_at": timestamp,
        }
      },
    )

    updated_room = self._strip_mongo_id(self._rooms.find_one({"id": room_id}))
    return self.serialize_room(updated_room, include_workspace=True)

  def touch_room(self, room_id: str) -> None:
    self.initialize()
    self._rooms.update_one(
      {"id": room_id},
      {
        "$set": {
          "updated_at": self._utc_now(),
        }
      },
    )

  def list_user_rooms(self, user_id: str) -> list[dict[str, Any]]:
    self.initialize()
    rooms = [
      self._strip_mongo_id(room)
      for room in self._rooms.find(
        {
          "$or": [
            {"owner_id": user_id},
            {"participant_ids": user_id},
          ]
        }
      ).sort("updated_at", DESCENDING)
    ]
    return [self.serialize_room(room) for room in rooms]

  def list_public_rooms(self) -> list[dict[str, Any]]:
    self.initialize()
    rooms = [
      self._strip_mongo_id(room)
      for room in self._rooms.find({"is_public": True}).sort("updated_at", DESCENDING)
    ]
    serialized_rooms = [self.serialize_room(room) for room in rooms]
    serialized_rooms.sort(
      key=lambda room: (room["participantCount"], room["updatedAt"] or ""),
      reverse=True,
    )
    return serialized_rooms

  def list_collaborators(self, user_id: str) -> list[dict[str, Any]]:
    self.initialize()
    rooms = list(
      self._rooms.find(
        {
          "$or": [
            {"owner_id": user_id},
            {"participant_ids": user_id},
          ]
        },
        {"participant_ids": 1},
      )
    )

    collaborator_ids = {
      participant_id
      for room in rooms
      for participant_id in room.get("participant_ids", [])
      if participant_id != user_id
    }

    if not collaborator_ids:
      return []

    collaborators = [
      self.serialize_collaborator(self._strip_mongo_id(user))
      for user in self._users.find({"id": {"$in": list(collaborator_ids)}})
    ]
    collaborators.sort(key=lambda collaborator: collaborator["username"].lower())
    return collaborators

  def build_unique_username(self, preferred_username: str) -> str:
    self.initialize()

    base_username = re.sub(r"[^a-zA-Z0-9_-]", "", preferred_username)[:32] or "developer"
    candidate = base_username
    suffix = 1

    while self._users.find_one({"username_lower": candidate.lower()}):
      suffix_text = str(suffix)
      candidate = f"{base_username[: max(1, 32 - len(suffix_text))]}{suffix_text}"
      suffix += 1

    return candidate

  def generate_room_id(self) -> str:
    self.initialize()

    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    while True:
      candidate = "".join(secrets.choice(alphabet) for _ in range(6))
      if self._rooms.find_one({"id": candidate}) is None:
        return candidate

  def build_workspace_from_template(self, template_id: str) -> list[dict[str, Any]]:
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(template_id or "blank")

    if template_definition is None:
      return []

    return deepcopy(template_definition["build"]())

  def user_can_access_room(self, user_id: str, room: dict[str, Any]) -> bool:
    return (
      room.get("owner_id") == user_id
      or user_id in room.get("participant_ids", [])
      or bool(room.get("is_public", False))
    )

  def serialize_user(self, user: dict[str, Any]) -> dict[str, Any]:
    return {
      "id": user["id"],
      "email": user["email"],
      "username": user["username"],
    }

  def serialize_collaborator(self, user: dict[str, Any]) -> dict[str, Any]:
    return {
      **self.serialize_user(user),
      "active": True,
    }

  def serialize_room(
    self,
    room: dict[str, Any],
    include_workspace: bool = False,
  ) -> dict[str, Any]:
    participant_ids = room.get("participant_ids", [])

    if participant_ids:
      users = list(self._users.find({"id": {"$in": participant_ids}}))
      users_by_id = {
        user["id"]: self._strip_mongo_id(user)
        for user in users
      }
    else:
      users_by_id = {}

    collaborators = [
      self.serialize_collaborator(users_by_id[participant_id])
      for participant_id in participant_ids
      if participant_id in users_by_id
    ]

    updated_at = room.get("updated_at")
    updated_at_iso = updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at
    template_id = room.get("template_id") or "blank"
    template_definition = ROOM_TEMPLATE_DEFINITIONS.get(template_id, ROOM_TEMPLATE_DEFINITIONS["blank"])
    workspace_tree = room.get("workspace_tree", [])

    serialized_room = {
      "id": room["id"],
      "name": room.get("name") or f"Room {room['id']}",
      "description": room.get("description", ""),
      "participantCount": len(collaborators),
      "collaborators": collaborators,
      "isPublic": room.get("is_public", False),
      "updatedAt": updated_at_iso,
      "ownerId": room.get("owner_id"),
      "templateId": template_id,
      "templateName": template_definition["name"],
      "fileCount": self.count_workspace_files(workspace_tree),
    }

    if include_workspace:
      serialized_room["workspaceTree"] = deepcopy(workspace_tree)

    return serialized_room

  def normalize_workspace_tree(
    self,
    nodes: list[dict[str, Any]],
    depth: int = 0,
  ) -> list[dict[str, Any]]:
    if depth > 12:
      raise ValueError("Workspace nesting is too deep")

    normalized_nodes: list[dict[str, Any]] = []

    for raw_node in nodes:
      node_type = str(raw_node.get("type", "")).strip().lower()
      node_name = self._normalize_node_name(raw_node.get("name"))

      if not node_name:
        continue

      if node_type == "folder":
        normalized_nodes.append(
          {
            "id": str(raw_node.get("id") or _node_id()),
            "type": "folder",
            "name": node_name,
            "children": self.normalize_workspace_tree(
              list(raw_node.get("children", [])),
              depth + 1,
            ),
          }
        )
        continue

      if node_type == "file":
        normalized_nodes.append(
          {
            "id": str(raw_node.get("id") or _node_id()),
            "type": "file",
            "name": node_name,
            "content": str(raw_node.get("content", ""))[:250_000],
          }
        )

    return normalized_nodes

  def count_workspace_files(self, nodes: list[dict[str, Any]]) -> int:
    count = 0

    for node in nodes:
      if node.get("type") == "file":
        count += 1
      elif node.get("type") == "folder":
        count += self.count_workspace_files(node.get("children", []))

    return count

  def _create_client(self):
    if self._is_mock:
      import mongomock

      return mongomock.MongoClient(tz_aware=True)

    return MongoClient(
      self.mongo_uri,
      serverSelectionTimeoutMS=5000,
      tz_aware=True,
    )

  def _ensure_indexes(self) -> None:
    self._users.create_index([("id", ASCENDING)], unique=True)
    self._users.create_index([("email", ASCENDING)], unique=True)
    self._users.create_index([("username_lower", ASCENDING)], unique=True)
    self._users.create_index([("oauth_accounts.google", ASCENDING)], unique=True, sparse=True)
    self._users.create_index([("oauth_accounts.github", ASCENDING)], unique=True, sparse=True)

    self._rooms.create_index([("id", ASCENDING)], unique=True)
    self._rooms.create_index([("owner_id", ASCENDING), ("updated_at", DESCENDING)])
    self._rooms.create_index([("participant_ids", ASCENDING)])
    self._rooms.create_index([("is_public", ASCENDING), ("updated_at", DESCENDING)])

  def _bootstrap_data(self) -> None:
    has_users = self._users.count_documents({}) > 0
    has_rooms = self._rooms.count_documents({}) > 0

    if not has_users and not has_rooms and self.legacy_data_file and self.legacy_data_file.exists():
      self._migrate_legacy_data()
      has_users = self._users.count_documents({}) > 0
      has_rooms = self._rooms.count_documents({}) > 0

    if not has_rooms:
      self._seed_public_rooms()

  def _migrate_legacy_data(self) -> None:
    try:
      raw_data = json.loads(self.legacy_data_file.read_text(encoding="utf-8"))
    except Exception as error:
      logger.warning("Could not load legacy JSON data for migration: %s", error)
      return

    users = []

    for user in raw_data.get("users", []):
      username = user.get("username") or self.build_unique_username("developer")
      users.append(
        {
          "id": user.get("id") or secrets.token_hex(8),
          "email": str(user.get("email", "")).lower(),
          "username": username,
          "username_lower": username.lower(),
          "password_hash": user.get("password_hash", ""),
          "password_salt": user.get("password_salt", ""),
          "oauth_accounts": user.get("oauth_accounts", {}),
          "created_at": self._parse_datetime(user.get("created_at")),
          "updated_at": self._parse_datetime(user.get("updated_at") or user.get("created_at")),
        }
      )

    if users:
      self._users.insert_many(users, ordered=False)

    rooms = []

    for room in raw_data.get("rooms", []):
      rooms.append(
        {
          "id": room.get("id") or self.generate_room_id(),
          "name": room.get("name"),
          "description": room.get("description", ""),
          "is_public": bool(room.get("is_public", False)),
          "owner_id": room.get("owner_id", "system"),
          "participant_ids": list(room.get("participant_ids", [])),
          "template_id": room.get("template_id") or "blank",
          "workspace_tree": self.normalize_workspace_tree(list(room.get("workspace_tree", []))),
          "created_at": self._parse_datetime(room.get("created_at")),
          "updated_at": self._parse_datetime(room.get("updated_at") or room.get("created_at")),
        }
      )

    if rooms:
      self._rooms.insert_many(rooms, ordered=False)

  def _seed_public_rooms(self) -> None:
    timestamp = self._utc_now()
    self._rooms.insert_many(
      [
        {
          "id": "WEB207",
          "name": "Frontend Jam",
          "description": "Build UI ideas together and compare approaches.",
          "is_public": True,
          "owner_id": "system",
          "participant_ids": [],
          "template_id": "web-starter",
          "workspace_tree": self.build_workspace_from_template("web-starter"),
          "created_at": timestamp,
          "updated_at": timestamp,
        },
        {
          "id": "PY101A",
          "name": "Python Practice",
          "description": "Share snippets, notes, and interview drills.",
          "is_public": True,
          "owner_id": "system",
          "participant_ids": [],
          "template_id": "python-starter",
          "workspace_tree": self.build_workspace_from_template("python-starter"),
          "created_at": timestamp,
          "updated_at": timestamp,
        },
      ]
    )

  @staticmethod
  def _normalize_node_name(value: Any) -> str:
    name = str(value or "").strip()

    if not name or "/" in name or "\\" in name or name in {".", ".."}:
      return ""

    return name[:120]

  @staticmethod
  def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
      return value.astimezone(timezone.utc)

    if isinstance(value, str) and value:
      return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)

    return datetime.now(timezone.utc)

  @staticmethod
  def _strip_mongo_id(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
      return None

    cloned = dict(document)
    cloned.pop("_id", None)
    return cloned

  @staticmethod
  def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
