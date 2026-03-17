from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from starlette.middleware.sessions import SessionMiddleware
from authlib.integrations.starlette_client import OAuth
from jose import jwt
import os
from datetime import datetime, timedelta

load_dotenv()

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth = OAuth()
app.add_middleware(SessionMiddleware, secret_key="supersecretkey")

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this")
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

oauth.register(
    name="github",
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    access_token_url="https://github.com/login/oauth/access_token",
    authorize_url="https://github.com/login/oauth/authorize",
    api_base_url="https://api.github.com/",
    client_kwargs={"scope": "user:email"},
)

@app.get("/auth/google")
async def login_google(request: Request, redirect_uri: str = None):
    # Store redirect_uri in session for callback
    if redirect_uri:
        request.session["redirect_uri"] = redirect_uri
    redirect_url = request.url_for("auth_google_callback")
    return await oauth.google.authorize_redirect(request, redirect_url)


@app.get("/auth/google/callback")
async def auth_google_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
        user = token["userinfo"]

        email = user.get("email")
        name = user.get("name")
        user_id = user.get("sub")

        # Create JWT token
        payload = {
            "sub": user_id,
            "email": email,
            "username": name.split()[0] if name else email.split("@")[0],
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(days=7)
        }
        jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        user_data = {
            "id": user_id,
            "email": email,
            "username": name.split()[0] if name else email.split("@")[0]
        }

        # Get redirect_uri from session or default
        redirect_uri = request.session.get("redirect_uri", "http://localhost:5173/home")

        # Redirect to frontend callback with token data as query params
        frontend_url = f"{redirect_uri}?token={jwt_token}&user={user_data['username']}&email={email}&id={user_id}"
        return RedirectResponse(url=frontend_url)
    except Exception as e:
        print(f"Google OAuth error: {e}")
        return RedirectResponse(url="http://localhost:5173/auth?error=google_auth_failed")


@app.get("/auth/github")
async def login_github(request: Request, redirect_uri: str = None):
    # Store redirect_uri in session for callback
    if redirect_uri:
        request.session["redirect_uri"] = redirect_uri
    redirect_url = request.url_for("auth_github_callback")
    return await oauth.github.authorize_redirect(request, redirect_url)


@app.get("/auth/github/callback")
async def auth_github_callback(request: Request):
    try:
        token = await oauth.github.authorize_access_token(request)

        resp = await oauth.github.get("user", token=token)
        profile = resp.json()

        username = profile.get("login")
        user_id = profile.get("id")
        email = profile.get("email") or f"{username}@github.com"

        # Create JWT token
        payload = {
            "sub": user_id,
            "email": email,
            "username": username,
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(days=7)
        }
        jwt_token = jwt.encode(payload, SECRET_KEY, algorithm="HS256")

        user_data = {
            "id": user_id,
            "email": email,
            "username": username
        }

        # Get redirect_uri from session or default
        redirect_uri = request.session.get("redirect_uri", "http://localhost:5173/home")

        # Redirect to frontend callback with token data as query params
        frontend_url = f"{redirect_uri}?token={jwt_token}&user={username}&email={email}&id={user_id}"
        return RedirectResponse(url=frontend_url)
    except Exception as e:
        print(f"GitHub OAuth error: {e}")
        return RedirectResponse(url="http://localhost:5173/auth?error=github_auth_failed")


@app.get("/")
def home():
    return {"status": "server running"}
