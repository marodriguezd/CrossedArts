import uuid
from datetime import datetime, date
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from backend.app.schemas.common import BaseResponse

# ----------------- LEARNING PATHS -----------------

class LearningPathItemResponse(BaseResponse):
    id: uuid.UUID
    learning_path_id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    task_id: Optional[uuid.UUID] = None
    sequence_order: int
    is_completed: bool
    completed_at: Optional[datetime] = None

class LearningPathResponse(BaseResponse):
    id: uuid.UUID
    title: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: List[LearningPathItemResponse] = []

class CreateLearningPathRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None

class CreateLearningPathItemRequest(BaseModel):
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    task_id: Optional[uuid.UUID] = None
    sequence_order: int = 0

# ----------------- STUDY PLANS -----------------

class StudyPlanResponse(BaseResponse):
    id: uuid.UUID
    title: str
    description: Optional[str] = None
    daily_goal_minutes: int
    weekly_goal_minutes: int
    target_completion_date: Optional[datetime] = None
    recommended_workload: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class CreateStudyPlanRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    daily_goal_minutes: int = Field(30, ge=1)
    weekly_goal_minutes: int = Field(150, ge=1)
    target_completion_date: Optional[datetime] = None
    recommended_workload: Optional[str] = None

# ----------------- GOALS -----------------

class GoalProgressResponse(BaseResponse):
    id: uuid.UUID
    goal_id: uuid.UUID
    value_change: float
    new_value: float
    recorded_at: datetime
    notes: Optional[str] = None

class GoalResponse(BaseResponse):
    id: uuid.UUID
    title: str
    target_type: str
    target_value: float
    current_value: float
    resource_id: Optional[uuid.UUID] = None
    is_completed: bool
    deadline: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    progress_updates: List[GoalProgressResponse] = []

class CreateGoalRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    target_type: str = Field(..., description="finish_book, complete_course, study_time, complete_lessons")
    target_value: float = Field(..., ge=0.1)
    resource_id: Optional[uuid.UUID] = None
    deadline: Optional[datetime] = None

class UpdateGoalProgressRequest(BaseModel):
    value_change: float
    notes: Optional[str] = None

# ----------------- HABITS -----------------

class HabitRecordResponse(BaseResponse):
    id: uuid.UUID
    habit_id: uuid.UUID
    date: datetime
    is_completed: bool
    created_at: datetime

class LearningHabitResponse(BaseResponse):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    frequency: str
    target_days_per_week: int
    created_at: datetime
    updated_at: datetime
    records: List[HabitRecordResponse] = []
    stats: Optional['HabitStatsResponse'] = None


class CreateLearningHabitRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    frequency: str = Field("daily", pattern="^(daily|weekly)$")
    target_days_per_week: int = Field(5, ge=1, le=7)

class HabitStatsResponse(BaseModel):
    habit_id: uuid.UUID
    name: str
    streak_days: int
    completion_rate: float
    weekly_count: int

# ----------------- SPACED REPETITION -----------------

class ReviewHistoryResponse(BaseResponse):
    id: uuid.UUID
    review_item_id: uuid.UUID
    reviewed_at: datetime
    quality: int
    next_review: datetime

class ReviewItemResponse(BaseResponse):
    id: uuid.UUID
    note_id: Optional[uuid.UUID] = None
    quiz_id: Optional[uuid.UUID] = None
    question_index: Optional[int] = None
    flashcard_front: Optional[str] = None
    flashcard_back: Optional[str] = None
    interval_days: int
    easiness_factor: float
    repetitions: int
    next_review: datetime
    last_reviewed: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    history: List[ReviewHistoryResponse] = []

class CreateReviewItemRequest(BaseModel):
    note_id: Optional[uuid.UUID] = None
    quiz_id: Optional[uuid.UUID] = None
    question_index: Optional[int] = None
    flashcard_front: Optional[str] = None
    flashcard_back: Optional[str] = None

class SubmitReviewRequest(BaseModel):
    quality: int = Field(..., ge=0, le=5)
