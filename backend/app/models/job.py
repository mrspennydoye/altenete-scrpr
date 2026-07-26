"""
Job and JobLog models for tracking scraping tasks.
"""

from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    String, Integer, DateTime, Text, ForeignKey, Enum, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class JobType(str, PyEnum):
    """Types of scraping jobs."""
    CRAWL_FORUM = "crawl_forum"
    SCRAPE_THREADS = "scrape_threads"
    SCRAPE_POSTS = "scrape_posts"
    FULL_RUN = "full_run"
    CHECK_NEW = "check_new"
    VALIDATE_CARDS = "validate_cards"
    TOPIC_CC_SCRAPE = "topic_cc_scrape"


class JobStatus(str, PyEnum):
    """Status of a scraping job."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LogLevel(str, PyEnum):
    """Log level for job logs."""
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class Job(Base):
    """A scraping job/task."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(
        Enum(JobType), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Enum(JobStatus), default=JobStatus.PENDING, nullable=False
    )
    config_id: Mapped[int | None] = mapped_column(
        ForeignKey("forum_configs.id", ondelete="SET NULL"), nullable=True
    )
    # Parent job ID — set on sub-jobs spawned by a full_run parent
    parent_job_id: Mapped[int | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # Human-readable phase label, e.g. "Phase 1: Crawl Forum" or "Phase 2: Scrape Threads"
    phase: Mapped[str | None] = mapped_column(String(120), nullable=True)
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    processed_items: Mapped[int] = mapped_column(Integer, default=0)
    failed_items: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    config: Mapped["ForumConfig | None"] = relationship()
    logs: Mapped[list["JobLog"]] = relationship(back_populates="job", cascade="all, delete-orphan")
    threads: Mapped[list["Thread"]] = relationship(back_populates="job")
    # Note: sub-jobs are queried directly via parent_job_id column (no ORM relationship
    # to avoid SQLAlchemy async mapper conflicts with self-referential FKs)


class JobLog(Base):
    """Log entry for a job."""

    __tablename__ = "job_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[str] = mapped_column(
        Enum(LogLevel), default=LogLevel.INFO, nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    job: Mapped["Job"] = relationship(back_populates="logs")


# Import here to resolve forward references
from app.models.forum import ForumConfig, Thread  # noqa: E402, F811
