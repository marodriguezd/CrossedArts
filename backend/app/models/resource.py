import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import ForeignKey, String, Float, Enum, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.models.base import TimestampMixin, ResourceStatus, CourseDifficulty

class LearningResource(Base, TimestampMixin):
    __tablename__ = "learning_resource"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    cover_path: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    category: Mapped[str] = mapped_column(String(100), default="General", index=True)
    status: Mapped[ResourceStatus] = mapped_column(
        Enum(ResourceStatus), 
        default=ResourceStatus.NOT_STARTED, 
        nullable=False
    )
    source_path: Mapped[Optional[str]] = mapped_column(String(1024), unique=True, nullable=True, index=True)
    
    # Campo discriminador para Joined Table Inheritance
    type: Mapped[str] = mapped_column(String(50), nullable=False)

    __mapper_args__ = {
        "polymorphic_on": type,
        "polymorphic_identity": "learning_resource"
    }

    # Relaciones genéricas aplicables a cualquier recurso de aprendizaje
    sessions: Mapped[List["LearningSession"]] = relationship(
        "LearningSession",
        back_populates="resource",
        cascade="all, delete-orphan"
    )
    
    notes: Mapped[List["Note"]] = relationship(
        "Note",
        back_populates="resource",
        cascade="all, delete-orphan"
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relaciones
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

    # Relaciones específicas del curso
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
