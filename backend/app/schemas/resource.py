import uuid
from datetime import datetime
from typing import Literal, Optional, Union
from pydantic import BaseModel
from backend.app.schemas.common import BaseResponse
from backend.app.models.base import ResourceStatus

class UpdateResourceRequest(BaseModel):
    """Esquema validado para actualizar metadatos de un recurso."""
    title: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    cover_path: Optional[str] = None
    status: Optional[ResourceStatus] = None
    difficulty: Optional[str] = None
    author: Optional[str] = None

class ResourceBaseResponse(BaseResponse):
    id: uuid.UUID
    title: str
    description: Optional[str] = None
    cover_path: Optional[str] = None
    category: str
    status: ResourceStatus
    type: str
    source_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class CourseBaseResponse(ResourceBaseResponse):
    type: Literal["course"]
    difficulty: str

class BookBaseResponse(ResourceBaseResponse):
    type: Literal["book"]
    author: Optional[str] = None
    reading_percentage: float


ResourceResponse = Union[CourseBaseResponse, BookBaseResponse]


class MediaAssetResponse(BaseResponse):
    id: uuid.UUID
    resource_id: uuid.UUID
    lesson_id: Optional[uuid.UUID] = None
    media_type: str
    file_path: str
    file_name: str
    file_size: int
    mime_type: str
    created_at: datetime

