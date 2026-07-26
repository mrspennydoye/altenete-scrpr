"""
Topic CC Scraper Service — scrapes ALL posts in a single forum topic,
extracts credit card data from every post, deduplicates, and builds a
pipe-formatted text file ready for download or Telegram dispatch.

Broadcasts real-time progress over WebSocket to connected listeners,
following the same pattern as bulk_card_service.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.forum import ForumConfig
from app.models.job import Job, JobStatus, JobType
from app.scraper.parsers import parse_all_posts_from_page, parse_total_pages, _soup
from app.scraper.xenforo_auth import XenForoAuth, is_logged_in
from app.extractor.card_extractor import extract_cards, ExtractedCard

logger = logging.getLogger(__name__)

# Safety cap so a malformed pagination indicator can't cause an infinite loop
_MAX_PAGES = 2000

# ── WebSocket connection registry ─────────────────────────────────────────────
# Maps job_id → set of asyncio.Queue objects (one per connected WS client)
_ws_listeners: dict[int, set[asyncio.Queue]] = {}


def register_ws(job_id: int) -> asyncio.Queue:
    """Register a new WebSocket listener for job_id. Returns the queue."""
    q: asyncio.Queue = asyncio.Queue()
    _ws_listeners.setdefault(job_id, set()).add(q)
    return q


def unregister_ws(job_id: int, q: asyncio.Queue):
    """Remove a WebSocket listener."""
    listeners = _ws_listeners.get(job_id, set())
    listeners.discard(q)
    if not listeners:
        _ws_listeners.pop(job_id, None)


async def _broadcast(job_id: int, event: dict):
    """Push an event to all WebSocket listeners for this job."""
    payload = json.dumps(event)
    for q in list(_ws_listeners.get(job_id, set())):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ── In-memory result store ────────────────────────────────────────────────────
# Maps job_id → result dict (cards text, stats, metadata)
_results: dict[int, dict[str, Any]] = {}


def get_result(job_id: int) -> dict[str, Any] | None:
    """Return the stored result for a finished (or running) scrape job."""
    return _results.get(job_id)


def set_result(job_id: int, data: dict[str, Any]):
    """Store / update the result for a scrape job."""
    _results[job_id] = data


def delete_result(job_id: int):
    """Remove a result entry (cleanup)."""
    _results.pop(job_id, None)


# ── DB helpers ────────────────────────────────────────────────────────────────


async def _set_job_status(job_id: int, status: JobStatus, error: str | None = None):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            return
        job.status = status
        if error:
            job.error_message = error[:500]
        if status == JobStatus.RUNNING and not job.started_at:
            job.started_at = datetime.now(timezone.utc)
        if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            job.completed_at = datetime.now(timezone.utc)
        await db.commit()


async def _update_job_progress(job_id: int, processed: int, total: int):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            return
        job.processed_items = processed
        job.total_items = total
        await db.commit()


async def _is_cancelled(job_id: int) -> bool:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Job).where(Job.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            return False
        return job.status == JobStatus.CANCELLED


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalise_thread_url(thread_url: str, base_url: str) -> str:
    """Clean a thread URL: strip fragments/query, ensure trailing slash."""
    url = thread_url.strip()
    if not url.startswith("http"):
        url = f"{base_url.rstrip('/')}/{url.lstrip('/')}"
    url = url.split("#")[0].split("?")[0]
    if url.endswith("/unread"):
        url = url[:-7]
    elif url.endswith("/unread/"):
        url = url[:-8]
    if not url.endswith("/"):
        url += "/"
    return url


def _extract_title(html: str) -> str:
    """Extract the thread title from a page's <title> or og:title tag."""
    soup = _soup(html)
    og = soup.select_one("meta[property='og:title']")
    if og and og.get("content"):
        return og["content"].strip()
    title_tag = soup.select_one("title")
    if title_tag:
        text = title_tag.get_text(strip=True)
        # XenForo appends " | Forum Name" — split on first " | "
        return text.split(" | ")[0].strip()
    return "(unknown title)"


def _build_page_url(thread_url: str, page: int) -> str:
    """Build the URL for a specific page of a thread."""
    if page == 1:
        return thread_url
    return f"{thread_url.rstrip('/')}/page-{page}"


