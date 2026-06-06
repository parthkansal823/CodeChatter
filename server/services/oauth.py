from __future__ import annotations

import os

from authlib.integrations.starlette_client import OAuth

oauth = OAuth()
REGISTERED_OAUTH_PROVIDERS: set[str] = set()


def register_oauth_providers() -> None:
  google_client_id = os.getenv("GOOGLE_CLIENT_ID")
  google_client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

  if google_client_id and google_client_secret:
    oauth.register(
      name="google",
      client_id=google_client_id,
      client_secret=google_client_secret,
      server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
      authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
      access_token_url="https://www.googleapis.com/oauth2/v4/token",
      userinfo_url="https://openidconnect.googleapis.com/v1/userinfo",
      client_kwargs={"scope": "openid email profile"},
    )
    REGISTERED_OAUTH_PROVIDERS.add("google")

  github_client_id = os.getenv("GITHUB_CLIENT_ID")
  github_client_secret = os.getenv("GITHUB_CLIENT_SECRET")

  if github_client_id and github_client_secret:
    oauth.register(
      name="github",
      client_id=github_client_id,
      client_secret=github_client_secret,
      access_token_url="https://github.com/login/oauth/access_token",
      authorize_url="https://github.com/login/oauth/authorize",
      api_base_url="https://api.github.com/",
      client_kwargs={"scope": "user:email read:user repo gist"},
    )
    REGISTERED_OAUTH_PROVIDERS.add("github")


register_oauth_providers()
