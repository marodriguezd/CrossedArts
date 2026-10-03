import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from backend.app.schemas.common import BaseResponse

class LearningSessionResponse(BaseResponse):
    id: uuid.UUID
    resource_id: uuid.UUID
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_minutes: int

class StartSessionRequest(BaseModel):
    resource_id: uuid.UUID
