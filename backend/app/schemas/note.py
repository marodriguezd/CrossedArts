import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import BaseResponse

class NoteResponse(BaseResponse):
    id: uuid.UUID
    resource_id: uuid.UUID
    lesson_id: Optional[uuid.UUID] = None
    content: str
    created_at: datetime
    updated_at: datetime

class CreateNoteRequest(BaseModel):
    resource_id: uuid.UUID
    lesson_id: Optional[uuid.UUID] = None
    content: str = Field(..., min_length=1)

class UpdateNoteRequest(BaseModel):
    content: str = Field(..., min_length=1)
