import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from backend.app.schemas.common import BaseResponse

class NoteResponse(BaseResponse):
    """Respuesta de nota. `resource_id`/`lesson_id` pueden ser nulos: la nota
    autónoma es un concepto válido (mismo contrato que el frontend SQLite)."""
    id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    content: str
    created_at: datetime
    updated_at: datetime

class CreateNoteRequest(BaseModel):
    """Creación de nota. El recurso es opcional: una nota puede nacery
    permanecer autónoma. Si se indica lección, se conserva su vínculo."""
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    content: str = Field(..., min_length=1)

class UpdateNoteRequest(BaseModel):
    content: str = Field(..., min_length=1)
