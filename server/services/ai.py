from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

try:
  from ..core.schemas import AssistRequest
  from ..core.settings import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_KEEP_ALIVE,
    OLLAMA_TIMEOUT_SECONDS,
    logger,
  )
except ImportError:
  from core.schemas import AssistRequest
  from core.settings import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_KEEP_ALIVE,
    OLLAMA_TIMEOUT_SECONDS,
    logger,
  )


def summarize_run_result_for_ai(run_result: dict[str, Any] | None) -> str:
  if not isinstance(run_result, dict):
    return "No recent run result was provided."

  summary_parts: list[str] = []

  command = str(run_result.get("command", "")).strip()
  if command:
    summary_parts.append(f"Command: {command}")

  exit_code = run_result.get("exitCode")
  if exit_code is not None:
    summary_parts.append(f"Exit code: {exit_code}")

  runtime_ms = run_result.get("runtimeMs")
  if isinstance(runtime_ms, (int, float)):
    summary_parts.append(f"Runtime: {int(runtime_ms)} ms")

  stdout = str(run_result.get("stdout", "")).strip()
  stderr = str(run_result.get("stderr", "")).strip()

  if stdout:
    summary_parts.append(f"Stdout:\n{stdout[:3000]}")

  if stderr:
    summary_parts.append(f"Stderr:\n{stderr[:3000]}")

  return "\n\n".join(summary_parts) if summary_parts else "No recent run result was provided."


def build_assistant_prompt(
  payload: AssistRequest,
  *,
  current_user: dict[str, Any],
  active_file_path: str | None,
) -> str:
  active_code = (payload.activeCode or "")[:25_000]
  room_label = payload.roomName or payload.roomId or "Current workspace"
  file_label = active_file_path or "No file selected"
  run_result_summary = summarize_run_result_for_ai(payload.runResult)

  sections = [
    "You are the AI assistant inside CodeChatter, a collaborative coding workspace.",
    "Give practical, implementation-focused answers grounded in the provided room context.",
    "Be concise but useful. Prefer actionable debugging and improvement advice over generic theory.",
    "",
    f"Developer: {current_user['username']}",
    f"Workspace: {room_label}",
    f"Active file: {file_label}",
    "",
    "User request:",
    payload.prompt,
    "",
    "Latest run result:",
    run_result_summary,
    "",
    "Active file content:",
    active_code or "No active file content was provided.",
  ]

  return "\n".join(sections)




# ── Local model (Ollama) ──────────────────────────────────────────────────────

SYSTEM_PROMPT = (
  "You are CodeChatter AI, a collaborative coding assistant. "
  "Focus on code explanation, debugging, and concrete next steps."
)


async def check_ollama() -> dict[str, Any]:
  """Report whether the local model server is up and carrying the model.

  Split out from the completion path so the health endpoint can ask the same
  question without generating a token.
  """
  try:
    async with httpx.AsyncClient(timeout=3.0) as client:
      response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
      response.raise_for_status()
      installed = [m.get("name", "") for m in response.json().get("models", [])]
  except httpx.HTTPError as error:
    return {"reachable": False, "error": str(error), "models": []}

  # Ollama reports "qwen2.5-coder:7b"; a bare "qwen2.5-coder" should still match.
  wanted = OLLAMA_MODEL.split(":")[0]
  has_model = any(name.split(":")[0] == wanted for name in installed)

  return {"reachable": True, "modelInstalled": has_model, "models": installed}


async def request_ollama_completion(prompt: str) -> str:
  payload = {
    "model": OLLAMA_MODEL,
    "messages": [
      {"role": "system", "content": SYSTEM_PROMPT},
      {"role": "user", "content": prompt},
    ],
    "stream": False,
    "options": {"temperature": 0.35, "num_predict": 1024},
    # Keep the model resident between questions instead of paying the load
    # cost again after a few idle minutes.
    "keep_alive": OLLAMA_KEEP_ALIVE,
  }

  try:
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
      response = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload)
      response.raise_for_status()
  except httpx.ConnectError as error:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail=(
        f"No local model server at {OLLAMA_BASE_URL}. Install Ollama, then run "
        f"`ollama pull {OLLAMA_MODEL}` and leave `ollama serve` running. "
      ),
    ) from error
  except httpx.HTTPStatusError as error:
    detail = error.response.text.strip() or str(error)

    # A missing model is the common first-run case and has a specific fix.
    if error.response.status_code == 404:
      detail = f"Model '{OLLAMA_MODEL}' is not pulled yet. Run: ollama pull {OLLAMA_MODEL}"

    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Local model request failed: {detail}",
    ) from error
  except httpx.HTTPError as error:
    raise HTTPException(
      status_code=status.HTTP_504_GATEWAY_TIMEOUT,
      detail=(
        f"Local model timed out after {OLLAMA_TIMEOUT_SECONDS:.0f}s. A first "
        "response is slow while the model loads into memory — try again, or "
        "raise OLLAMA_TIMEOUT_SECONDS."
      ),
    ) from error

  text = (response.json().get("message") or {}).get("content", "").strip()

  if not text:
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail="The local model returned an empty response",
    )

  return text


async def request_ai_completion(prompt: str) -> str:
  """Send `prompt` to the local model."""
  return await request_ollama_completion(prompt)


async def warm_up_model() -> None:
  """Load the model into memory at boot so the first question is not the slow one.

  A cold qwen2.5-coder:7b takes several seconds to load; asking for a single
  token forces that now, in the background, rather than making whoever opens
  the assistant first wait for it. Every failure here is logged and swallowed —
  the server must still start when Ollama is not running.
  """
  probe = await check_ollama()

  if not probe["reachable"]:
    logger.warning(
      "[ai] No model server at %s — the assistant will not answer until "
      "`ollama serve` is running.",
      OLLAMA_BASE_URL,
    )
    return

  if not probe.get("modelInstalled"):
    logger.warning("[ai] Model %s is not pulled. Run: ollama pull %s", OLLAMA_MODEL, OLLAMA_MODEL)
    return

  try:
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
      await client.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
          "model": OLLAMA_MODEL,
          "messages": [{"role": "user", "content": "ok"}],
          "stream": False,
          "keep_alive": OLLAMA_KEEP_ALIVE,
          "options": {"num_predict": 1},
        },
      )
    logger.info("[ai] %s is loaded and pinned in memory", OLLAMA_MODEL)
  except httpx.HTTPError as error:
    logger.warning("[ai] Warm-up failed (the assistant will still work): %s", error)
