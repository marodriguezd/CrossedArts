import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import BaseResponse

class NoteResponse(BaseResponse):
    """Note response. `resource_id`/`lesson_id` may be null: a standalone note
    is a valid concept (same contract as the SQLite frontend)."""
    id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    content: str
    created_at: datetime
    updated_at: datetime

class CreateNoteRequest(BaseModel):
    """Note creation. The resource is optional: a note can be born and stay
    standalone. When a lesson is given, its link is preserved."""
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    content: str = Field(..., min_length=1)

class UpdateNoteRequest(BaseModel):
    content: str = Field(..., min_length=1)
