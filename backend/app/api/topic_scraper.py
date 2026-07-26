"""
Topic CC Scraper API — scrape all posts in a forum topic, extract credit
cards, and provide download / send-to-Telegram endpoints with real-time
WebSocket progress updates.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
from fastapi import (
    APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, verify_token_string
from app.database import get_db
from app.models.forum import ForumConfig
from app.models.job import Job, JobStatus, JobType
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/topic-scrape", tags=["Topic CC Scraper"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class TopicScrapeRequest(BaseModel):
    thread_url: str
    config_id: int


class TopicScrapeStartResponse(BaseModel):
    job_id: int
    status: str


# ─── POST /start ──────────────────────────────────────────────────────────────

@router.post("/start", response_model=TopicScrapeStartResponse)
async def start_topic_scrape(
    body: TopicScrapeRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Start a background scrape of every post in a forum topic."""
    from app.services.topic_scraper_service import run_topic_scrape, set_result

    thread_url = body.thread_url.strip()
    if not thread_url:
        raise HTTPException(400, "thread_url is required")

    # Verify the forum config exists
    cfg_result = await db.execute(
        select(ForumConfig).where(ForumConfig.id == body.config_id)
    )
    config = cfg_result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Forum configuration not found")

    # Create a job record
    job = Job(
        job_type=JobType.TOPIC_CC_SCRAPE,
        config_id=body.config_id,
        status=JobStatus.PENDING,
        total_items=0,
        processed_items=0,
        phase="Topic CC Scrape",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Seed an empty result entry so status polling works immediately
    set_result(job.id, {
        "job_id": job.id,
        "thread_url": thread_url,
        "thread_title": None,
        "total_pages": 0,
        "total_posts": 0,
        "total_cards": 0,
        "cards_text": "",
        "cards_only_text": "",
        "cards_list": [],
        "completed_at": None,
    })

    # Launch the background task
    asyncio.create_task(
        run_topic_scrape(job.id, thread_url, body.config_id)
    )

    return TopicScrapeStartResponse(job_id=job.id, status="pending")


# ─── GET /{job_id}/status ────────────────────────────────────────────────────

@router.get("/{job_id}/status")
async def get_topic_scrape_status(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """REST fallback — return current job status + result summary."""
    from app.services.topic_scraper_service import get_result

    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")

    stored = get_result(job_id) or {}
    return {
        "job_id": job_id,
        "status": job.status,
        "total_pages": stored.get("total_pages", 0),
        "total_posts": stored.get("total_posts", 0),
        "total_cards": stored.get("total_cards", 0),
        "thread_title": stored.get("thread_title"),
        "thread_url": stored.get("thread_url"),
        "cards_list": stored.get("cards_list", []),
        "processed_items": job.processed_items,
        "total_items": job.total_items,
        "error_message": job.error_message,
    }


# ─── WebSocket /{job_id}/ws ──────────────────────────────────────────────────

@router.websocket("/{job_id}/ws")
async def topic_scrape_ws(
    job_id: int,
    websocket: WebSocket,
    token: str = Query(...),
):
    """
    WebSocket for live topic-scrape progress.
    Auth: pass the JWT as ?token=<jwt> query param.
    """
    from app.services.topic_scraper_service import (
        register_ws, unregister_ws, get_result,
    )

    user = await verify_token_string(token)
    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    q = register_ws(job_id)

    # ── Send initial snapshot from the in-memory store + DB ────────────────
    from app.database import AsyncSessionLocal

    stored = get_result(job_id) or {}
    job_status = "unknown"
    try:
        async with AsyncSessionLocal() as db:
            row = await db.execute(select(Job).where(Job.id == job_id))
            job = row.scalar_one_or_none()
            if job:
                job_status = job.status
    except Exception:
        pass

    snapshot = {
        "type": "snapshot",
        "job_id": job_id,
        "job_status": job_status,
        "total_pages": stored.get("total_pages", 0),
        "total_posts": stored.get("total_posts", 0),
        "total_cards": stored.get("total_cards", 0),
        "thread_title": stored.get("thread_title"),
        "cards_list": stored.get("cards_list", []),
    }
    try:
        await websocket.send_text(json.dumps(snapshot))
    except Exception:
        pass

    # ── Stream events ───────────────────────────────────────────────────────
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=25.0)
                await websocket.send_text(msg)
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("WS connection closed: %s", exc)
    finally:
        unregister_ws(job_id, q)


# ─── GET /{job_id}/download ──────────────────────────────────────────────────

@router.get("/{job_id}/download")
async def download_topic_cards(
    job_id: int,
    _: User = Depends(get_current_user),
):
    """Download the extracted cards as a pipe-delimited text file."""
    from app.services.topic_scraper_service import get_result

    stored = get_result(job_id)
    if not stored:
        raise HTTPException(404, "No result found for this job.")

    cards_text = stored.get("cards_only_text") or ""
    if not cards_text.strip():
        raise HTTPException(400, "No cards were extracted from this topic.")

    thread_title = stored.get("thread_title") or "topic"
    # Sanitise title for filename
    safe_name = "".join(c for c in thread_title if c.isalnum() or c in "-_ ").strip().replace(" ", "_")
    if not safe_name:
        safe_name = "topic"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"cards_{safe_name}_{timestamp}.txt"

    return StreamingResponse(
        iter([cards_text]),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ─── POST /{job_id}/send-telegram ────────────────────────────────────────────

class SendTelegramResponse(BaseModel):
    status: str
    message: str = ""


@router.post("/{job_id}/send-telegram", response_model=SendTelegramResponse)
async def send_topic_cards_to_telegram(
    job_id: int,
    _: User = Depends(get_current_user),
):
    """Send the extracted cards text file to the Telegram admin chat."""
    from app.services.topic_scraper_service import get_result
    from app.services.telegram_service import telegram_bot_manager

    stored = get_result(job_id)
    if not stored:
        raise HTTPException(404, "No result found for this job.")

    cards_text = stored.get("cards_only_text") or ""
    if not cards_text.strip():
        raise HTTPException(400, "No cards were extracted from this topic.")

    cfg = await telegram_bot_manager.get_effective_settings()
    token = cfg.get("bot_token", "")
    admin_id = cfg.get("admin_chat_id", "")

    if not token or not admin_id:
        raise HTTPException(
            400,
            "Telegram bot token or admin chat ID is not configured.",
        )

    thread_title = stored.get("thread_title") or "topic"
    total_cards = stored.get("total_cards", 0)
    total_posts = stored.get("total_posts", 0)
    thread_url = stored.get("thread_url", "")
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Send an intro message
    intro = (
        f"💳 *Topic CC Extract*\n\n"
        f"📅 {now_str}\n"
        f"📄 Title: {thread_title}\n"
        f"🔗 {thread_url}\n"
        f"📊 Posts scanned: {total_posts}\n"
        f"💳 Cards extracted: {total_cards}\n\n"
        f"File attached below."
    )
    await telegram_bot_manager.send_message(admin_id, intro)
    await asyncio.sleep(1)

    # Send the file via sendDocument
    safe_name = "".join(c for c in thread_title if c.isalnum() or c in "-_ ").strip().replace(" ", "_")
    if not safe_name:
        safe_name = "topic"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"cards_{safe_name}_{timestamp}.txt"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            files = {"document": (filename, cards_text.encode("utf-8"), "text/plain")}
            data = {
                "chat_id": admin_id,
                "caption": f"💳 {total_cards} cards extracted from topic",
            }
            res = await client.post(
                f"https://api.telegram.org/bot{token}/sendDocument",
                data=data,
                files=files,
            )
            if res.status_code != 200:
                logger.warning("topic-scrape send-telegram failed: %s", res.text)
                raise HTTPException(502, f"Telegram API error: {res.text[:300]}")
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach Telegram API: {exc}")

    return SendTelegramResponse(
        status="sent",
        message=f"File with {total_cards} cards sent to Telegram.",
    )