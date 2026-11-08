import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from sqlalchemy import ForeignKey, String, Float, Enum, Integer, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive
from backend.app.models.base import TimestampMixin, ResourceStatus, CourseDifficulty

if TYPE_CHECKING:
    from backend.app.models.activity import LearningSession, MediaProgress, Note
    from backend.app.models.content import ExtractedMetadata, Transcript
    from backend.app.models.course_structure import Lesson, Module, Task


class LearningResource(Base, TimestampMixin):
    __tablename__ = "learning_resource"

    # Declared on the model so `Base.metadata.create_all()` produces the SAME
    # indexes the Alembic chain builds (a1b2c3d4e5f6, d8d6741e257c). Otherwise a
    # fresh install queries without them and only upgraded installs stay fast.
    __table_args__ = (
        Index("ix_learning_resource_updated_at", "updated_at"),
        Index("ix_learning_resource_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    cover_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    category: Mapped[str] = mapped_column(String(100), default="General", index=True)
    status: Mapped[ResourceStatus] = mapped_column(
        Enum(ResourceStatus),
        default=ResourceStatus.NOT_STARTED,
        nullable=False,
        index=True
    )
    source_path: Mapped[Optional[str]] = mapped_column(String(1024), unique=True, nullable=True, index=True)

    # Discriminator column for Joined Table Inheritance.
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    __mapper_args__ = {
        "polymorphic_on": type,
        "polymorphic_identity": "learning_resource"
    }

    # No delete cascade: a study session is HISTORY, not owned data. Deleting
    # the resource unlinks it via `ON DELETE SET NULL` and preserves it (the
    # effective scope is re-derived on read). `passive_deletes` leaves the
    # unlink to the database instead of loading and deleting every session.
    sessions: Mapped[List["LearningSession"]] = relationship(
        "LearningSession",
        back_populates="resource",
        cascade="save-update, merge",
        passive_deletes=True,
    )

    # No `delete-orphan`: a note is user work and can stand alone. Deleting the
    # resource unlinks it via `ON DELETE SET NULL` and preserves it.
    notes: Mapped[List["Note"]] = relationship(
        "Note",
        back_populates="resource",
    )

    media_assets: Mapped[List["MediaAsset"]] = relationship(
        "MediaAsset",
        back_populates="resource",
        cascade="all, delete-orphan"
    )


class MediaAsset(Base):
    __tablename__ = "media_asset"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    resource_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        nullable=False
    )
    lesson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("lesson.id", ondelete="CASCADE"),
        nullable=True
    )
    media_type: Mapped[str] = mapped_column(String(50), nullable=False) # "video", "pdf", "epub", etc.
    file_path: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    resource: Mapped["LearningResource"] = relationship("LearningResource", back_populates="media_assets")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson", back_populates="media_assets")
    progress: Mapped[Optional["MediaProgress"]] = relationship(
        "MediaProgress",
        back_populates="media_asset",
        cascade="all, delete-orphan"
    )
    extracted_metadata: Mapped[Optional["ExtractedMetadata"]] = relationship(
        "ExtractedMetadata",
        back_populates="media_asset",
        uselist=False,
        cascade="all, delete-orphan"
    )
    transcript: Mapped[Optional["Transcript"]] = relationship(
        "Transcript",
        back_populates="media_asset",
        uselist=False,
        cascade="all, delete-orphan"
    )



class Course(LearningResource):
    __tablename__ = "course"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        primary_key=True
    )
    difficulty: Mapped[CourseDifficulty] = mapped_column(
        Enum(CourseDifficulty),
        default=CourseDifficulty.BEGINNER,
        nullable=False
    )

    __mapper_args__ = {
        "polymorphic_identity": "course"
    }

    modules: Mapped[List["Module"]] = relationship(
        "Module",
        back_populates="course",
        cascade="all, delete-orphan",
        order_by="Module.order_index"
    )

    tasks: Mapped[List["Task"]] = relationship(
        "Task",
        back_populates="course",
        cascade="all, delete-orphan"
    )


class Book(LearningResource):
    __tablename__ = "book"

    id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        primary_key=True
    )
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    reading_percentage: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    __mapper_args__ = {
        "polymorphic_identity": "book"
    }