def _cards_to_text(cards: list[ExtractedCard], header: str | None = None) -> str:
    """Format a list of extracted cards into a pipe-delimited text block."""
    lines = []
    if header:
        lines.append(header)
        lines.append(f"Total cards: {len(cards)}")
        lines.append(f"Format: CARD_NUMBER|MM|YY|CVV")
        lines.append("=" * 60)
        lines.append("")
    for card in cards:
        lines.append(card.to_pipe())
    return "\n".join(lines)


# ── Core runner ───────────────────────────────────────────────────────────────


async def run_topic_scrape(job_id: int, thread_url: str, config_id: int):
    """
    Background task: scrape every page of a forum topic, extract cards from
    every post, deduplicate, and store the result for download / Telegram.
    """
    logger.info("topic_scrape: starting job %d for %s", job_id, thread_url)

    all_cards: list[ExtractedCard] = []
    seen_card_numbers: set[str] = set()
    total_posts = 0
    total_pages = 0
    thread_title = "(unknown)"

    try:
        await _set_job_status(job_id, JobStatus.RUNNING)

        # ── Load forum config for auth ──────────────────────────────────────
        async with AsyncSessionLocal() as db:
            cfg_result = await db.execute(
                select(ForumConfig).where(ForumConfig.id == config_id)
            )
            config = cfg_result.scalar_one_or_none()

        if not config:
            raise Exception(f"Forum config #{config_id} not found")

        base_url = config.forum_url
        clean_url = _normalise_thread_url(thread_url, base_url)

        await _broadcast(job_id, {
            "type": "start",
            "job_id": job_id,
            "thread_url": clean_url,
        })

        # ── Set up auth handler ─────────────────────────────────────────────
        async def on_session_refreshed(new_cookies):
            async with AsyncSessionLocal() as db:
                cfg_res = await db.execute(
                    select(ForumConfig).where(ForumConfig.id == config.id)
                )
                cfg = cfg_res.scalar_one()
                cfg.session_cookies = json.dumps(new_cookies)
                await db.commit()

        auth = XenForoAuth(
            base_url=base_url,
            username=config.xf_username,
            password=config.xf_password_encrypted,
            on_session_refreshed=on_session_refreshed,
        )

        # Load existing cookies
        if config.session_cookies:
            try:
                auth._cookies = json.loads(config.session_cookies)
                auth._is_authenticated = True
                await _broadcast(job_id, {"type": "log", "message": "Loaded saved session cookies."})
            except Exception:
                pass

        # Login if needed
        if not auth.is_authenticated:
            await _broadcast(job_id, {"type": "log", "message": "No active session — logging in..."})
            max_retries = 3
            login_success = False
            for attempt in range(1, max_retries + 1):
                try:
                    await auth.login()
                    login_success = True
                    break
                except Exception as login_err:
                    await _broadcast(job_id, {
                        "type": "log",
                        "message": f"Login attempt {attempt}/{max_retries} failed: {login_err}",
                        "level": "warning",
                    })
                    if attempt < max_retries:
                        await asyncio.sleep(5)
            if not login_success:
                raise Exception("Failed to authenticate with the forum after multiple attempts.")

        await _broadcast(job_id, {"type": "log", "message": "Authenticated. Fetching first page..."})

        # ── Fetch page 1 to determine total pages ──────────────────────────
        page1_html = await auth.fetch_with_retry(clean_url)
        if not is_logged_in(page1_html):
            raise Exception("Could not access the topic (not logged in).")

        thread_title = _extract_title(page1_html)
        total_pages = parse_total_pages(page1_html)
        total_pages = min(total_pages, _MAX_PAGES)

        await _broadcast(job_id, {
            "type": "page_total",
            "job_id": job_id,
            "thread_title": thread_title,
            "total_pages": total_pages,
        })
        await _update_job_progress(job_id, 0, total_pages)

        # ── Process page 1 posts ────────────────────────────────────────────
        page_posts = parse_all_posts_from_page(page1_html)
        page_cards = _process_posts(page_posts, all_cards, seen_card_numbers)
        total_posts += len(page_posts)
        await _update_job_progress(job_id, 1, total_pages)

        await _broadcast(job_id, {
            "type": "page_done",
            "job_id": job_id,
            "page": 1,
            "total_pages": total_pages,
            "posts_on_page": len(page_posts),
            "total_posts": total_posts,
            "cards_found": len(all_cards),
            "new_cards_this_page": page_cards,
        })

        # ── Iterate through remaining pages ────────────────────────────────
        delay = config.scrape_delay or 2.0
        for page in range(2, total_pages + 1):
            if await _is_cancelled(job_id):
                await _broadcast(job_id, {"type": "cancelled", "job_id": job_id})
                break

            page_url = _build_page_url(clean_url, page)
            await _broadcast(job_id, {
                "type": "log",
                "message": f"Fetching page {page}/{total_pages}...",
            })

            try:
                page_html = await auth.fetch_with_retry(page_url)
            except Exception as page_err:
                logger.warning("topic_scrape: page %d failed: %s", page, page_err)
                await _broadcast(job_id, {
                    "type": "log",
                    "message": f"Page {page} fetch failed: {page_err}",
                    "level": "warning",
                })
                await _update_job_progress(job_id, page - 1, total_pages)
                # Rate-limit then continue to next page
                await asyncio.sleep(delay * random.uniform(0.75, 1.25))
                continue

            page_posts = parse_all_posts_from_page(page_html)
            page_cards = _process_posts(page_posts, all_cards, seen_card_numbers)
            total_posts += len(page_posts)
            await _update_job_progress(job_id, page, total_pages)

            await _broadcast(job_id, {
                "type": "page_done",
                "job_id": job_id,
                "page": page,
                "total_pages": total_pages,
                "posts_on_page": len(page_posts),
                "total_posts": total_posts,
                "cards_found": len(all_cards),
                "new_cards_this_page": page_cards,
            })

            # Respectful rate-limiting with jitter
            if page < total_pages:
                jitter = delay * random.uniform(0.75, 1.25)
                await asyncio.sleep(jitter)

        # ── Build the final result ──────────────────────────────────────────
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        header = (
            f"Topic CC Extract — {now_str}\n"
            f"Source: {clean_url}\n"
            f"Title: {thread_title}\n"
            f"Pages scraped: {total_pages}\n"
            f"Posts scanned: {total_posts}\n"
            f"Cards extracted: {len(all_cards)}"
        )
        cards_text = _cards_to_text(all_cards, header=header)
        cards_only_text = _cards_to_text(all_cards, header=None)

        result_data = {
            "job_id": job_id,
            "thread_url": clean_url,
            "thread_title": thread_title,
            "total_pages": total_pages,
            "total_posts": total_posts,
            "total_cards": len(all_cards),
            "cards_text": cards_text,
            "cards_only_text": cards_only_text,
            "cards_list": [c.to_pipe() for c in all_cards],
            "completed_at": now_str,
        }
        set_result(job_id, result_data)

        final_status = JobStatus.COMPLETED
        if await _is_cancelled(job_id):
            final_status = JobStatus.CANCELLED
        await _set_job_status(job_id, final_status)

        await _broadcast(job_id, {
            "type": "done",
            "job_id": job_id,
            "thread_title": thread_title,
            "total_pages": total_pages,
            "total_posts": total_posts,
            "total_cards": len(all_cards),
        })
        logger.info(
            "topic_scrape: job %d complete — %d cards from %d posts across %d pages",
            job_id, len(all_cards), total_posts, total_pages,
        )

    except asyncio.CancelledError:
        logger.info("topic_scrape: job %d cancelled", job_id)
        await _set_job_status(job_id, JobStatus.CANCELLED)
        await _broadcast(job_id, {"type": "cancelled", "job_id": job_id})
        raise
    except Exception as exc:
        logger.error("topic_scrape: job %d crashed: %s", job_id, exc, exc_info=True)
        await _set_job_status(job_id, JobStatus.FAILED, str(exc))
        await _broadcast(job_id, {
            "type": "error",
            "job_id": job_id,
            "error": str(exc),
        })


def _process_posts(
    posts: list,
    all_cards: list[ExtractedCard],
    seen: set[str],
) -> int:
    """
    Extract cards from a list of PostData objects, appending unique cards
    to ``all_cards``.  Returns the count of *new* cards found on this batch.
    """
    new_count = 0
    for post in posts:
        if not post.content_text:
            continue
        cards = extract_cards(post.content_text)
        for card in cards:
            if card.card_number not in seen:
                seen.add(card.card_number)
                all_cards.append(card)
                new_count += 1
    return new_count