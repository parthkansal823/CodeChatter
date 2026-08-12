"""Auth, MFA, and account-lifecycle behaviour."""
from __future__ import annotations

import os


def test_health_reports_database(client):
  response = client.get("/api/health")
  assert response.status_code == 200
  assert response.json()["status"] == "ok"


def test_signup_requires_mfa_before_creating_the_account(client, sent_otps):
  response = client.post(
    "/api/auth/signup",
    json={"email": "a@example.com", "username": "alice", "password": "Str0ng!Passw0rd"},
  )

  assert response.status_code == 200
  body = response.json()
  assert body["requires_mfa"] is True
  assert "mfa_token" in body
  # The masked address must not leak the full local part.
  assert body["masked_email"] == "a***@example.com"
  assert len(sent_otps) == 1

  # No token is issued until the code is verified.
  assert "token" not in body


def test_weak_passwords_are_rejected(client):
  response = client.post(
    "/api/auth/signup",
    json={"email": "b@example.com", "username": "bob", "password": "alllowercase1"},
  )
  assert response.status_code == 422


def test_wrong_otp_is_rejected_and_counts_down(client, sent_otps):
  signup = client.post(
    "/api/auth/signup",
    json={"email": "c@example.com", "username": "carol", "password": "Str0ng!Passw0rd"},
  )
  mfa_token = signup.json()["mfa_token"]

  wrong = "000000" if sent_otps[-1]["otp"] != "000000" else "111111"
  response = client.post("/api/auth/verify-otp", json={"mfa_token": mfa_token, "otp": wrong})

  assert response.status_code == 400
  assert "attempt" in response.json()["detail"]


def test_full_signup_then_login_round_trip(client, sent_otps, register):
  account = register("dave")
  assert account["user"]["username"] == "dave"

  me = client.get("/api/auth/me", headers=account["headers"])
  assert me.status_code == 200
  assert me.json()["email"] == "dave@example.com"

  login = client.post(
    "/api/auth/login",
    json={"email": "dave@example.com", "password": "Str0ng!Passw0rd"},
  )
  assert login.json()["requires_mfa"] is True

  verified = client.post(
    "/api/auth/verify-otp",
    json={"mfa_token": login.json()["mfa_token"], "otp": sent_otps[-1]["otp"]},
  )
  assert verified.status_code == 200
  assert verified.json()["user"]["id"] == account["user"]["id"]


def test_login_with_a_bad_password_fails(client, register):
  register("erin")
  response = client.post(
    "/api/auth/login",
    json={"email": "erin@example.com", "password": "Wr0ng!Passw0rd"},
  )
  assert response.status_code == 401


def test_protected_routes_reject_missing_and_bogus_tokens(client):
  assert client.get("/api/rooms").status_code == 401
  assert client.get("/api/rooms", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_duplicate_email_is_rejected(client, register):
  register("frank")
  response = client.post(
    "/api/auth/signup",
    json={"email": "frank@example.com", "username": "frank2", "password": "Str0ng!Passw0rd"},
  )
  assert response.status_code == 409


# ── Health ────────────────────────────────────────────────────────────────────


def test_full_health_reports_every_subsystem(client):
  response = client.get("/api/health/full")

  assert response.status_code == 200
  body = response.json()

  assert set(body["checks"]) == {
    "database", "ai", "codeRunner", "email", "oauth", "storage",
  }
  assert body["status"] in {"ok", "degraded"}
  # `degraded` must be exactly the subsystems that reported not-ok, so the list
  # alone is enough to see what needs attention.
  assert body["degraded"] == [n for n, c in body["checks"].items() if not c["ok"]]


def test_a_down_subsystem_names_itself_and_says_how_to_fix_it(client, monkeypatch):
  import routes.auth as auth_routes

  async def unreachable():
    return {"reachable": False, "error": "connection refused", "models": []}

  monkeypatch.setattr(auth_routes, "AI_PROVIDER", "ollama")
  monkeypatch.setattr(auth_routes, "check_ollama", unreachable)

  body = client.get("/api/health/full").json()

  assert body["status"] == "degraded"
  assert "ai" in body["degraded"]
  assert body["checks"]["ai"]["ok"] is False
  assert "ollama serve" in body["checks"]["ai"]["hint"]
