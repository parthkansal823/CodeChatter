from __future__ import annotations

import logging
import asyncio
from contextlib import asynccontextmanager

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
  from .services.ai import warm_up_model
except ImportError as error:
  # The fallback exists for the flat layout (running from inside server/). A
  # missing third-party package also raises ImportError, and falling through
  # then reports "No module named 'core'" — which sends you hunting the wrong
  # bug. Only absorb failures that are actually about this package's own
  # relative imports.
  if error.name and not error.name.startswith(("server", "core", "routes", "services", "database")):
    raise

  from core.middleware import configure_middleware
  from core.settings import UPLOADS_DIR, repository
  from routes.auth import router as auth_router
  from routes.frontend import router as frontend_oauth_router
  from routes.github import router as github_router
  from routes.realtime import router as realtime_router
  from routes.rooms import router as rooms_router
  from services.ai import warm_up_model

logger = logging.getLogger("codechatter.server")


@asynccontextmanager
async def lifespan(_: FastAPI):
  try:
    repository.initialize()
  except Exception as error:
    logger.warning("Database initialization deferred until first request: %s", error)
  # Fire-and-forget: a slow or absent model server must not delay startup.
  asyncio.create_task(warm_up_model())

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
