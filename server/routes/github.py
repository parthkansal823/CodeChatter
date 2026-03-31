"""GitHub integration routes — repos, gists, import, push, link, sync."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import secrets as _sec
from pathlib import PurePosixPath
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

try:
  from ..core.security import get_current_user
  from ..core.settings import repository, logger
except ImportError:
  from core.security import get_current_user
  from core.settings import repository, logger

router = APIRouter(prefix="/api/github", tags=["github"])

GITHUB_API = "https://api.github.com"
_HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}


# ── low-level helpers ───────────────────────────────────────────────────────

def _get_token_or_raise(user_id: str) -> str:
  token = repository.get_oauth_token(user_id, "github")
  if not token:
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail="GitHub account not connected. Connect GitHub in Settings first.",
    )
  return token


def _gh_headers(token: str) -> dict:
  return {**_HEADERS, "Authorization": f"Bearer {token}"}


async def _gh_get(path: str, token: str, params: dict | None = None) -> Any:
  async with httpx.AsyncClient(timeout=15) as client:
    resp = await client.get(f"{GITHUB_API}/{path.lstrip('/')}", headers=_gh_headers(token), params=params)
  if resp.status_code == 401:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="GitHub token expired. Reconnect GitHub in Settings.")
  if not resp.is_success:
    raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text[:200]}")
  return resp.json()


async def _gh_post(path: str, token: str, payload: dict) -> Any:
  async with httpx.AsyncClient(timeout=15) as client:
    resp = await client.post(f"{GITHUB_API}/{path.lstrip('/')}", headers=_gh_headers(token), json=payload)
  if not resp.is_success:
    raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text[:200]}")
  return resp.json()


async def _gh_put(path: str, token: str, payload: dict) -> Any:
  async with httpx.AsyncClient(timeout=15) as client:
    resp = await client.put(f"{GITHUB_API}/{path.lstrip('/')}", headers=_gh_headers(token), json=payload)
  if not resp.is_success:
    raise HTTPException(status_code=resp.status_code, detail=f"GitHub API error: {resp.text[:200]}")
  return resp.json()


# ── git / workspace helpers ─────────────────────────────────────────────────

def _git_blob_sha(content: str) -> str:
  """Compute the git blob SHA1 that GitHub uses — sha1("blob N\0content")."""
  data = content.encode("utf-8")
  header = f"blob {len(data)}\0".encode("utf-8")
  return hashlib.sha1(header + data).hexdigest()  # noqa: S324 (git standard)


def _find_node_by_id(tree: list[dict], node_id: str) -> dict | None:
  for node in tree:
    if node.get("id") == node_id:
      return node
    if node.get("type") == "folder":
      found = _find_node_by_id(node.get("children") or [], node_id)
      if found:
        return found
  return None


def _collect_tracked_files(node: dict) -> list[dict]:
  """Recursively collect file nodes that have a githubPath (i.e. were imported)."""
  results: list[dict] = []
  if node.get("type") == "file" and node.get("githubPath"):
    results.append(node)
  for child in node.get("children") or []:
    results.extend(_collect_tracked_files(child))
  return results


def _update_node_shas(tree: list[dict], updates: dict[str, str]) -> None:
  """In-place update of githubSha values by node ID."""
  for node in tree:
    if node.get("id") in updates:
      node["githubSha"] = updates[node["id"]]
    if node.get("children"):
      _update_node_shas(node["children"], updates)


# ── schemas ────────────────────────────────────────────────────────────────

class CreateGistRequest(BaseModel):
  description: str = Field(default="", max_length=256)
  filename: str = Field(min_length=1, max_length=255)
  content: str = Field(min_length=1, max_length=300_000)
  public: bool = False


class ImportRepoRequest(BaseModel):
  owner: str = Field(min_length=1, max_length=100)
  repo: str = Field(min_length=1, max_length=100)
  branch: str = Field(default="", max_length=255)
  path: str = Field(default="", max_length=500)
  roomId: str = Field(min_length=1, max_length=64)
  link: bool = False  # if True, also store a github_link on the room


class PushFileRequest(BaseModel):
  owner: str = Field(min_length=1, max_length=100)
  repo: str = Field(min_length=1, max_length=100)
  branch: str = Field(default="main", max_length=255)
  filePath: str = Field(min_length=1, max_length=500)
  content: str = Field(max_length=300_000)
  commitMessage: str = Field(default="", max_length=256)


class LinkRepoRequest(BaseModel):
  owner: str = Field(min_length=1, max_length=100)
  repo: str = Field(min_length=1, max_length=100)
  branch: str = Field(min_length=1, max_length=255)
  folderId: str = Field(min_length=1, max_length=64)
  folderName: str = Field(min_length=1, max_length=100)


# ── endpoints ──────────────────────────────────────────────────────────────

@router.get("/status")
def github_status(current_user: dict[str, Any] = Depends(get_current_user)) -> dict:
  serialized = repository.serialize_user(current_user)
  return {
    "connected": serialized["githubConnected"],
    "githubUsername": serialized.get("githubUsername"),
    "githubAvatarUrl": serialized.get("githubAvatarUrl"),
  }


@router.get("/profile")
async def github_profile(current_user: dict[str, Any] = Depends(get_current_user)) -> dict:
  token = _get_token_or_raise(current_user["id"])
  profile = await _gh_get("user", token)
  return {
    "login": profile.get("login"),
    "name": profile.get("name"),
    "avatarUrl": profile.get("avatar_url"),
    "bio": profile.get("bio"),
    "publicRepos": profile.get("public_repos", 0),
    "followers": profile.get("followers", 0),
    "following": profile.get("following", 0),
    "htmlUrl": profile.get("html_url"),
    "company": profile.get("company"),
    "location": profile.get("location"),
    "blog": profile.get("blog"),
  }


@router.get("/repos")
async def list_repos(
  per_page: int = 30,
  page: int = 1,
  sort: str = "updated",
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict]:
  token = _get_token_or_raise(current_user["id"])
  repos = await _gh_get("user/repos", token, params={
    "per_page": min(per_page, 100),
    "page": page,
    "sort": sort,
    "affiliation": "owner,collaborator",
  })
  return [
    {
      "id": r["id"],
      "name": r["name"],
      "fullName": r["full_name"],
      "owner": r["owner"]["login"],
      "description": r.get("description"),
      "private": r["private"],
      "language": r.get("language"),
      "defaultBranch": r.get("default_branch", "main"),
      "updatedAt": r.get("updated_at"),
      "htmlUrl": r.get("html_url"),
      "stargazersCount": r.get("stargazers_count", 0),
    }
    for r in repos
  ]


@router.get("/repos/{owner}/{repo}/branches")
async def list_branches(
  owner: str,
  repo: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict]:
  token = _get_token_or_raise(current_user["id"])
  branches = await _gh_get(f"repos/{owner}/{repo}/branches", token)
  return [{"name": b["name"]} for b in branches]


@router.get("/repos/{owner}/{repo}/tree")
async def get_repo_tree(
  owner: str,
  repo: str,
  branch: str = "",
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  token = _get_token_or_raise(current_user["id"])
  if not branch:
    repo_info = await _gh_get(f"repos/{owner}/{repo}", token)
    branch = repo_info.get("default_branch", "main")
  tree_data = await _gh_get(f"repos/{owner}/{repo}/git/trees/{branch}", token, params={"recursive": "1"})
  files = [
    {
      "path": item["path"],
      "type": "file" if item["type"] == "blob" else "folder",
      "size": item.get("size", 0),
    }
    for item in tree_data.get("tree", [])
    if item["type"] in ("blob", "tree")
  ]
  return {"branch": branch, "files": files, "truncated": tree_data.get("truncated", False)}


@router.get("/gists")
async def list_gists(
  per_page: int = 20,
  page: int = 1,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict]:
  token = _get_token_or_raise(current_user["id"])
  gists = await _gh_get("gists", token, params={"per_page": min(per_page, 100), "page": page})
  return [
    {
      "id": g["id"],
      "description": g.get("description"),
      "public": g["public"],
      "files": list(g.get("files", {}).keys()),
      "htmlUrl": g.get("html_url"),
      "createdAt": g.get("created_at"),
      "updatedAt": g.get("updated_at"),
    }
    for g in gists
  ]


@router.post("/gists", status_code=status.HTTP_201_CREATED)
async def create_gist(
  payload: CreateGistRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  token = _get_token_or_raise(current_user["id"])
  result = await _gh_post("gists", token, {
    "description": payload.description or f"Shared via CodeChatter — {payload.filename}",
    "public": payload.public,
    "files": {payload.filename: {"content": payload.content}},
  })
  return {
    "id": result["id"],
    "htmlUrl": result["html_url"],
    "description": result.get("description"),
    "public": result["public"],
  }


@router.post("/rooms/{room_id}/import")
async def import_repo_to_room(
  room_id: str,
  payload: ImportRepoRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Import files from a GitHub repo into a room's workspace.
  If payload.link=True, also links the room to this repo for auto-sync.
  """
  token = _get_token_or_raise(current_user["id"])

  room = repository.get_room_by_id(room_id)
  if not room:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
  if not repository.user_can_edit_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need edit access to import files")

  # Resolve branch
  branch = payload.branch
  if not branch:
    repo_info = await _gh_get(f"repos/{payload.owner}/{payload.repo}", token)
    branch = repo_info.get("default_branch", "main")

  # Get full file tree (with blob SHAs)
  tree_data = await _gh_get(
    f"repos/{payload.owner}/{payload.repo}/git/trees/{branch}",
    token,
    params={"recursive": "1"},
  )

  prefix = payload.path.strip("/")
  items = [
    item for item in tree_data.get("tree", [])
    if item["type"] == "blob"
    and (not prefix or item["path"].startswith(prefix + "/") or item["path"] == prefix)
    and item.get("size", 0) < 500_000
  ][:80]

  if not items:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No files found at that path/branch")

  # sha_map: path → GitHub blob SHA (for change tracking)
  sha_map: dict[str, str] = {item["path"]: item.get("sha", "") for item in items}

  # Fetch file contents in parallel
  async def fetch_file(path: str) -> tuple[str, str]:
    resp = await _gh_get(
      f"repos/{payload.owner}/{payload.repo}/contents/{path}",
      token,
      params={"ref": branch},
    )
    raw = resp.get("content", "")
    try:
      return path, base64.b64decode(raw).decode("utf-8", errors="replace")
    except Exception:
      return path, ""

  results = await asyncio.gather(*[fetch_file(item["path"]) for item in items], return_exceptions=True)

  # Build workspace nodes — store githubPath + githubSha on every file node
  def _build_nodes(files: list[tuple[str, str]]) -> list[dict]:
    tree: dict[str, Any] = {}
    for path, content in files:
      parts = PurePosixPath(path).parts
      node = tree
      for part in parts[:-1]:
        node = node.setdefault(part, {})
      node[parts[-1]] = (content, path)  # store (content, originalPath)

    def convert(name: str, subtree: Any) -> dict:
      if isinstance(subtree, tuple):
        content, original_path = subtree
        return {
          "id": _sec.token_hex(6),
          "type": "file",
          "name": name,
          "content": content,
          "githubPath": original_path,
          "githubSha": sha_map.get(original_path, ""),
        }
      return {
        "id": _sec.token_hex(6),
        "type": "folder",
        "name": name,
        "children": [convert(k, v) for k, v in subtree.items()],
      }

    return [convert(k, v) for k, v in tree.items()]

  file_pairs = [(p, c) for r in results if not isinstance(r, Exception) for p, c in [r] if c]
  new_nodes = _build_nodes(file_pairs)

  existing_tree = room.get("workspace_tree") or []
  folder_id = _sec.token_hex(6)
  repo_folder: dict = {
    "id": folder_id,
    "type": "folder",
    "name": payload.repo,
    "children": new_nodes,
  }
  merged_tree = existing_tree + [repo_folder]
  repository.update_room_workspace(current_user["id"], room_id, merged_tree)

  # Optionally link the room to this repo
  if payload.link:
    repository.set_room_github_link(room_id, current_user["id"], {
      "owner": payload.owner,
      "repo": payload.repo,
      "branch": branch,
      "folderId": folder_id,
      "folderName": payload.repo,
    })

  return {
    "imported": len(file_pairs),
    "repoFolder": payload.repo,
    "branch": branch,
    "folderId": folder_id,
    "linked": payload.link,
  }


