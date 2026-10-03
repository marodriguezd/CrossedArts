import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import ForeignKey, String, Integer, Boolean, Enum, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.models.base import LessonType

class Module(Base):
    __tablename__ = "module"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        GUID, 
        ForeignKey("course.id", ondelete="CASCADE"), 
        nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    course: Mapped["Course"] = relationship("Course", back_populates="modules")
    lessons: Mapped[List["Lesson"]] = relationship(
        "Lesson",
        back_populates="module",
        cascade="all, delete-orphan",
        order_by="Lesson.order_index"
    )


class Lesson(Base):
    __tablename__ = "lesson"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    module_id: Mapped[uuid.UUID] = mapped_column(
        GUID, 
        ForeignKey("module.id", ondelete="CASCADE"), 
        nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    lesson_type: Mapped[LessonType] = mapped_column(
        Enum(LessonType), 
        default=LessonType.VIDEO, 
        nullable=False
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    module: Mapped["Module"] = relationship("Module", back_populates="lessons")
    notes: Mapped[List["Note"]] = relationship(
        "Note",
        back_populates="lesson",
        cascade="all, delete-orphan"
    )
    media_assets: Mapped[List["MediaAsset"]] = relationship(
        "MediaAsset",
        back_populates="lesson",
        cascade="all, delete-orphan"
    )


class Task(Base):
    __tablename__ = "task"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        GUID, 
        ForeignKey("course.id", ondelete="CASCADE"), 
        nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relaciones
    course: Mapped["Course"] = relationship("Course", back_populates="tasks")
