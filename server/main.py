from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

try:
  from .core.middleware import configure_middleware
  from .core.settings import UPLOADS_DIR, repository
  from .routes.auth import router as auth_router
  from .routes.frontend import router as frontend_oauth_router
  from .routes.github import router as github_router
  from .routes.realtime import router as realtime_router
  from .routes.rooms import router as rooms_router
except ImportError:
  from core.middleware import configure_middleware
  from core.settings import UPLOADS_DIR, repository
  from routes.auth import router as auth_router
  from routes.frontend import router as frontend_oauth_router
  from routes.github import router as github_router
  from routes.realtime import router as realtime_router
  from routes.rooms import router as rooms_router

logger = logging.getLogger("codechatter.server")


@asynccontextmanager
async def lifespan(_: FastAPI):
  try:
    repository.initialize()
  except Exception as error:
    logger.warning("Database initialization deferred until first request: %s", error)
  yield
  repository.close()


app = FastAPI(title="CodeChatter API", lifespan=lifespan)
configure_middleware(app)
app.include_router(auth_router)
app.include_router(rooms_router)
app.include_router(github_router)
app.include_router(realtime_router)
app.include_router(frontend_oauth_router)

# Chat attachments live under the configured data directory (CODECHATTER_DATA_DIR),
# so they follow the same volume as workspace snapshots instead of being stranded
# inside the image.
app.mount("/api/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
