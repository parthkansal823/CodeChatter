from __future__ import annotations

from pathlib import Path, PurePosixPath
import os
import shutil
import subprocess
import tempfile
from typing import Any

from fastapi import HTTPException, status

try:
  from ..core.security import normalize_workspace_path, utc_now
  from ..core.settings import RUN_TIMEOUT_SECONDS, WORKSPACES_DIR
except ImportError:
  from core.security import normalize_workspace_path, utc_now
  from core.settings import RUN_TIMEOUT_SECONDS, WORKSPACES_DIR


def iter_workspace_files(
  nodes: list[dict[str, Any]],
  parent_path: str = "",
) -> list[tuple[str, str]]:
  files: list[tuple[str, str]] = []

  for node in nodes:
    node_name = str(node.get("name", "")).strip()

    if not node_name:
      continue

    current_path = f"{parent_path}/{node_name}" if parent_path else node_name

    if node.get("type") == "file":
      files.append((current_path, str(node.get("content", ""))))
      continue

    if node.get("type") == "folder":
      files.extend(iter_workspace_files(node.get("children", []), current_path))

  return files


def get_room_workspace_dir(room_id: str) -> Path:
  return WORKSPACES_DIR / room_id


def clear_room_workspace_snapshot(room_id: str) -> None:
  workspace_root = get_room_workspace_dir(room_id)
  if workspace_root.exists():
    shutil.rmtree(workspace_root, ignore_errors=True)


def find_installed_command(*candidates: str) -> str | None:
  for candidate in candidates:
    executable_path = shutil.which(candidate)
    if executable_path:
      return executable_path

  return None


def run_process(
  command: list[str],
  cwd: str,
  stdin_text: str = "",
) -> dict[str, Any]:
  start_time = utc_now()

  try:
    completed = subprocess.run(
      command,
      cwd=cwd,
      input=stdin_text,
      text=True,
      capture_output=True,
      timeout=RUN_TIMEOUT_SECONDS,
      shell=False,
      check=False,
    )
  except subprocess.TimeoutExpired as error:
    return {
      "stdout": error.stdout or "",
      "stderr": (error.stderr or "") + f"\nProcess timed out after {RUN_TIMEOUT_SECONDS} seconds.",
      "exitCode": None,
      "runtimeMs": int((utc_now() - start_time).total_seconds() * 1000),
    }
  except OSError as error:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=f"Could not start the configured runner: {error}",
    ) from error

  return {
    "stdout": completed.stdout,
    "stderr": completed.stderr,
    "exitCode": completed.returncode,
    "runtimeMs": int((utc_now() - start_time).total_seconds() * 1000),
  }