@router.get("/rooms/{room_id}/link")
def get_room_link(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Return the linked GitHub repo for this room, or {} if none."""
  room = repository.get_room_by_id(room_id)
  if not room:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
  if not repository.user_can_access_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
  link = repository.get_room_github_link(room_id)
  return link or {}


@router.post("/rooms/{room_id}/link", status_code=status.HTTP_200_OK)
def link_room_to_repo(
  room_id: str,
  payload: LinkRepoRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Manually link (or re-link) a room to a GitHub repo for auto-sync."""
  room = repository.get_room_by_id(room_id)
  if not room:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
  if not repository.user_can_edit_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need edit access to link a repo")

  link_data = {
    "owner": payload.owner,
    "repo": payload.repo,
    "branch": payload.branch,
    "folderId": payload.folderId,
    "folderName": payload.folderName,
  }
  repository.set_room_github_link(room_id, current_user["id"], link_data)
  return link_data


@router.delete("/rooms/{room_id}/link")
def unlink_room_from_repo(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Remove the GitHub repo link from a room."""
  room = repository.get_room_by_id(room_id)
  if not room:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
  if not repository.user_can_edit_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need edit access to unlink a repo")

  repository.clear_room_github_link(room_id, current_user["id"])
  return {"success": True}


@router.post("/rooms/{room_id}/sync")
async def sync_room_to_github(
  room_id: str,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Push all changed files in the linked GitHub folder back to GitHub.

  A file is considered changed when its current content produces a different
  git blob SHA than the SHA stored on the node (set at import / last sync).
  After pushing, the stored SHA is updated so the next sync is a no-op.
  """
  gh_token = _get_token_or_raise(current_user["id"])

  room = repository.get_room_by_id(room_id)
  if not room:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
  if not repository.user_can_edit_room(current_user["id"], room):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You need edit access to sync")

  link = repository.get_room_github_link(room_id)
  if not link:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This room has no linked GitHub repo")

  workspace_tree: list[dict] = room.get("workspace_tree") or []
  folder_node = _find_node_by_id(workspace_tree, link["folderId"])
  if not folder_node:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=f"Linked folder '{link['folderName']}' was not found in the workspace. Re-import or re-link the repo.",
    )

  tracked_files = _collect_tracked_files(folder_node)
  if not tracked_files:
    return {"pushed": 0, "unchanged": 0, "errors": [], "message": "No tracked files to sync"}

  owner = link["owner"]
  repo = link["repo"]
  branch = link["branch"]

  pushed = 0
  unchanged = 0
  errors: list[str] = []
  sha_updates: dict[str, str] = {}  # node_id → new githubSha

  async def push_one(node: dict) -> None:
    nonlocal pushed, unchanged
    content = node.get("content") or ""
    stored_sha = node.get("githubSha") or ""
    local_sha = _git_blob_sha(content)
    github_path = node["githubPath"]

    if local_sha == stored_sha:
      unchanged += 1
      return

    encoded = base64.b64encode(content.encode("utf-8")).decode()
    # Fetch current remote SHA for update (may differ from our stored sha if someone else pushed)
    remote_sha: str | None = None
    try:
      existing = await _gh_get(f"repos/{owner}/{repo}/contents/{github_path}", gh_token, params={"ref": branch})
      remote_sha = existing.get("sha")
    except HTTPException as exc:
      if exc.status_code != 404:
        errors.append(f"{github_path}: {exc.detail}")
        return

    put_body: dict = {
      "message": f"Sync {github_path} via CodeChatter",
      "content": encoded,
      "branch": branch,
    }
    if remote_sha:
      put_body["sha"] = remote_sha

    try:
      result = await _gh_put(f"repos/{owner}/{repo}/contents/{github_path}", gh_token, put_body)
      new_blob_sha = (result.get("content") or {}).get("sha") or local_sha
      sha_updates[node["id"]] = new_blob_sha
      pushed += 1
    except HTTPException as exc:
      errors.append(f"{github_path}: {exc.detail}")

  await asyncio.gather(*[push_one(f) for f in tracked_files])

  # Update stored SHAs in workspace so next sync is a no-op for unchanged files
  if sha_updates:
    _update_node_shas(workspace_tree, sha_updates)
    repository.set_room_workspace_tree_raw(room_id, workspace_tree)

  return {
    "pushed": pushed,
    "unchanged": unchanged,
    "errors": errors,
    "total": len(tracked_files),
  }


@router.post("/push")
async def push_file_to_repo(
  payload: PushFileRequest,
  current_user: dict[str, Any] = Depends(get_current_user),
) -> dict:
  """Push (create or update) a single file in a GitHub repo."""
  token = _get_token_or_raise(current_user["id"])
  encoded = base64.b64encode(payload.content.encode()).decode()
  path = payload.filePath.lstrip("/")
  message = payload.commitMessage or f"Update {path} via CodeChatter"

  sha: str | None = None
  try:
    existing = await _gh_get(f"repos/{payload.owner}/{payload.repo}/contents/{path}", token, params={"ref": payload.branch})
    sha = existing.get("sha")
  except HTTPException as e:
    if e.status_code != 404:
      raise

  put_body: dict = {"message": message, "content": encoded, "branch": payload.branch}
  if sha:
    put_body["sha"] = sha

  result = await _gh_put(f"repos/{payload.owner}/{payload.repo}/contents/{path}", token, put_body)
  commit = result.get("commit", {})
  return {
    "sha": commit.get("sha"),
    "message": commit.get("message"),
    "htmlUrl": commit.get("html_url"),
    "action": "updated" if sha else "created",
  }


@router.delete("/disconnect")
def disconnect_github(current_user: dict[str, Any] = Depends(get_current_user)) -> dict:
  """Unlink GitHub from the current user account."""
  repository.disconnect_oauth_from_user(current_user["id"], "github")
  return {"success": True}
