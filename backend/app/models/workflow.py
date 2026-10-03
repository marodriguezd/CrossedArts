import uuid
from datetime import datetime
from typing import Optional, List
from sqlalchemy import ForeignKey, String, Integer, Float, DateTime, Boolean, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive
from backend.app.models.base import TimestampMixin

class LearningPath(Base, TimestampMixin):
    __tablename__ = "learning_path"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    items: Mapped[List["LearningPathItem"]] = relationship(
        "LearningPathItem",
        back_populates="learning_path",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LearningPathItem.sequence_order"
    )


class LearningPathItem(Base):
    __tablename__ = "learning_path_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    learning_path_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_path.id", ondelete="CASCADE"),
        nullable=False
    )
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="SET NULL"),
        nullable=True
    )
    lesson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("lesson.id", ondelete="SET NULL"),
        nullable=True
    )
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("task.id", ondelete="SET NULL"),
        nullable=True
    )
    sequence_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    learning_path: Mapped["LearningPath"] = relationship("LearningPath", back_populates="items")
    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson")
    task: Mapped[Optional["Task"]] = relationship("Task")


class StudyPlan(Base, TimestampMixin):
    __tablename__ = "study_plan"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    daily_goal_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    weekly_goal_minutes: Mapped[int] = mapped_column(Integer, default=150, nullable=False)
    target_completion_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    recommended_workload: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)


class Goal(Base, TimestampMixin):
    __tablename__ = "goal"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)  # "finish_book", "complete_course", "study_time", "complete_lessons"
    target_value: Mapped[float] = mapped_column(Float, nullable=False)
    current_value: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="SET NULL"),
        nullable=True
    )
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource")
    progress_updates: Mapped[List["GoalProgress"]] = relationship(
        "GoalProgress",
        back_populates="goal",
        cascade="all, delete-orphan",
        passive_deletes=True
    )


class GoalProgress(Base):
    __tablename__ = "goal_progress"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    goal_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("goal.id", ondelete="CASCADE"),
        nullable=False
    )
    value_change: Mapped[float] = mapped_column(Float, nullable=False)
    new_value: Mapped[float] = mapped_column(Float, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    goal: Mapped["Goal"] = relationship("Goal", back_populates="progress_updates")


class LearningHabit(Base, TimestampMixin):
    __tablename__ = "learning_habit"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    frequency: Mapped[str] = mapped_column(String(50), default="daily", nullable=False)  # "daily", "weekly"
    target_days_per_week: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    records: Mapped[List["HabitRecord"]] = relationship(
        "HabitRecord",
        back_populates="habit",
        cascade="all, delete-orphan",
        passive_deletes=True
    )


class HabitRecord(Base):
    __tablename__ = "habit_record"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    habit_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("learning_habit.id", ondelete="CASCADE"),
        nullable=False
    )
    date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)

    habit: Mapped["LearningHabit"] = relationship("LearningHabit", back_populates="records")


class ReviewItem(Base, TimestampMixin):
    __tablename__ = "review_item"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    note_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("note.id", ondelete="CASCADE"),
        nullable=True
    )
    quiz_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("quiz.id", ondelete="CASCADE"),
        nullable=True
    )
    question_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    flashcard_front: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    flashcard_back: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)

    # SM-2 variables
    interval_days: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    easiness_factor: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    repetitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_review: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    last_reviewed: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    note: Mapped[Optional["Note"]] = relationship("Note")
    quiz: Mapped[Optional["Quiz"]] = relationship("Quiz")
    history: Mapped[List["ReviewHistory"]] = relationship(
        "ReviewHistory",
        back_populates="review_item",
        cascade="all, delete-orphan",
        passive_deletes=True
    )


class ReviewHistory(Base):
    __tablename__ = "review_history"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    review_item_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("review_item.id", ondelete="CASCADE"),
        nullable=False
    )
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, nullable=False)
    quality: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 to 5
    next_review: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    review_item: Mapped["ReviewItem"] = relationship("ReviewItem", back_populates="history")