def build_run_plan(workspace_root: Path, relative_path: str) -> dict[str, Any]:
  target_file = workspace_root / PurePosixPath(relative_path)
  extension = target_file.suffix.lower()

  if extension == ".py":
    runner = find_installed_command("python", "py")

    if runner is None:
      raise HTTPException(status_code=400, detail="Python is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension in {".js", ".mjs", ".cjs"}:
    runner = find_installed_command("node")

    if runner is None:
      raise HTTPException(status_code=400, detail="Node.js is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".ts":
    runner = find_installed_command("tsx", "ts-node")

    if runner is None:
      raise HTTPException(
        status_code=400,
        detail="TypeScript execution is not available. Install `tsx` or `ts-node` first.",
      )

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".php":
    runner = find_installed_command("php")

    if runner is None:
      raise HTTPException(status_code=400, detail="PHP is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".rb":
    runner = find_installed_command("ruby")

    if runner is None:
      raise HTTPException(status_code=400, detail="Ruby is not installed on the server")

    return {
      "compile": None,
      "run": [runner, str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".go":
    runner = find_installed_command("go")

    if runner is None:
      raise HTTPException(status_code=400, detail="Go is not installed on the server")

    return {
      "compile": None,
      "run": [runner, "run", str(target_file)],
      "cwd": str(target_file.parent),
    }

  if extension == ".java":
    javac = find_installed_command("javac")
    java = find_installed_command("java")

    if javac is None or java is None:
      raise HTTPException(status_code=400, detail="Java is not installed on the server")

    return {
      "compile": [javac, str(target_file)],
      "run": [java, target_file.stem],
      "cwd": str(target_file.parent),
    }

  if extension == ".c":
    compiler = find_installed_command("gcc", "clang")

    if compiler is None:
      raise HTTPException(status_code=400, detail="A C compiler is not installed on the server")

    binary_name = "codechatter-c.exe" if os.name == "nt" else "codechatter-c"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension in {".cpp", ".cc", ".cxx"}:
    compiler = find_installed_command("g++", "clang++")

    if compiler is None:
      raise HTTPException(status_code=400, detail="A C++ compiler is not installed on the server")

    binary_name = "codechatter-cpp.exe" if os.name == "nt" else "codechatter-cpp"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension == ".rs":
    compiler = find_installed_command("rustc")

    if compiler is None:
      raise HTTPException(status_code=400, detail="Rust is not installed on the server")

    binary_name = "codechatter-rust.exe" if os.name == "nt" else "codechatter-rust"
    binary_path = workspace_root / binary_name
    return {
      "compile": [compiler, str(target_file), "-o", str(binary_path)],
      "run": [str(binary_path)],
      "cwd": str(target_file.parent),
    }

  if extension == ".sh":
    runner = find_installed_command("bash", "sh")
    if runner is None:
      raise HTTPException(status_code=400, detail="Bash/sh is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".lua":
    runner = find_installed_command("lua")
    if runner is None:
      raise HTTPException(status_code=400, detail="Lua is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".pl":
    runner = find_installed_command("perl")
    if runner is None:
      raise HTTPException(status_code=400, detail="Perl is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".swift":
    runner = find_installed_command("swift")
    if runner is None:
      raise HTTPException(status_code=400, detail="Swift is not installed on the server")
    return {"compile": None, "run": [runner, str(target_file)], "cwd": str(target_file.parent)}

  if extension == ".kt":
    kotlinc = find_installed_command("kotlinc")
    java = find_installed_command("java")
    if kotlinc is None or java is None:
      raise HTTPException(status_code=400, detail="Kotlin or Java is not installed on the server")
    return {
      "compile": [kotlinc, str(target_file), "-include-runtime", "-d", "codechatter-kt.jar"],
      "run": [java, "-jar", "codechatter-kt.jar"],
      "cwd": str(target_file.parent),
    }

  if extension in {".html", ".css", ".json", ".md"}:
    raise HTTPException(
      status_code=400,
      detail="This file type is not directly runnable. Use the browser preview or switch to a script file.",
    )

  raise HTTPException(
    status_code=400,
    detail=f"Running `{extension or 'this file type'}` is not supported yet.",
  )


def sync_workspace_to_disk(room_id: str, workspace_tree: list[dict[str, Any]]) -> str:
  workspace_root = get_room_workspace_dir(room_id)
  clear_room_workspace_snapshot(room_id)
  workspace_root.mkdir(parents=True, exist_ok=True)

  workspace_files = iter_workspace_files(workspace_tree)
  for relative_path, content in workspace_files:
    target_path = workspace_root / PurePosixPath(relative_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")

  return str(workspace_root)


def execute_workspace_file(
  workspace_tree: list[dict[str, Any]],
  file_path: str,
  stdin_text: str,
) -> dict[str, Any]:
  normalized_path = normalize_workspace_path(file_path)
  workspace_files = iter_workspace_files(workspace_tree)
  file_lookup = {relative_path: content for relative_path, content in workspace_files}

  if normalized_path not in file_lookup:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail="The selected file does not exist in this room workspace",
    )

  with tempfile.TemporaryDirectory(prefix="codechatter-run-") as temp_dir:
    workspace_root = Path(temp_dir)

    for relative_path, content in workspace_files:
      target_path = workspace_root / PurePosixPath(relative_path)
      target_path.parent.mkdir(parents=True, exist_ok=True)
      target_path.write_text(content, encoding="utf-8")

    run_plan = build_run_plan(workspace_root, normalized_path)
    compile_command = run_plan["compile"]
    run_command = run_plan["run"]
    working_directory = run_plan["cwd"]

    if compile_command is not None:
      compile_result = run_process(compile_command, working_directory)
      compile_result["phase"] = "compile"
      compile_result["command"] = " ".join(compile_command)
      compile_result["filePath"] = normalized_path

      if compile_result["exitCode"] not in {0, None}:
        return compile_result

    run_result = run_process(run_command, working_directory, stdin_text)
    run_result["phase"] = "run"
    run_result["command"] = " ".join(run_command)
    run_result["filePath"] = normalized_path

    if compile_command is not None:
      run_result["compileCommand"] = " ".join(compile_command)

    return run_result
