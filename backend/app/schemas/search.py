import uuid
from typing import Optional
from pydantic import BaseModel

class SearchResultResponse(BaseModel):
    resource_id: uuid.UUID
    resource_title: str
    resource_type: str
    match_type: str
    snippet: str
    score: float
