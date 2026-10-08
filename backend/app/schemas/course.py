import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from backend.app.schemas.common import BaseResponse
from backend.app.schemas.resource import CourseBaseResponse
from backend.app.models.base import LessonType
from backend.app.schemas.resource import MediaAssetResponse

class TaskResponse(BaseResponse):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    description: Optional[str] = None
    is_completed: bool
    completed_at: Optional[datetime] = None

class LessonResponse(BaseResponse):
    id: uuid.UUID
    module_id: uuid.UUID
    title: str
    description: Optional[str] = None
    duration_minutes: int
    is_completed: bool
    lesson_type: LessonType
    order_index: int
    media_assets: List[MediaAssetResponse] = []


class ToggleLessonRequest(BaseModel):
    is_completed: bool

class ModuleResponse(BaseResponse):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    order_index: int
    lessons: List[LessonResponse] = []

class CourseDetailResponse(CourseBaseResponse):
    modules: List[ModuleResponse] = []
    tasks: List[TaskResponse] = []
