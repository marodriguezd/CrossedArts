import uuid
from typing import Optional
from pydantic import BaseModel


class SearchResultResponse(BaseModel):
    resource_id: Optional[uuid.UUID] = None
    resource_title: Optional[str] = None
    resource_type: Optional[str] = None
    match_type: str
    snippet: str
    score: float


class SemanticSearchResultResponse(BaseModel):
    resource_id: Optional[uuid.UUID] = None
    resource_title: Optional[str] = None
    resource_type: Optional[str] = None
    match_type: str
    snippet: str
    score: float
    match_reason: Optional[str] = None
