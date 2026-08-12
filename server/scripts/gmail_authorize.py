"""One-time consent flow that produces GMAIL_REFRESH_TOKEN.

Run once, paste the printed value into server/.env, and the backend can send
mail through the Gmail API from then on — no app password, no SMTP port.

    python scripts/gmail_authorize.py

Before running, in the same Google Cloud project you use for sign-in:
  1. APIs & Services → Library → enable "Gmail API"
  2. APIs & Services → Credentials → your OAuth client → Authorized redirect
     URIs → add  http://localhost:8765/
  3. If the consent screen is in "Testing", add the sending account under
     "Test users", or the refresh token expires after 7 days.
"""
from __future__ import annotations

import http.server
import json
import os
import socket
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(SERVER_DIR / ".env.local")
load_dotenv(SERVER_DIR / ".env")

REDIRECT_PORT = 8765
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/gmail.send"

CLIENT_ID = os.getenv("GMAIL_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID") or ""
CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET") or ""

received: dict[str, str] = {}


class CallbackHandler(http.server.BaseHTTPRequestHandler):
  def do_GET(self) -> None:  # noqa: N802 - name fixed by BaseHTTPRequestHandler
    query = urllib.parse.urlparse(self.path).query
    received.update({k: v[0] for k, v in urllib.parse.parse_qs(query).items()})

    self.send_response(200)
    self.send_header("Content-Type", "text/html; charset=utf-8")
    self.end_headers()
    body = (
      "<h2>Done — you can close this tab.</h2>"
      if "code" in received
      else f"<h2>Authorization failed: {received.get('error', 'unknown error')}</h2>"
    )
    self.wfile.write(body.encode())

  def log_message(self, *args) -> None:
    """Silence the default per-request logging."""


def main() -> int:
  if not CLIENT_ID or not CLIENT_SECRET:
    print("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in server/.env")
    return 1

  try:
    server = http.server.HTTPServer(("localhost", REDIRECT_PORT), CallbackHandler)
  except OSError as error:
    print(f"Cannot listen on {REDIRECT_URI} — {error}")
    return 1

  params = urllib.parse.urlencode(
    {
      "client_id": CLIENT_ID,
      "redirect_uri": REDIRECT_URI,
      "response_type": "code",
      "scope": SCOPE,
      # Google only returns a refresh token on the first consent unless both of
      # these are set, which is the usual reason this script "worked" but the
      # token came back empty.
      "access_type": "offline",
      "prompt": "consent",
    },
  )
  url = f"{AUTH_URL}?{params}"

  print(f"Opening the consent screen. If nothing opens, visit:\n  {url}\n")
  webbrowser.open(url)

  thread = threading.Thread(target=server.handle_request, daemon=True)
  thread.start()
  thread.join(timeout=300)
  server.server_close()

  if "code" not in received:
    print(f"No authorization code received ({received.get('error', 'timed out')})")
    return 1

  request = urllib.request.Request(
    TOKEN_URL,
    data=urllib.parse.urlencode(
      {
        "code": received["code"],
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
      },
    ).encode(),
    method="POST",
  )

  try:
    with urllib.request.urlopen(request, timeout=30) as response:
      payload = json.load(response)
  except (urllib.error.URLError, socket.timeout) as error:
    print(f"Token exchange failed: {error}")
    return 1

  refresh_token = payload.get("refresh_token")

  if not refresh_token:
    print(
      "Google did not return a refresh token. That happens when this account "
      "has already consented — revoke access at "
      "https://myaccount.google.com/permissions and run this again.",
    )
    return 1

  print("\nAdd these to server/.env:\n")
  print("MAIL_PROVIDER=gmail")
  print(f"GMAIL_REFRESH_TOKEN={refresh_token}")
  print("GMAIL_SENDER=<the gmail address you just authorised>")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
