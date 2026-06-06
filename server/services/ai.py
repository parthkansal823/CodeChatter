from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
import httpx

try:
  from ..core.schemas import GeminiAssistRequest
  from ..core.settings import (
    GEMINI_API_BASE_URL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_SECONDS,
  )
except ImportError:
  from core.schemas import GeminiAssistRequest
  from core.settings import (
    GEMINI_API_BASE_URL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_SECONDS,
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
