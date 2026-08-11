"""Auth, MFA, and account-lifecycle behaviour."""
from __future__ import annotations


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


# ── Development MFA bypass ────────────────────────────────────────────────────


def _reload_auth_with(monkeypatch, *, environment: str, flag: str):
  """Re-import settings and the auth routes with a different environment."""
  import importlib

  import core.settings as settings_module

  monkeypatch.setenv("ENVIRONMENT", environment)
  monkeypatch.setenv("DEV_SKIP_MFA", flag)
  importlib.reload(settings_module)

  import routes.auth as auth_module

  return importlib.reload(auth_module), settings_module


def test_dev_skip_mfa_signs_up_and_logs_in_without_a_code(client, monkeypatch):
  auth_module, _ = _reload_auth_with(monkeypatch, environment="development", flag="1")

  try:
    signup = client.post(
      "/api/auth/signup",
      json={"email": "fast@example.com", "username": "fast", "password": "Str0ng!Passw0rd"},
    )
    assert signup.status_code == 200, signup.text

    body = signup.json()
    assert "mfa_token" not in body
    assert body["token"]
    assert body["user"]["email"] == "fast@example.com"

    login = client.post(
      "/api/auth/login",
      json={"email": "fast@example.com", "password": "Str0ng!Passw0rd"},
    )
    assert login.status_code == 200, login.text
    assert "mfa_token" not in login.json()
    assert login.json()["token"]
  finally:
    _reload_auth_with(monkeypatch, environment="development", flag="")
    del auth_module


def test_the_bypass_cannot_be_switched_on_in_production(monkeypatch):
  import importlib

  import core.settings as settings_module

  monkeypatch.setenv("ENVIRONMENT", "production")
  monkeypatch.setenv("DEV_SKIP_MFA", "1")
  monkeypatch.setenv("SECRET_KEY", "prod-secret-for-this-test-only")
  monkeypatch.setenv("SESSION_SECRET_KEY", "prod-session-secret-for-this-test")

  try:
    importlib.reload(settings_module)
    assert settings_module.DEV_SKIP_MFA is False
  finally:
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("DEV_SKIP_MFA", "")
    importlib.reload(settings_module)
    importlib.reload(importlib.import_module("routes.auth"))


def test_mfa_still_applies_when_the_flag_is_off(client, sent_otps):
  signup = client.post(
    "/api/auth/signup",
    json={"email": "slow@example.com", "username": "slow", "password": "Str0ng!Passw0rd"},
  )

  assert signup.status_code == 200, signup.text
  assert signup.json()["requires_mfa"] is True
  assert sent_otps, "an OTP should have been issued"
