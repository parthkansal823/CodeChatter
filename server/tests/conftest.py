"""Shared test fixtures.

Every test runs against an in-memory mongomock database and a stubbed mailer,
so the suite needs no MongoDB and no SMTP server.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

SERVER_DIR = Path(__file__).resolve().parent.parent

# Point the app at throwaway infrastructure before anything imports settings.
# CODECHATTER_DATA_DIR must be set first: settings resolves the workspace and
# upload directories at import time and the app mounts them immediately.
#
# These are hard assignments, NOT setdefault. The `client` fixture truncates
# every collection before each test, so if a real MONGODB_URI is already in the
# environment — which it is inside the app container, and in any shell that has
# sourced server/.env — setdefault would leave it in place and the suite would
# wipe the live database. Overwriting is the only safe behaviour here.
_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="codechatter-tests-"))
os.environ["CODECHATTER_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["MONGODB_URI"] = "mongomock://localhost"
os.environ["MONGODB_DB_NAME"] = "codechatter_test"
os.environ["ENVIRONMENT"] = "development"
os.environ["SECRET_KEY"] = "test-secret-key-not-used-in-production"
os.environ["SESSION_SECRET_KEY"] = "test-session-secret-not-used-in-prod"
os.environ["SMTP_HOST"] = ""

if str(SERVER_DIR) not in sys.path:
  sys.path.insert(0, str(SERVER_DIR))


@pytest.fixture()
def sent_otps(monkeypatch):
  """Capture OTPs instead of mailing them."""
  import routes.auth as auth_routes

  captured: list[dict] = []

  def fake_send(to_email: str, otp: str, action: str = "login") -> None:
    captured.append({"email": to_email, "otp": otp, "action": action})

  monkeypatch.setattr(auth_routes, "send_otp_email", fake_send)
  return captured


@pytest.fixture()
def client(sent_otps):
  import main
  from core.security import rate_limiter
  from core.settings import repository
  from fastapi.testclient import TestClient

  with TestClient(main.app) as test_client:
    # The rate limiter is a process-wide singleton — without this, tests would
    # start tripping 429s on each other.
    with rate_limiter._lock:
      rate_limiter._requests.clear()

    # mongomock keeps state for the process lifetime; start each test clean.
    repository.initialize()

    # Last line of defence before the truncation below. If the repository ever
    # ends up pointed at a real server — a stray MONGODB_URI, an import order
    # change, a future edit to the block at the top of this file — these deletes
    # would empty the live database. Refuse to run instead.
    if not repository._is_mock:
      raise RuntimeError(
        "Refusing to run: the test repository is connected to a real MongoDB, "
        "not mongomock. The fixtures below truncate every collection.",
      )

    for collection in (
      repository._users,
      repository._rooms,
      repository._room_messages,
      repository._otp_challenges,
    ):
      collection.delete_many({})

    yield test_client


@pytest.fixture()
def register(client, sent_otps):
  """Create a verified account and return its auth token + user payload."""

  def _register(username: str = "tester", email: str | None = None) -> dict:
    email = email or f"{username}@example.com"
    signup = client.post(
      "/api/auth/signup",
      json={"email": email, "username": username, "password": "Str0ng!Passw0rd"},
    )
    assert signup.status_code == 200, signup.text

    verify = client.post(
      "/api/auth/verify-otp",
      json={"mfa_token": signup.json()["mfa_token"], "otp": sent_otps[-1]["otp"]},
    )
    assert verify.status_code == 200, verify.text

    body = verify.json()
    return {
      "token": body["token"],
      "user": body["user"],
      "headers": {"Authorization": f"Bearer {body['token']}"},
    }

  return _register
