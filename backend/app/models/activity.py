import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import CheckConstraint, ForeignKey, String, Integer, DateTime, Boolean, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive
from backend.app.models.base import TimestampMixin

class LearningSession(Base):
    __tablename__ = "learning_session"

    # Contrato de dominio: una sesión puede estar acotada a un RECURSO, a una
    # LECCIÓN o a ambos (nunca a ninguna de las dos). El frontend (SQLite WASM)
    # ya modela así el estudio por lección: su migración legada reconstruye esta
    # tabla con `resource_id` nullable y exige al menos un ancla de ámbito.
    __table_args__ = (
        CheckConstraint(
            "resource_id IS NOT NULL OR lesson_id IS NOT NULL",
            name="ck_learning_session_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    lesson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("lesson.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    mode: Mapped[str] = mapped_column(String(20), default="flashcards", nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=utc_now_naive, 
        nullable=False
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inactive_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource", back_populates="sessions")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson")


class Note(Base, TimestampMixin):
    __tablename__ = "note"

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
    content: Mapped[str] = mapped_column(String(5000), nullable=False)

    # Relaciones
    resource: Mapped["LearningResource"] = relationship("LearningResource", back_populates="notes")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson", back_populates="notes")


class MediaProgress(Base, TimestampMixin):
    __tablename__ = "media_progress"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID, 
        ForeignKey("media_asset.id", ondelete="CASCADE"), 
        nullable=False,
        unique=True
    )
    last_position: Mapped[float] = mapped_column(Float, default=0.0) # Segundos o número de página
    duration: Mapped[float] = mapped_column(Float, default=0.0)      # Segundos o páginas totales
    is_watched: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relaciones
    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset", back_populates="progress")
