import uuid
from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel
from backend.app.schemas.common import BaseResponse
from backend.app.schemas.resource import ResourceBaseResponse
from backend.app.schemas.course import TaskResponse

class DashboardSummaryResponse(BaseModel):
    total_resources: int
    courses_count: int
    books_count: int
    completed_resources: int
    in_progress_resources: int
    pending_tasks_count: int
    total_study_time_minutes: int

class RecentActivityItem(BaseModel):
    id: uuid.UUID
    resource_id: uuid.UUID
    resource_title: str
    resource_type: str
    activity_type: str # "session" o "note"
    timestamp: datetime
    duration_minutes: Optional[int] = None
    description: Optional[str] = None

class StudyTimeDayReport(BaseModel):
    date: date
    minutes: int

class StudyTimeReportResponse(BaseModel):
    history: List[StudyTimeDayReport]
