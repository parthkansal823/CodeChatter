from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException, status

try:
  from ..core.schemas import GeminiAssistRequest
  from ..core.settings import (
    AI_PROVIDER,
    GEMINI_API_BASE_URL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_SECONDS,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    logger,
  )
except ImportError:
  from core.schemas import GeminiAssistRequest
  from core.settings import (
    AI_PROVIDER,
    GEMINI_API_BASE_URL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_SECONDS,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
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


def build_gemini_prompt(
  payload: GeminiAssistRequest,
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


def extract_gemini_text(response_payload: dict[str, Any]) -> str:
  for candidate in response_payload.get("candidates", []):
    content = candidate.get("content", {})
    parts = content.get("parts", [])
    text_parts = [
      str(part.get("text", "")).strip()
      for part in parts
      if str(part.get("text", "")).strip()
    ]

    if text_parts:
      return "\n\n".join(text_parts)

  raise HTTPException(
    status_code=status.HTTP_502_BAD_GATEWAY,
    detail="Gemini returned an empty response",
  )


async def request_gemini_completion(prompt: str) -> str:
  if not GEMINI_API_KEY:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail="Gemini is not configured yet. Add GEMINI_API_KEY to server/.env.local and restart the backend.",
    )

  request_payload = {
    "system_instruction": {
      "parts": [
        {
          "text": (
            "You are CodeChatter AI, a collaborative coding assistant. "
            "Focus on code explanation, debugging, and concrete next steps."
          ),
        },
      ],
    },
    "contents": [
      {
        "role": "user",
        "parts": [{"text": prompt}],
      },
    ],
    "generationConfig": {
      "temperature": 0.35,
      "maxOutputTokens": 1024,
    },
  }

  try:
    async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as client:
      response = await client.post(
        f"{GEMINI_API_BASE_URL}/models/{GEMINI_MODEL}:generateContent",
        headers={
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        json=request_payload,
      )
      response.raise_for_status()
  except httpx.HTTPStatusError as error:
    detail = "Gemini request failed"

    try:
      error_payload = error.response.json()
      api_message = error_payload.get("error", {}).get("message")
      if isinstance(api_message, str) and api_message.strip():
        detail = api_message.strip()
    except ValueError:
      detail = error.response.text or detail

    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Gemini request failed: {detail}",
    ) from error
  except httpx.HTTPError as error:
    raise HTTPException(
      status_code=status.HTTP_502_BAD_GATEWAY,
      detail=f"Gemini request failed: {error}",
    ) from error

  return extract_gemini_text(response.json())


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
        "To use the hosted model instead, set AI_PROVIDER=gemini."
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
  """Send `prompt` to whichever backend this deployment is configured for."""
  if AI_PROVIDER == "gemini":
    return await request_gemini_completion(prompt)

  if AI_PROVIDER != "ollama":
    logger.warning("Unknown AI_PROVIDER %r - falling back to ollama", AI_PROVIDER)

  return await request_ollama_completion(prompt)
