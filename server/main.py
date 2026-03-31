from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

try:
  from .core.middleware import configure_middleware
  from .core.settings import repository
  from .routes.auth import router as auth_router
  from .routes.frontend import router as frontend_oauth_router
  from .routes.github import router as github_router
  from .routes.realtime import router as realtime_router
  from .routes.rooms import router as rooms_router
except ImportError:
  from core.middleware import configure_middleware
  from core.settings import repository
  from routes.auth import router as auth_router
  from routes.frontend import router as frontend_oauth_router
  from routes.github import router as github_router
  from routes.realtime import router as realtime_router
  from routes.rooms import router as rooms_router


@asynccontextmanager
async def lifespan(_: FastAPI):
  repository.initialize()
  yield
  repository.close()


app = FastAPI(title="CodeChatter API", lifespan=lifespan)
configure_middleware(app)
app.include_router(auth_router)
app.include_router(rooms_router)
app.include_router(github_router)
app.include_router(realtime_router)
app.include_router(frontend_oauth_router)

# Ensure uploads directory exists
uploads_dir = Path(__file__).parent / "data" / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)

# Mount it
app.mount("/api/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
