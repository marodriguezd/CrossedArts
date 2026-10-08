from typing import List
from pydantic import BaseModel, Field
from backend.app.schemas.resource import BookBaseResponse, MediaAssetResponse

class UpdateBookProgressRequest(BaseModel):
    reading_percentage: float = Field(..., ge=0.0, le=100.0)

class BookDetailResponse(BookBaseResponse):
    media_assets: List[MediaAssetResponse] = []

