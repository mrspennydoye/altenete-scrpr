"""
FastAPI application entry point.
Sets up the app, middleware, routes, and lifecycle events.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db, close_db
from app.scheduler.scheduler import init_scheduler, shutdown_scheduler

# Import all models so SQLAlchemy can discover them
import app.models  # noqa: F401

settings = get_settings()

# Configure logging to console and a rotating file in logs/ folder
import os
from logging.handlers import RotatingFileHandler

logs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../logs"))
os.makedirs(logs_dir, exist_ok=True)
log_file = os.path.join(logs_dir, "app.log")

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Clear default handlers if any
while root_logger.handlers:
    root_logger.removeHandler(root_logger.handlers[0])

# Formatter
log_formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
root_logger.addHandler(console_handler)

# Rotating File handler (10MB per file, max 5 backups)
file_handler = RotatingFileHandler(log_file, maxBytes=10*1024*1024, backupCount=5, encoding="utf-8")
file_handler.setFormatter(log_formatter)
root_logger.addHandler(file_handler)

logger = logging.getLogger(__name__)



@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    # Startup
    logger.info("Starting up application...")
    await init_db()
    logger.info("Database initialized")

    # Auto-seed admin user if 'salman' does not exist
    from app.database import AsyncSessionLocal
    from app.models.user import User
    from app.services.auth_service import hash_password
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        user_exists = (await db.execute(select(User).where(User.username == "salman"))).scalar_one_or_none()
        if not user_exists:
            logger.info("Seeding default admin user (username: salman, password: [hidden])...")
            default_admin = User(
                username="salman",
                email="salman@example.com",
                hashed_password=hash_password("136517"),
            )
            db.add(default_admin)
            await db.commit()
            logger.info("Seeding completed.")

    # Reset stuck jobs from previous run (if any)
    from app.models.job import Job, JobStatus
    from sqlalchemy import update
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(Job)
            .where(Job.status.in_([JobStatus.RUNNING, JobStatus.PENDING]))
            .values(status=JobStatus.FAILED, error_message="Interrupted by system restart")
        )
        await db.commit()
        logger.info("Stuck jobs cleaned up")

    init_scheduler()
    logger.info("Scheduler started")

    # Restore active repeating watches to APScheduler
    from app.services.repeating_job_service import RepeatingJobService
    await RepeatingJobService.restore_all_on_startup()
    logger.info("Repeating watches restored")

    # Start Telegram Bot Manager background loop
    from app.services.telegram_service import telegram_bot_manager
    await telegram_bot_manager.start()
    logger.info("Telegram Bot service initialized")

    # Initialise card extraction PostgreSQL DB
    from app.extractor.card_db import init_card_db
    from app.config import get_settings as _gs
    _s = _gs()
    if _s.CARD_DB_URL:
        try:
            await init_card_db(_s.CARD_DB_URL)
            logger.info("Card extraction DB connected")
        except Exception as _cdb_err:
            logger.error(f"Card extraction DB failed to connect: {_cdb_err}")

    # Restore card export service state
    from app.services.card_export_service import card_export_service
    try:
        _ces = await card_export_service.get_settings()
        if _ces.daily_export_enabled:
            await card_export_service.start()
            logger.info("Card daily export service restored")
    except Exception as _ces_err:
        logger.error(f"Card export service restore error: {_ces_err}")

    yield

    # Shutdown
    logger.info("Shutting down application...")
    from app.services.telegram_service import telegram_bot_manager
    await telegram_bot_manager.stop()
    logger.info("Telegram Bot service stopped")

    from app.services.card_export_service import card_export_service
    await card_export_service.stop()

    from app.extractor.card_db import close_card_db
    await close_card_db()

    shutdown_scheduler()
    await close_db()
    from app.scraper.http_client import close_client
    await close_client()
    logger.info("Application shut down")


# Create FastAPI app
app = FastAPI(
    title="Altenete Forum Scraper",
    description=(
        "A XenForo forum scraper and crawler with job scheduling, "
        "built with FastAPI, Scrapling, and MySQL."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

import traceback
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error(
        f"Unhandled exception during request {request.method} {request.url}\n"
        f"Traceback:\n{tb}"
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error",
            "error": str(exc),
            "type": exc.__class__.__name__
        }
    )


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL, 
        "http://localhost:8080", 
        "http://127.0.0.1:8080", 
        "http://localhost:5173", 
        "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

# Include API routers
from app.api.auth import router as auth_router
from app.api.jobs import router as jobs_router
from app.api.forums import router as forums_router, posts_router
from app.api.dashboard import router as dashboard_router
from app.api.admin_logs import router as admin_logs_router
from app.api.repeating_jobs import router as watches_router
from app.api.telegram import router as telegram_router
from app.api.cards import router as cards_router
from app.api.topic_scraper import router as topic_scraper_router

app.include_router(auth_router)
app.include_router(jobs_router)
app.include_router(forums_router)
app.include_router(posts_router)
app.include_router(dashboard_router)
app.include_router(admin_logs_router)
app.include_router(watches_router)
app.include_router(telegram_router)
app.include_router(cards_router)
app.include_router(topic_scraper_router)


@app.get("/api/health", tags=["Health"])
async def health():
    """API health check."""
    return {"status": "healthy"}

# Mount frontend static files in production mode
# In Docker: FRONTEND_DIST_PATH=/frontend/dist (set in Dockerfile)
# Locally:   falls back to relative path from this file
_default_dist = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../frontend/dist")
)
frontend_path = os.environ.get("FRONTEND_DIST_PATH", _default_dist)

if os.path.exists(frontend_path):
    # Mount the assets folder with long-term caching (hashed filenames)
    assets_path = os.path.join(frontend_path, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        f = os.path.join(frontend_path, "favicon.svg")
        if os.path.exists(f):
            return FileResponse(f)
        return Response(status_code=404)

    # Serve index.html for all SPA routes
    @app.get("/{catchall:path}", include_in_schema=False)
    async def serve_spa(catchall: str):
        # Do not intercept API/docs routes
        for prefix in ("api/", "docs", "redoc", "openapi.json"):
            if catchall.startswith(prefix):
                return Response(content="Not Found", status_code=404)

        # Check if requested file exists inside dist
        file_path = os.path.join(frontend_path, catchall)
        if catchall and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)

        # Fallback to index.html for React Router SPA — no-cache so browser always fetches fresh HTML
        index_file = os.path.join(frontend_path, "index.html")
        if os.path.exists(index_file):
            with open(index_file, "rb") as f:
                content = f.read()
            return Response(
                content=content,
                media_type="text/html",
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )
        return Response(content="Frontend not found", status_code=404)
else:
    @app.get("/", tags=["Health"])
    async def root():
        """Health check endpoint (dev fallback)."""
        return {
            "status": "ok",
            "app": "Altenete Forum Scraper (Dev Mode)",
            "version": "1.0.0",
        }
