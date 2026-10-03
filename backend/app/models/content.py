import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from sqlalchemy import ForeignKey, String, Integer, Float, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive

class ExtractedMetadata(Base):
    __tablename__ = "extracted_metadata"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("media_asset.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    toc: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True) # Table of contents
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # Full extracted text content
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    # Relación
    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset", back_populates="extracted_metadata")


class Transcript(Base):
    __tablename__ = "transcript"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("media_asset.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )
    language: Mapped[str] = mapped_column(String(10), default="es", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    # Relaciones
    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset", back_populates="transcript")
    segments: Mapped[List["TranscriptSegment"]] = relationship(
        "TranscriptSegment",
        back_populates="transcript",
        cascade="all, delete-orphan"
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segment"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("transcript.id", ondelete="CASCADE"),
        nullable=False
    )
    start_time: Mapped[float] = mapped_column(Float, nullable=False) # Segundos
    end_time: Mapped[float] = mapped_column(Float, nullable=False)   # Segundos
    text: Mapped[str] = mapped_column(Text, nullable=False)

    # Relación
    transcript: Mapped["Transcript"] = relationship("Transcript", back_populates="segments")


class ContentIndex(Base):
    """
    Tabla de búsqueda tradicional para indexar bloques de texto (páginas, transcripciones, etc.)
    facilitando las consultas de búsqueda de texto completo.
    """
    __tablename__ = "content_index"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("media_asset.id", ondelete="CASCADE"),
        nullable=False
    )
    section_identifier: Mapped[str] = mapped_column(String(100), nullable=False) # e.g. "page_1", "transcript"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    # Relación
    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset")


class EmbeddingRecord(Base):
    __tablename__ = "embedding_record"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    entity_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True) # "note", "transcript_segment", "content_index"
    vector: Mapped[List[float]] = mapped_column(JSON, nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    hash_content: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)


class Quiz(Base):
    __tablename__ = "quiz"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    resource_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    questions: Mapped[List[Dict[str, Any]]] = mapped_column(JSON, nullable=False) # List of question objects
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    # Relación
    resource: Mapped["LearningResource"] = relationship("LearningResource")


